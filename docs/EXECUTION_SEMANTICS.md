# Axiom Engine — Execution Semantics

This document defines the precise semantics of durable execution, deterministic
replay, and workflow lifecycle in Axiom Engine.

## 1. Workflow Execution Model

A workflow is an async function that receives a `WorkflowContext` and an input
value, and returns an output value or throws an error.

```typescript
async (ctx: WorkflowContext<TInput, TOutput>, input: TInput): Promise<TOutput>
```

Execution proceeds as follows:

1. The Rust runtime loads the existing semantic event history for the run (empty for new runs).
2. The Rust runtime dispatches the event history to the TypeScript sidecar via `resume_workflow`.
3. The TypeScript sidecar enters **replay mode** if history is non-empty.
4. The workflow function is invoked from the beginning within the sidecar.
5. Each blocking call (`ctx.step.run()`, `ctx.sleep()`, etc.) is intercepted by the sidecar.
6. If a matching event exists in history → return recorded result (replay).
7. If no matching event exists → sidecar exits replay mode, pauses execution, and yields a command back to the Rust runtime.
8. The Rust runtime durably handles the command (e.g., dispatches step execution, records timer).
9. Upon completion, the Rust runtime appends the result event to history and resumes the sidecar with the updated history.
10. When the workflow function returns → sidecar yields a `CompleteWorkflow` command.
11. If the workflow function throws → sidecar yields a `FailWorkflow` command.

## 2. Semantic Event Catalog

Per ADR 0002, durable state is separated into:
- **Semantic Event History**: Append-only log of outcomes required for deterministic replay. Stored in the `events` table. Sent to the TypeScript sidecar.
- **Operational State**: Mutable state managed by Rust for execution bookkeeping. Stored in `step_executions`, `timers`, `signals`, `workflow_runs` tables. Never sent to the sidecar.

### 2.1 Definitive Semantic Event List

The following events are the **only** events that may exist in the `events` table. This list is authoritative and matches the PostgreSQL `CHECK` constraint.

| Event | Purpose | Producer | Consumer | Replay Consumes | Visible to Workflow | Terminal | May Repeat | Phase |
|-------|---------|----------|----------|-----------------|---------------------|----------|------------|-------|
| `WorkflowStarted` | Marks run initiation with input | Rust runtime | Replay cursor (implicit skip) | Yes (implicit) | No | No | No | 1 |
| `StepCompleted` | Records successful step outcome | Rust runtime | `ctx.step.run()` | Yes | Yes (return value) | No | No (per step_id) | 1 |
| `StepFailed` | Records terminal step failure | Rust runtime | `ctx.step.run()` | Yes | Yes (thrown error) | No | No (per step_id) | 1 |
| `TimestampRecorded` | Records deterministic wall-clock time | Rust runtime | `ctx.now()` | Yes | Yes (return value) | No | Yes (per call site) | 1 |
| `RandomRecorded` | Records deterministic random value | Rust runtime | `ctx.random()` | Yes | Yes (return value) | No | Yes (per call site) | 1 |
| `TimerFired` | Records that a sleep duration has elapsed | Rust runtime | `ctx.sleep()` | Yes | Yes (unblocks) | No | No (per timer_id) | 2 |
| `SignalReceived` | Records external signal delivery | Rust runtime | `ctx.waitForSignal()` | Yes | Yes (payload) | No | No (per signal_name) | 2 |
| `SignalTimedOut` | Records signal wait timeout | Rust runtime | `ctx.waitForSignal()` | Yes | Yes (thrown/returned) | No | No (per signal_name) | 2 |
| `WorkflowCompleted` | Records successful workflow completion | Rust runtime | End-of-workflow | Yes (terminal) | No | Yes | No | 1 |
| `WorkflowFailed` | Records workflow failure | Rust runtime | End-of-workflow | Yes (terminal) | No | Yes | No | 1 |
| `WorkflowCancelled` | Records workflow cancellation | Rust runtime | End-of-workflow | Yes (terminal) | No | Yes | No | 1 |
| `ChildWorkflowCompleted` | Records child workflow success | Rust runtime | `ctx.startChild()` | Yes | Yes | No | No | 4 |
| `ChildWorkflowFailed` | Records child workflow failure | Rust runtime | `ctx.startChild()` | Yes | Yes | No | No | 4 |

**Required fields for every semantic event:**
- `id` (UUID)
- `run_id` (UUID)
- `tenant_id` (UUID)
- `sequence_number` (BIGINT, monotonic per run)
- `event_type` (TEXT, from the list above)
- `step_id` (TEXT, nullable — set for Step*/Timer*/Signal* events)
- `data` (JSONB — event-specific payload)
- `timestamp` (TIMESTAMPTZ)

### 2.2 Operational State (NOT Semantic Events)

The following concepts are **not** semantic events. They do not appear in the `events` table and are never sent to the TypeScript sidecar.

| Concept | Where It Lives | Notes |
|---------|----------------|-------|
| Step scheduling (intent to execute) | `step_executions` table (status=`pending`) | Created when Rust receives `ScheduleStep` |
| Step execution start | `step_executions` table (status=`running`) | Updated when worker begins execution |
| Step retry attempt state | `step_executions` table (attempt column, status) | Incremented on each retry |
| Retry delay/schedule | `step_executions` table or scheduler polling | Managed by Rust runtime |
| Timer scheduling (intent to sleep) | `timers` table (status=`scheduled`) | Created when Rust receives `ScheduleTimer` |
| Signal wait registration | `signals` table (status=`pending`) | Created when Rust receives `AwaitSignal` |
| Lease ownership | `workflow_runs` table (worker_id, fence_token, lease_expires_at) | Managed by lease protocol |
| Worker heartbeat | `workers` table | Operational health |
| Run status transitions | `workflow_runs.status` | Managed by Rust |

## 3. Replay Algorithm (TypeScript Sidecar)

The TypeScript sidecar is completely stateless between executions. Upon receiving a `resume_workflow` message from the Rust runtime, it starts the workflow function from the beginning and uses the provided `history` array to resolve blocking calls without re-executing side effects.

### 3.1 Replay Cursor State Machine

The replay cursor has three modes:

```
┌─────────────────────────────────────────────────────────┐
│                  REPLAY MODE                             │
│  replayIndex < history.length                            │
│  Each API call consumes the next expected event          │
│  and returns the recorded value.                         │
│                                                          │
│  Transitions:                                            │
│    → LIVE MODE: when replayIndex reaches history.length  │
│    → TERMINAL:  when WorkflowCompleted/Failed/Cancelled  │
│                 is consumed                               │
│    → ERROR:     when next event does not match expected   │
└─────────────────────────────────────────────────────────┘
         │                                    │
         ▼                                    ▼
┌──────────────────┐               ┌──────────────────┐
│   LIVE MODE      │               │   ERROR MODE     │
│   replayIndex    │               │   DeterminismVio │
│   >= history.len │               │   lation thrown   │
│                  │               │                  │
│   API calls emit │               │   Yields         │
│   Commands to    │               │   FailWorkflow   │
│   Rust           │               │   command        │
└──────────────────┘               └──────────────────┘
```

### 3.2 Formal Replay Cursor Implementation

```typescript
type ReplayMode = "REPLAY" | "LIVE" | "TERMINAL" | "ERROR";

class WorkflowContext {
    private history: SemanticEvent[];
    private replayIndex: number = 0;
    private mode: ReplayMode = "REPLAY";
    private executedStepIds: Set<string> = new Set();

    constructor(history: SemanticEvent[]) {
        this.history = history;
        this.mode = history.length > 0 ? "REPLAY" : "LIVE";

        // Skip WorkflowStarted if present at index 0
        if (this.mode === "REPLAY" && this.history[0]?.type === "WorkflowStarted") {
            this.replayIndex = 1;
        }
    }

    /**
     * Attempt to consume the next event from history.
     *
     * @param expectedTypes - The event types this API call accepts.
     * @param expectedId - The expected step_id/timer_id/signal_name (if applicable).
     * @returns The consumed event, or null if we have transitioned to LIVE mode.
     * @throws DeterminismViolation if the next event does not match.
     */
    private consumeEvent(expectedTypes: string[], expectedId?: string): SemanticEvent | null {
        if (this.mode === "LIVE") {
            return null;
        }

        if (this.mode !== "REPLAY") {
            throw new Error(`Cannot consume events in ${this.mode} mode`);
        }

        // End of history → transition to LIVE
        if (this.replayIndex >= this.history.length) {
            this.mode = "LIVE";
            return null;
        }

        const event = this.history[this.replayIndex];

        // Check for terminal events
        if (["WorkflowCompleted", "WorkflowFailed", "WorkflowCancelled"].includes(event.type)) {
            this.mode = "TERMINAL";
            this.replayIndex++;
            // Terminal events are not consumed by workflow code.
            // The runtime will handle workflow completion.
            return event;
        }

        // Validate event type
        if (!expectedTypes.includes(event.type)) {
            this.mode = "ERROR";
            throw new DeterminismViolation(
                `Replay mismatch at index ${this.replayIndex}: ` +
                `expected one of [${expectedTypes.join(", ")}] ` +
                `but found ${event.type}`
            );
        }

        // Validate identifier (step_id, timer_id, signal_name)
        if (expectedId !== undefined && event.data?.id !== expectedId) {
            this.mode = "ERROR";
            throw new DeterminismViolation(
                `Replay mismatch at index ${this.replayIndex}: ` +
                `expected id "${expectedId}" but found "${event.data?.id}"`
            );
        }

        this.replayIndex++;
        return event;
    }
}
```

### 3.3 Per-API Replay Contracts

#### `ctx.step.run(stepId, fn, options)`

| Aspect | Specification |
|--------|---------------|
| Expected events | `StepCompleted` or `StepFailed` |
| Expected ID field | `event.data.id` must equal `stepId` |
| In REPLAY mode | Consumes event. Returns `event.data.output` (StepCompleted) or throws `event.data.error` (StepFailed). |
| In LIVE mode | Yields `ScheduleStep { step_id, options }` command. Workflow suspends. |
| Missing event | Transitions to LIVE. Yields `ScheduleStep`. |
| Wrong event type | `DeterminismViolation`. Yields `FailWorkflow`. |
| Wrong step_id | `DeterminismViolation`. Yields `FailWorkflow`. |
| Duplicate step_id | `DeterminismViolation` (checked before replay). |
| Phase | 1 |

#### `ctx.now()`

| Aspect | Specification |
|--------|---------------|
| Expected events | `TimestampRecorded` |
| Expected ID field | None (consumed positionally) |
| In REPLAY mode | Consumes event. Returns `event.data.value` (number, ms since epoch). |
| In LIVE mode | Yields `RecordTimestamp` command. Rust records wall-clock time, appends `TimestampRecorded`, resumes sidecar. |
| Missing event | Transitions to LIVE. Yields `RecordTimestamp`. |
| Wrong event type | `DeterminismViolation`. |
| Phase | 1 |

#### `ctx.random()`

| Aspect | Specification |
|--------|---------------|
| Expected events | `RandomRecorded` |
| Expected ID field | None (consumed positionally) |
| In REPLAY mode | Consumes event. Returns `event.data.value` (number). |
| In LIVE mode | Yields `RecordRandom` command. Rust generates random, appends `RandomRecorded`, resumes sidecar. |
| Missing event | Transitions to LIVE. Yields `RecordRandom`. |
| Wrong event type | `DeterminismViolation`. |
| Phase | 1 |

#### `ctx.sleep(timerId, duration)`

| Aspect | Specification |
|--------|---------------|
| Expected events | `TimerFired` |
| Expected ID field | `event.data.id` must equal `timerId` |
| In REPLAY mode | Consumes event. Returns immediately (timer already fired). |
| In LIVE mode | Yields `ScheduleTimer { timer_id, duration }` command. Rust creates timer in `timers` table (operational). When timer fires, Rust appends `TimerFired` to semantic history and resumes sidecar. |
| Missing event | Transitions to LIVE. Yields `ScheduleTimer`. |
| Wrong event type | `DeterminismViolation`. |
| Phase | 2 (stub throws "not implemented" in Phase 1) |

#### `ctx.waitForSignal(signalName, options?)`

| Aspect | Specification |
|--------|---------------|
| Expected events | `SignalReceived` or `SignalTimedOut` |
| Expected ID field | `event.data.id` must equal `signalName` |
| In REPLAY mode | Consumes event. Returns `event.data.payload` (SignalReceived) or throws/returns timeout (SignalTimedOut). |
| In LIVE mode | Yields `AwaitSignal { signal_name, timeout }` command. Rust creates entry in `signals` table (operational). When signal arrives, Rust appends `SignalReceived` and resumes sidecar. |
| Missing event | Transitions to LIVE. Yields `AwaitSignal`. |
| Wrong event type | `DeterminismViolation`. |
| Phase | 2 (stub throws "not implemented" in Phase 1) |

### 3.4 Replay Walkthrough Example

```
Semantic History:
  [0] WorkflowStarted { input: { orderId: 42 } }
  [1] StepCompleted   { id: "fetch-order",   output: { total: 100 } }
  [2] StepCompleted   { id: "charge-payment", output: { receipt: "r1" } }

Workflow Code:
  const order = await ctx.step.run("fetch-order", fetchFn);
  const payment = await ctx.step.run("charge-payment", chargeFn);
  const email = await ctx.step.run("send-email", emailFn);
  return { order, payment, email };

Execution Trace:
  1. Constructor: history.length=3, mode=REPLAY, skip WorkflowStarted → replayIndex=1
  2. ctx.step.run("fetch-order"):
     - mode=REPLAY, replayIndex=1
     - history[1] = StepCompleted, id="fetch-order" ✓
     - replayIndex=2, return { total: 100 }
  3. ctx.step.run("charge-payment"):
     - mode=REPLAY, replayIndex=2
     - history[2] = StepCompleted, id="charge-payment" ✓
     - replayIndex=3, return { receipt: "r1" }
  4. ctx.step.run("send-email"):
     - mode=REPLAY, replayIndex=3
     - replayIndex >= history.length → mode=LIVE
     - return null → yield Command.ScheduleStep({ step_id: "send-email" })
     - Workflow suspends.
  5. Rust executes "send-email", appends StepCompleted to history.
  6. Rust sends resume_workflow with updated history (4 events).
  7. Sidecar replays from beginning:
     - Steps 1-3 consume events as before
     - Step 4: history[3] = StepCompleted, id="send-email" ✓
     - replayIndex=4, return { sent: true }
  8. Workflow returns → yield Command.CompleteWorkflow({ output: ... })
```

## 4. Replay Invariants

The following invariants **must** hold during replay. Violation of any
invariant is a **fatal error** — the runtime must not continue.

### Invariant R1: Step ID Uniqueness

Within a single workflow execution, every step ID must be unique. Duplicate step IDs indicate a bug in the workflow definition and immediately trigger a fatal `DeterminismViolation`. To loop or execute dynamic steps, the workflow author must provide unique IDs (e.g., `step-id-${i}`).

### Invariant R2: Step Ordering Determinism

During replay, steps must be encountered in the same order they were
originally executed. If the workflow code has changed such that step ordering
differs, this is a determinism violation.

### Invariant R3: Event Type Consistency

A step that was recorded as `StepCompleted` must not produce a `StepFailed`
during replay, and vice versa. The runtime returns the recorded result and
does not re-execute.

### Invariant R4: History Completeness

If replay reaches the end of recorded history, the runtime transitions from
replay mode to live execution mode. This is normal. But if replay expects an
event and the history is truncated, this is a corrupted history error.

### Invariant R5: Version Compatibility

If the workflow version in the run metadata does not match the version of the
loaded workflow definition, the runtime must check compatibility. Incompatible
versions must not be replayed.

### Invariant R6: Serialization Roundtrip

Step outputs must survive serialization/deserialization. The runtime must use
a stable serialization format. Breaking changes to serialization are breaking
changes to all existing histories.

## 5. Determinism Requirements

### 5.1 What Must Be Deterministic

The **control flow** of the workflow function must produce the same sequence
of step executions every time it is replayed with the same history.

This means:

- Conditional branches must depend only on step results (which are replayed)
  and workflow input (which is fixed).
- Loops must iterate the same number of times.
- The order of `ctx.step.run()` calls must be the same.

### 5.2 What Is NOT Deterministic (and Must Use Runtime APIs)

| Operation | Forbidden in Workflow | Use Instead |
|-----------|----------------------|-------------|
| Current time | `Date.now()` | `ctx.now()` |
| Random numbers | `Math.random()` | `ctx.random()` |
| Sleep/delay | `setTimeout()` | `ctx.sleep()` |
| External side effects | Direct API calls (`fetch()`, DB writes) | `ctx.step.run()` |
| Environment variables | `process.env.*` | Workflow input or config |

### 5.3 Side-Effect Safety and Purity

The workflow function itself must be strictly pure and replay-safe. Any code written outside of `ctx.step.run()` must not mutate external state. The TypeScript SDK prevents premature execution during replay by simply skipping the invocation of the closure passed to `ctx.step.run()` if the step is not the active target. External side effects strictly belong inside `ctx.step.run()`.

### 5.4 Runtime-Provided Deterministic APIs

#### `ctx.now(): number`

Returns the current logical time in milliseconds.

- On first execution: Rust records the real wall-clock time as a `TimestampRecorded`
  event in semantic history.
- On replay: returns the recorded timestamp from semantic history.

#### `ctx.random(): number`

Returns a deterministic pseudo-random number.

- On first execution: Rust records the generated value as a `RandomRecorded`
  event in semantic history.
- On replay: returns the recorded value from semantic history.

#### `ctx.sleep(duration: string | number): Promise<void>`

Suspends the workflow for the specified duration.

- On first execution:
  - Sidecar yields `ScheduleTimer` command to Rust.
  - Rust creates a row in the `timers` operational table (status=`scheduled`).
  - Rust releases the workflow lease. The workflow is unloaded from memory.
  - When the timer fires, the scheduler updates the `timers` row (status=`fired`),
    appends a `TimerFired` event to semantic history, and re-dispatches the workflow.
- On replay: the sidecar consumes the `TimerFired` event without waiting.

#### `ctx.waitForSignal(name: string, options?): Promise<any>`

Suspends the workflow until a named signal is received.

- On first execution:
  - Sidecar yields `AwaitSignal` command to Rust.
  - Rust creates a row in the `signals` operational table (status=`pending`).
  - Rust releases the workflow lease. The workflow is unloaded.
  - When the signal arrives, Rust updates the `signals` row (status=`delivered`),
    appends a `SignalReceived` event to semantic history, and re-dispatches the workflow.
- On replay: the sidecar consumes the `SignalReceived` (or `SignalTimedOut`) event without waiting.

### Signal Edge Cases

- **Late signal** (signal arrives before `waitForSignal` is called): The signal
  is stored in the `signals` table. When `waitForSignal` is reached, Rust
  immediately appends `SignalReceived` and resumes.
- **Duplicate signal**: Only the first signal with a given name is recorded.
  Subsequent duplicates are ignored (configurable).
- **Signal with no waiter**: The signal is recorded and held. If the workflow
  never calls `waitForSignal` for that name, the signal is unused.
- **Timeout**: `waitForSignal` may optionally accept a timeout. If the signal
  does not arrive within the timeout, a `SignalTimedOut` event is recorded.

## 6. Step Execution Lifecycle

The Rust runtime manages step executions operationally. The TypeScript sidecar only sees the terminal outcome as a semantic event.

```
                    ┌────────────────────────────────────┐
                    │     OPERATIONAL STATE               │
                    │     (step_executions table)          │
                    │                                      │
                    │  ┌──────────┐                        │
                    │  │ pending  │                        │
                    │  └────┬─────┘                        │
                    │       │                              │
                    │       ▼                              │
                    │  ┌──────────┐                        │
                    │  │ running  │                        │
                    │  └────┬─────┘                        │
                    │       │                              │
                    │       ├── success ─┐                 │
                    │       │            │                 │
                    │       └── failure ─┼── retryable ──▶ back to pending (next attempt) │
                    │                    │                 │
                    └────────────────────┼─────────────────┘
                                         │
                                         ▼
                    ┌────────────────────────────────────┐
                    │     SEMANTIC HISTORY                 │
                    │     (events table)                   │
                    │                                      │
                    │  success → StepCompleted appended    │
                    │  non-retryable / exhausted           │
                    │           → StepFailed appended      │
                    │                                      │
                    │  Then: resume_workflow sent to        │
                    │        sidecar with updated history   │
                    └────────────────────────────────────┘
```

## 7. Timer Lifecycle

> [!NOTE]
> **Status: Planned (Phase 2)**
> 
> *In Phase 1, `ctx.sleep()` is a stub that throws `"Not implemented in Phase 1"`. The following operational flow outlines the planned Phase 2 lifecycle.*

**Planned operational flow** (not semantic events until `TimerFired`):

```
ctx.sleep("24h")
    │
    ▼ (sidecar yields ScheduleTimer command)
Rust creates timers row: { timer_id, run_id, status: "scheduled", due_at }
    │
    │ ── Rust releases lease, workflow unloaded ──
    │
    │ ── scheduler polls for due_at <= now() ──
    │
    ▼
Rust updates timers row: { status: "fired" }
Rust appends TimerFired event to semantic history
Rust re-dispatches workflow for replay
    │
    ▼
Sidecar replays, consumes TimerFired, continues after ctx.sleep()
```

### Planned Timer Guarantees

- Timers will be persisted in the PostgreSQL `timers` table (operational state).
- The scheduler will poll for due timers.
- Timer delivery will be at-least-once.
- Duplicate `TimerFired` events will be prevented by the `UNIQUE (run_id, timer_id)` constraint on the `timers` table — only one `TimerFired` semantic event will be appended per timer_id.
- Timer accuracy will be best-effort: the workflow resumes *at or after* the
  specified duration, never before.

## 8. Signal Lifecycle

> [!NOTE]
> **Status: Planned (Phase 2)**
> 
> *In Phase 1, `ctx.waitForSignal()` is a stub that throws `"Not implemented in Phase 1"`. The following operational flow outlines the planned Phase 2 lifecycle.*

**Planned operational flow** (not semantic events until `SignalReceived`):

```
ctx.waitForSignal("approval")
    │
    ▼ (sidecar yields AwaitSignal command)
Rust creates signals row: { signal_name, run_id, status: "pending" }
    │
    │ ── Rust releases lease, workflow unloaded ──
    │
    │ ── external system sends signal via API ──
    │
    ▼
Rust updates signals row: { status: "delivered", payload }
Rust appends SignalReceived event to semantic history
Rust re-dispatches workflow for replay
    │
    ▼
Sidecar replays, consumes SignalReceived, continues after ctx.waitForSignal()
```

## 9. Cancellation Semantics

### 9.1 Cancellation by Workflow State

| State | Cancellation Behavior |
|-------|-----------------------|
| Queued | Immediately cancelled. Never starts. |
| Running (in step) | `WorkflowCancelled` recorded. Current step may complete. |
| Sleeping | Timer cancelled. `WorkflowCancelled` recorded. |
| Waiting for signal | Wait cancelled. `WorkflowCancelled` recorded. |
| Retrying | Retry cancelled. `WorkflowCancelled` recorded. |
| Completed | No-op. Already terminal. |
| Failed | No-op. Already terminal. |
| Cancelled | No-op. Idempotent. |

### 9.2 Logical vs Physical Cancellation

**Logical cancellation**: The runtime marks the workflow as cancelled and
stops scheduling further work. This always succeeds.

**Physical cancellation**: Stopping an in-progress step execution (e.g., an
HTTP request to Stripe). This may or may not be possible depending on the
external system. Axiom does not guarantee that a cancelled step's side effects
are rolled back.

### 9.3 Cancellation Propagation

When a parent workflow is cancelled:

- Child workflows receive cancellation requests.
- Child workflow cancellation follows the same semantics.
- The parent does not wait indefinitely for children to cancel.

## 10. Retry Semantics

> [!NOTE]
> **Status: Partial / Planned (Phase 2)**
> 
> *In Phase 1, the `step_executions` table tracks `attempt` and `max_attempts` metadata, but automatic retry loops, exponential backoff, and jitter scheduling are not yet executed by the runtime. If a step execution fails in Phase 1, the runtime persists a `StepFailed` event immediately.*

The full planned design for configurable `RetryPolicy`, exponential backoff calculation, and jitter formulas has been moved to [`docs/RESEARCH.md`](RESEARCH.md#7-step-retry-policies-exponential-backoff--jitter-phase-2-design) in accordance with the project contributing guidelines.


## 11. Workflow Versioning

### 11.1 Version Identification

Each workflow definition has an explicit version (e.g., semantic version or
monotonic integer). The version is recorded in the run metadata at creation.

### 11.2 Compatibility Rules

A new version is **compatible** with an existing history if:

- All steps that have completed events in the history are still present in
  the new version in the same logical order.
- No completed step has been removed or reordered.

A new version is **incompatible** if:

- Steps have been removed that have completion events.
- Steps have been reordered relative to completion events.
- Step input/output types have changed incompatibly.

### 11.3 Incompatible Version Handling

The runtime must **fail closed**: if an incompatible version is detected
during replay, the run enters a `VERSION_MISMATCH` error state. It does not
silently re-execute steps.

## 12. Idempotency

### 12.1 Operation IDs

Every step execution is assigned a deterministic operation ID:

```
operationId = hash(workflowId, runId, stepId, attempt)
```

This operation ID can be used as an idempotency key for external APIs.

### 12.2 User-Provided Idempotency Keys

Users can provide explicit idempotency keys:

```typescript
ctx.step.run("charge", () => stripe.charge(...), {
  idempotencyKey: `charge-${ctx.runId}-${orderId}`
});
```

### 12.3 What Idempotency Does NOT Guarantee

Idempotency keys help when:

1. Axiom sends a request to Stripe.
2. Stripe succeeds.
3. Axiom crashes before recording `StepCompleted`.
4. On replay, Axiom re-sends the request with the same idempotency key.
5. Stripe recognizes the duplicate and returns the original result.

Idempotency keys do **not** help when:

- The external system does not support idempotency.
- The idempotency key window has expired.
- The external system has its own bugs.

**Axiom documents this explicitly. It does not claim exactly-once for
external side effects.**

## 13. Concurrency Control

### 13.1 Workflow Ownership

At any point in time, at most one worker may be actively executing a given
workflow run. This is enforced through leases.

### 13.2 Lease Protocol

Workflow ownership is managed via persistent, time-bound leases in the `workflow_runs` table using a monotonic `fence_token`. `SELECT ... FOR UPDATE SKIP LOCKED` may be used by the scheduler to efficiently *find* candidate runs for dispatch, but the atomic `UPDATE` is the sole mechanism for acquiring ownership.

**A. Lease Acquisition**

A worker attempts to acquire a run by atomically setting its `worker_id` and incrementing the `fence_token`. It only succeeds if the run is currently unowned or the previous lease has expired.

```sql
UPDATE workflow_runs
SET worker_id = $1,
    lease_expires_at = now() + interval '30 seconds',
    fence_token = fence_token + 1
WHERE id = $2
  AND status IN ('pending', 'running')
  AND (worker_id IS NULL OR lease_expires_at < now())
RETURNING fence_token;
```

If 0 rows are returned, the acquisition failed (run is owned by another worker or in a terminal state).

**B. Lease Renewal**

The owning worker must renew the lease periodically. The renewal must verify both `worker_id` and the current `fence_token`.

```sql
UPDATE workflow_runs
SET lease_expires_at = now() + interval '30 seconds'
WHERE id = $1 AND worker_id = $2 AND fence_token = $3;
```

If this update affects 0 rows, the worker's lease was stolen (it was too slow to renew), and it must immediately halt execution of this run.

**C. Lease Release**

When a worker gracefully suspends a run (e.g., waiting for a timer or signal), it releases the lease.

```sql
UPDATE workflow_runs
SET worker_id = NULL, lease_expires_at = NULL
WHERE id = $1 AND worker_id = $2 AND fence_token = $3;
```

**D. Lease Expiration and Reassignment**

When a worker crashes, its lease eventually expires (`lease_expires_at < now()`). The scheduler detects this via periodic polling and makes the run available for acquisition by another worker. The new worker acquires the lease (incrementing the fence token) and replays the semantic history.

**E. Stale Worker Behavior**

If a slow worker (e.g., hit a GC pause) resumes after its lease was stolen:
1. Any lease renewal attempt returns 0 rows → worker detects it lost ownership.
2. Any fenced state write is rejected → no corrupt state is written.
3. The worker must abandon execution of that run immediately.

**F. Terminal Workflow Ownership**

Terminal statuses (`completed`, `failed`, `cancelled`, `version_mismatch`) are not eligible for ownership. The `WHERE status IN ('pending', 'running')` clause in acquisition prevents this.

**G. PostgreSQL Unavailability**

If PostgreSQL is unavailable, lease acquisition, renewal, and all state writes fail. The worker cannot make progress. Upon PostgreSQL recovery, the system resumes. No data is lost because no state was committed.

**H. Lease Eligibility Matrix**

Workflow runs are only eligible for lease acquisition based on their `status`.

| Status | Eligible? | Reason |
|--------|-----------|--------|
| `pending` | **Yes** | Newly created or explicitly queued, ready to run. |
| `running` | **Yes** | Actively executing. Eligible if unowned or if the previous lease expired (worker crash). |
| `retrying` | **No** | Suspended, waiting for the scheduler to trigger the next retry attempt based on backoff. |
| `sleeping` | **No** | Suspended, waiting for a timer to fire. |
| `waiting`  | **No** | Suspended, waiting for an external signal. |
| `completed`, `failed`, `cancelled`, `version_mismatch` | **No** | Terminal state. Execution is permanently finished. |

The scheduler is responsible for transitioning `retrying`, `sleeping`, and `waiting` runs back to `pending` when their respective conditions are met (timer fires, signal received, retry delay elapses). This ensures workers do not hold leases on idle workflows. The acquisition SQL `WHERE status IN ('pending', 'running')` strictly enforces this matrix.

### 13.3 Fenced State Writes

Every state mutation performed by the worker (e.g., appending an event, updating step status) must be performed in a PostgreSQL transaction that verifies the `fence_token`.

```sql
-- Fenced Event Append
WITH run_check AS (
    SELECT id FROM workflow_runs
    WHERE id = $1 AND fence_token = $2
    FOR UPDATE
)
INSERT INTO events (run_id, tenant_id, sequence_number, event_type, step_id, data)
SELECT $1, $3, $4, $5, $6, $7
FROM run_check;
```

If `run_check` returns 0 rows (fence_token has changed), the INSERT produces 0 rows, the transaction is effectively a no-op, and the worker detects the stale fence. This prevents split-brain corruption.
