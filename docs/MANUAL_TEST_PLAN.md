# Axiom Engine - Manual Test Plan

This document defines the core test matrix for validating Axiom Engine's durability, idempotency, and semantic correctness under adversarial runtime conditions.

## Basic Durability

### 1. Worker Killed Before Step
- **Action**: Suspend/kill the worker process immediately after it claims the NATS message but before it starts the TS sidecar.
- **Expected**: NATS message ACK timeout expires. Message is redelivered. Next worker correctly picks up and executes the step.

### 2. Worker Killed During Step
- **Action**: Kill the worker while the TS sidecar is actively executing an HTTP request or long computation.
- **Expected**: TS sidecar dies (orphaned process handling kicks in). Lease expires. NATS redelivers. Replay safely occurs up to the last durable event. The interrupted step is re-run.

### 3. Worker Killed After Step
- **Action**: Kill the worker after the sidecar finishes, but before the Rust host commits the transaction to Postgres.
- **Expected**: Postgres transaction rolls back. NATS message redelivers. Step is re-run (or idempotency key catches it if external API).

### 4. Worker Restarted
- **Action**: Gracefully stop and start the worker daemon.
- **Expected**: Existing runs are properly checkpointed or allowed to drain, and resume normally upon restart.

---

## Fencing & Concurrency

### 1. Stale Worker Attempts Write
- **Action**: Isolate a worker via network partition (`scripts/chaos.ps1 network-isolate-postgres`), let lease expire, let new worker take over and advance the workflow. Restore network for stale worker.
- **Expected**: Stale worker attempts to write `StepCompleted` but is rejected by Postgres due to a stale `fence_token`.

### 2. Newer Worker Owns Run
- **Action**: Start two workers, simulate a lease pause on Worker A. Worker B takes over.
- **Expected**: Worker B successfully claims the run and updates the `fence_token`. Worker A's subsequent lease renewals and event appends fail cleanly.

---

## Outbox & NATS

### Chaos Injection Environment Flags

All chaos fault injection flags in the worker consumer are gated behind the `AXIOM_CHAOS_ENABLED=1` master switch. When enabled, a loud warning is emitted at startup.

| Environment Variable | Type / Range | Default | Description |
|----------------------|--------------|---------|-------------|
| `AXIOM_CHAOS_ENABLED` | String (`1`) | Unset | Master gate for all chaos injection. If unset or `!= 1`, all chaos flags are ignored. Logs startup warning when enabled. |
| `AXIOM_CHAOS_NATS_DROP_RATE` | Float (`0.0` - `1.0`) | Unset (`0.0`) | Probability of dropping a received NATS work message without processing or ACK, simulating network packet loss. |
| `AXIOM_CHAOS_NATS_DUPLICATE_RATE` | Float (`0.0` - `1.0`) | Unset (`0.0`) | Probability of executing a received message twice back to back, simulating at-least-once duplicate delivery. |
| `AXIOM_CHAOS_LATENCY_MS` | Integer (ms >= 0) | Unset (`0`) | Artificial latency sleep injected prior to step execution, simulating network or queue delays. |

### 1. DB Commit Then Relayer Failure
- **Action**: Kill the Outbox Relayer immediately after a workflow run is persisted in Postgres, before it publishes to NATS.
- **Expected**: Outbox messages remain in the `outbox` table. Upon relayer restart, messages are swept and published to NATS. Workflow begins executing.

### 2. Duplicate Delivery
- **Action**: Enable `AXIOM_CHAOS_ENABLED=1` and `AXIOM_CHAOS_NATS_DUPLICATE_RATE=1.0`.
- **Expected**: Worker receives duplicate `WorkMessage`. The worker checks `step_executions` idempotency and ignores the duplicate. Event history is NOT duplicated.

### 3. Delayed Delivery
- **Action**: Enable `AXIOM_CHAOS_ENABLED=1` and `AXIOM_CHAOS_LATENCY_MS=5000`.
- **Expected**: Messages take 5s to process. Total throughput drops, but execution semantics remain flawlessly deterministic.

### 4. NATS Restart
- **Action**: Run `scripts/chaos.ps1 nats-restart` during active execution.
- **Expected**: Workers temporarily fail to pull/ack messages. Once NATS resumes, JetStream durable consumers replay un-acked messages. No state is lost.

### 5. Automated NATS Dispatch Suite (Roadmap)
- See `docs/TODO.md` for the list of automated NATS cluster integration tests pending live test harness setup (`test_b`, `test_c`, `test_f`, `test_g`, `test_h`, `test_i`, `test_j`).

---

## Child Workflows

### 1. Child Success
- **Action**: Parent starts a child. Child completes normally.
- **Expected**: Parent is woken up, receives child result, and resumes execution seamlessly.

### 2. Child Failure
- **Action**: Child workflow throws an unhandled exception.
- **Expected**: Child run is marked `failed`. Parent is woken up, `ctx.child()` throws an exception inside the parent TS code, which the parent can try/catch.

### 3. Parent Cancellation
- **Action**: Cancel the parent run via API.
- **Expected**: Parent run is cancelled. (Note: Depending on cascading cancellation semantics, child runs may either be cancelled or orphaned. Verify expected product behavior).

### 4. Nested Child
- **Action**: Parent -> Child A -> Child B.
- **Expected**: All parent-child IPC and Wakeup messages route correctly through the hierarchical outbox chain.

### 5. Duplicate Child Command
- **Action**: Introduce replay failure in parent right after emitting `Command::StartChild`.
- **Expected**: Replay re-emits `StartChild`. Engine detects the child already exists (via `parent_operation_id`) and safely re-binds to the existing child run.

---

## Workflow-Local State

### 1. Set / Get / Delete
- **Action**: Workflow scripts calls `ctx.state.set()`, `get()`, and `delete()`.
- **Expected**: Data is durably reflected in the `workflow_run_state` table.

### 2. Worker Restart
- **Action**: Restart worker between `state.set()` and a subsequent `state.get()`.
- **Expected**: `state.get()` fetches the durable value directly from Postgres via synchronous IPC roundtrip.

### 3. Concurrent Updates
- **Action**: Two concurrent steps try to update the same state key.
- **Expected**: Last-writer-wins semantics apply, handled safely by Postgres `ON CONFLICT DO UPDATE`.

---

## Execution Timeline

### 1. Verification of Order
- **Action**: Run workflows with loops, children, and parallel steps.
- **Expected**: Dashboard Timeline strictly matches chronologically ordered semantic events and operational DB timestamps.

---

## Security

### 1. Cross-Tenant Run Access
- **Action**: Tenant A tries to fetch Tenant B's run using Tenant A's API key.
- **Expected**: API returns 404 Not Found.

### 2. API Key Revoke
- **Action**: Issue request with Key A. Revoke Key A. Issue request with Key A.
- **Expected**: Second request returns 401 Unauthorized.
