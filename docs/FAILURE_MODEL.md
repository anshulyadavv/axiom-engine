# Axiom Engine — Failure Model

This document catalogs every failure scenario that Axiom must handle correctly,
defines the expected behavior for each, and establishes the testing
requirements.

## 1. Design Philosophy

Axiom is a reliability system. The fundamental question is not "can we execute
this workflow?" but "what happens when everything goes wrong?"

Principles:

- **Fail closed**: When in doubt, stop and report the error rather than
  silently continuing with potentially corrupt state.
- **Explicit ambiguity**: Never hide the fact that an external side effect
  may or may not have occurred.
- **Idempotent recovery**: Every recovery path must be safe to execute
  multiple times.
- **Bounded retries**: Never retry indefinitely. Every retry policy has
  a maximum.
- **Audit trail**: Every failure is recorded as an event. Failures are
  never silently swallowed.

## 2. Failure Taxonomy

### Category A: Process Failures

| ID | Failure | Description |
|----|---------|-------------|
| A1 | Worker crash before step execution | Worker dies after acquiring lease but before starting the step. |
| A2 | Worker crash during step execution | Worker dies while the step function is running. |
| A3 | Worker crash after external call, before persistence | The step function called an external API successfully, but the worker crashed before recording `StepCompleted`. **This is the most dangerous failure.** |
| A4 | Worker crash after persistence | Worker dies after recording `StepCompleted`. Cleanest failure — the step is durably recorded. |
| A5 | API gateway crash | The gateway dies while processing a request. |
| A6 | Scheduler crash | The scheduler dies, leaving timers and retries unserviced. |
| A7 | Dashboard crash | The dashboard becomes unavailable. |
| A8 | Outbox Relayer crash | The relayer dies, delaying NATS message dispatch. |

### Category B: Infrastructure Failures

| ID | Failure | Description |
|----|---------|-------------|
| B1 | PostgreSQL unavailable | Primary database is unreachable. |
| B2 | PostgreSQL slow | Queries take longer than expected. |
| B3 | NATS unavailable | Message broker is unreachable. |
| B4 | NATS slow / backpressure | Message delivery is delayed. |
| B5 | FoundationDB unavailable | Coordination layer is unreachable. |
| B6 | ClickHouse unavailable | Analytics backend is unreachable. |
| B7 | Network partition | Partial connectivity between components. |
| B8 | DNS failure | Service discovery fails. |
| B9 | Disk full | Local storage exhausted. |

### Category C: Data Failures

| ID | Failure | Description |
|----|---------|-------------|
| C1 | Corrupted event history | Event data is malformed or inconsistent. |
| C2 | Missing events | Expected events are absent from history. |
| C3 | Duplicate events | Same event appears multiple times. |
| C4 | Schema migration failure | Migration fails partway through. |
| C5 | Serialization failure | Step output cannot be deserialized. |
| C6 | Corrupted Distributed KV state | Workflow-local KV data is corrupt. (Phase 4) |
| C7 | Stale data in ClickHouse | Analytics data is delayed or incomplete. |

### Category D: Concurrency Failures

| ID | Failure | Description |
|----|---------|-------------|
| D1 | Duplicate NATS message | Same message delivered multiple times. |
| D2 | Concurrent workflow ownership | Two workers believe they own the same run. |
| D3 | Stale lease | A worker continues operating after its lease expired. |
| D4 | Duplicate timer fire | Same timer fires multiple times. |
| D5 | Duplicate signal | Same signal delivered multiple times. |
| D6 | Race between cancellation and completion | A workflow completes while a cancellation is in flight. |

### Category E: Logic Failures

| ID | Failure | Description |
|----|---------|-------------|
| E1 | Non-deterministic workflow code | Workflow produces different step sequences on replay. |
| E2 | Workflow version mismatch | Workflow code has changed incompatibly since the run started. |
| E3 | Duplicate step ID | Two steps in the same workflow have the same ID. |
| E4 | Step timeout | Step execution exceeds its timeout. |
| E5 | Workflow timeout | Total workflow execution exceeds its timeout. |
| E6 | Max retries exhausted | All retry attempts have failed. |
| E7 | Non-retryable error | Step throws an error classified as non-retryable. |
| E8 | Malformed workflow input | Input fails validation. |

### Category F: External System Failures

| ID | Failure | Description |
|----|---------|-------------|
| F1 | External API timeout | Step calls an external API that doesn't respond. |
| F2 | External API error | External API returns an error. |
| F3 | External API success, record failure | API succeeds but Axiom can't record it (see A3). |
| F4 | External API idempotency failure | API's idempotency mechanism fails or has expired. |

## 3. Expected Behavior for Each Failure

### A1: Worker crash before step execution

**Expected**: Lease expires → scheduler detects → reassigns to another worker →
workflow is replayed → step executes normally.

**Key invariant**: No side effects occurred, so replay is safe.

**Test**: Kill worker after lease acquisition, before step start. Verify
another worker picks up the run.

---

### A2: Worker crash during step execution

**Expected**: Step function was interrupted. Its side effects are unknown.
Lease expires → reassigned → replayed → step re-executes.

**Key invariant**: The step function WILL be re-executed. If it has external
side effects, they may be duplicated.

**Mitigation**: Idempotency keys on external calls.

**Test**: Kill worker during step execution. Verify re-execution.

---

### A3: Worker crash after external call, before persistence

**Expected**: The external side effect (e.g., Stripe charge) has occurred.
But `StepCompleted` was not recorded. On replay, the step will re-execute.

**This is the fundamental ambiguity of distributed systems.**

**Key invariant**: Axiom CANNOT know whether the external call succeeded.
The runtime re-executes the step. If the external API supports idempotency
keys, the duplicate call is safe. If not, the side effect may occur twice.

**Mitigation**: Idempotency keys. Documentation. User awareness.

**What Axiom must NOT do**: Claim this is handled transparently. The user
must understand this boundary.

**Test**: Simulate crash after external call returns but before DB write.
Verify re-execution. Verify idempotency key is reused.

---

### A4: Worker crash after persistence

**Expected**: `StepCompleted` is recorded. On replay, the recorded result is
returned. No re-execution.

**Key invariant**: The durability boundary was crossed. This is the clean case.

**Test**: Kill worker after DB write. Verify replay returns recorded result.

---

### A5: API gateway crash

**Expected**: Client receives a connection error or timeout. Client retries.
If the request was a workflow start with an idempotency key, the duplicate
is detected. If the request was in-flight (e.g., signal delivery), the NATS
message may or may not have been published.

**Mitigation**: Request idempotency keys. Client retry logic.

---

### A6: Scheduler crash

**Expected**: Timers and retries stop being dispatched. When the scheduler
restarts, it queries PostgreSQL for all due timers and pending retries, and
dispatches them via the outbox.

**Key invariant**: Timer state is in PostgreSQL, not in the scheduler's
memory. No timers are lost.

**Test**: Kill scheduler while timers are pending. Restart. Verify timers fire.

---

### A8: Outbox Relayer crash

**Expected**: NATS message dispatch is delayed. Operations commit to PostgreSQL successfully, but the messages remain in the outbox. Upon restart, the relayer resumes publishing unpublished outbox messages.

**Key invariant**: The transactional outbox guarantees at-least-once dispatch despite relayer crashes.

**Test**: Kill relayer, trigger a workflow, verify Postgres state updates but NATS gets no message. Restart relayer, verify NATS gets message.

---

### B1: PostgreSQL unavailable

**Expected**: All state-mutating operations fail. The API returns 503.
Workers cannot acquire leases or record step results. The system is
effectively down.

**Key invariant**: No silent data loss. Operations fail loudly.

**Recovery**: When PostgreSQL recovers, the system resumes automatically.
Pending NATS messages are retried.

**Test**: Pause PostgreSQL container. Verify error responses. Resume.
Verify recovery.

---

### B3: NATS unavailable

**Expected**: Async dispatch fails. Outbox messages accumulate in PostgreSQL because the relayer cannot publish them. Workflows cannot be started via NATS, and timers cannot be dispatched.

**Key invariant**: Durable state is in PostgreSQL, not NATS. NATS
unavailability delays execution but does not lose state due to the outbox pattern.

**Test**: Pause NATS. Verify state is preserved in outbox. Resume. Verify execution
continues.

---

### B6: ClickHouse unavailable

**Expected**: Analytics writes fail silently (logged as warnings). Core
workflow execution is completely unaffected.

**Key invariant**: ClickHouse failure MUST NEVER affect workflow execution.

**Test**: Stop ClickHouse. Run workflows. Verify all workflows complete.
Verify analytics data is missing but no errors propagated.

---

### C1: Corrupted event history

**Expected**: The runtime detects the corruption during replay (checksum
failure, invalid event type, impossible state transition). The run enters
an error state. The runtime does NOT attempt to continue.

**Key invariant**: Fail closed. Never silently proceed with corrupt state.

**Test**: Manually corrupt events in the database. Verify the runtime
catches it and fails the run.

---

### D1: Duplicate NATS message

**Expected**: The consumer receives the same message twice. It checks
whether the operation has already been performed (by `run_id`, `step_id`,
`attempt`, or `message_id`). If already performed, the duplicate is ignored.

**Key invariant**: All consumers are idempotent.

**Test**: Publish the same NATS message twice. Verify only one execution
occurs.

---

### D2: Concurrent workflow ownership

**Expected**: Prevented by lease protocol. If two workers somehow both
believe they own a run (e.g., slow worker after lease expiry), the fence
token prevents the stale worker from writing state.

**Key invariant**: Fence tokens on all state writes. Stale writes are rejected.

**Test**: Simulate two workers acquiring the same run. Verify only one
succeeds in writing results.

---

### E1: Non-deterministic workflow code

**Expected**: During replay, the runtime encounters a step that doesn't match
the expected position in history. A `DeterminismViolation` error is raised.
The run enters an error state.

**Key invariant**: Never silently return wrong results. Detect and halt.

**Test**: Modify workflow code between executions to change step order.
Replay. Verify `DeterminismViolation`.

---

### E2: Workflow version mismatch

**Expected**: The runtime compares the run's `workflow_version` with the
loaded definition's version. If incompatible, the run enters
`version_mismatch` status.

**Test**: Change workflow version. Attempt to replay old run. Verify
`version_mismatch`.

---

## 4. Failure Severity Classification

| Severity | Definition | Response |
|----------|-----------|----------|
| **Critical** | Data corruption or silent incorrect behavior | Immediate halt. Fail closed. No automatic recovery. |
| **High** | Workflow execution blocked | Automatic recovery when infrastructure recovers. |
| **Medium** | Degraded functionality | Graceful degradation. Logged. Alerted. |
| **Low** | Non-essential feature unavailable | Logged. No immediate action required. |

| Failure | Severity |
|---------|----------|
| A3 (external call ambiguity) | Critical (by nature; mitigated by design) |
| C1 (corrupted history) | Critical |
| D2 (concurrent ownership) | Critical |
| E1 (non-determinism) | Critical |
| A1, A2, A4 (worker crash) | High |
| A6 (scheduler crash) | High |
| A8 (outbox relayer crash) | High |
| B1 (PostgreSQL down) | High |
| B3 (NATS down) | High |
| A5 (gateway crash) | Medium |
| B6 (ClickHouse down) | Low |
| C7 (stale analytics) | Low |

## 5. Recovery Mechanisms

### 5.1 Lease-Based Recovery

- Worker crashes → lease expires → scheduler reassigns → replay and resume.
- Automatic. No operator intervention.

### 5.2 Scheduler Recovery

- Scheduler restarts → polls PostgreSQL for all due timers and pending retries.
- Automatic. Stateless scheduler design.

### 5.3 NATS Reconnection

- NATS client reconnects automatically.
- JetStream consumers resume from last acknowledged position.
- Unacknowledged messages are redelivered.

### 5.4 Manual Recovery

Some failures require operator intervention:

- Corrupted event history → manual inspection and potential run restart.
- Schema migration failure → manual rollback.
- Persistent PostgreSQL failure → restore from backup.

### 5.5 Compensation

For A3 (external call succeeded, record lost), compensation is the user's
responsibility. Axiom provides:

- Operation IDs for querying external system state.
- Compensating step support (user-defined rollback logic).
- Run error state with diagnostic information.

## 6. Testing Requirements

Every failure in Section 2 must have at least one dedicated test.

### Test Categories

| Category | Mechanism |
|----------|-----------|
| Unit tests | Inject errors into storage/messaging traits |
| Integration tests | Use real PostgreSQL/NATS in Docker |
| Chaos tests | Kill/pause/restart containers during execution |
| Property tests | Generate random failure sequences |

### Minimum Test Coverage

#### Category A: Process Failures
- [ ] A1: Worker crash before step execution
- [x] A2: Worker crash during step execution (verified by `crates/axiom-worker/tests/crash_recovery.rs`: worker A hard-killed mid-step2, worker B resumes and completes step2)
- [ ] A3: Worker crash after external call, before persistence
- [ ] A4: Worker crash after persistence (storage layer stale-token rejection verified by `test_fenced_write_fails_with_stale_token` and `test_renew_lease_fails_after_reacquisition_by_another_worker` in `crates/axiom-storage/tests/integration_tests.rs`; end-to-end stale worker write rejection test planned)
- [ ] A5: API gateway crash
- [ ] A6: Scheduler crash
- [ ] A7: Dashboard crash
- [ ] A8: Outbox Relayer crash

#### Category B: Infrastructure Failures
- [ ] B1: PostgreSQL unavailable
- [ ] B2: PostgreSQL slow
- [ ] B3: NATS unavailable
- [ ] B4: NATS slow / backpressure
- [ ] B5: FoundationDB unavailable
- [ ] B6: ClickHouse unavailable
- [ ] B7: Network partition
- [ ] B8: DNS failure
- [ ] B9: Disk full

#### Category C: Data Failures
- [ ] C1: Corrupted event history
- [ ] C2: Missing events
- [ ] C3: Duplicate events
- [ ] C4: Schema migration failure
- [ ] C5: Serialization failure
- [ ] C6: Corrupted Distributed KV state
- [ ] C7: Stale data in ClickHouse

#### Category D: Concurrency Failures
- [ ] D1: Duplicate NATS message
- [ ] D2: Concurrent workflow ownership
- [ ] D3: Stale lease
- [ ] D4: Duplicate timer fire
- [ ] D5: Duplicate signal
- [ ] D6: Race between cancellation and completion

#### Category E: Logic Failures
- [ ] E1: Non-deterministic workflow code
- [ ] E2: Workflow version mismatch
- [ ] E3: Duplicate step ID
- [ ] E4: Step timeout
- [ ] E5: Workflow timeout
- [ ] E6: Max retries exhausted
- [ ] E7: Non-retryable error
- [ ] E8: Malformed workflow input

#### Category F: External System Failures
- [ ] F1: External API timeout
- [ ] F2: External API error
- [ ] F3: External API success, record failure
- [ ] F4: External API idempotency failure

### Chaos Test Scenarios

1. Kill worker during step execution, verify recovery.
2. Kill scheduler, let timers accumulate, restart, verify all fire.
3. Pause PostgreSQL for 30 seconds, verify no data loss.
4. Pause NATS for 30 seconds, verify delayed delivery.
5. Duplicate NATS messages, verify idempotent handling.
6. Partition workers from PostgreSQL, verify lease expiry and reassignment.
7. Inject random latency (100ms-5s) on all DB calls, verify no timeouts
   cause data loss.
8. Kill and restart all workers simultaneously, verify all running workflows
   recover.
