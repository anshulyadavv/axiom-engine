# Axiom Engine — IPC Protocol v1 (Phase 1)

## 1. Overview

The TypeScript sidecar communicates with the Rust worker over standard input and output (stdin/stdout) using JSON-Lines (NDJSON).
Each line is a complete JSON object terminated by `\n`.

The Rust worker acts as the parent process and manages all durable state. The TypeScript sidecar is completely stateless between resumptions per ADR 0001.

### 1.1 Protocol Version

This document defines IPC Protocol version `1`. The `type` field of every message implicitly identifies the protocol version. Future protocol changes will introduce new message types or a `protocol_version` field; version 1 has no such field.

## 2. Core Principles

- **Stateless Sidecar**: The sidecar holds no state between workflow resumptions. Every `resume_workflow` provides the full semantic event history.
- **Request-Response**: Every Rust→TS message expects exactly one TS→Rust response. There are no unsolicited messages from the sidecar.
- **Correlation**: Every request includes a `correlation_id` (UUID string). The response must return the exact same `correlation_id`.
- **One-at-a-time**: Rust sends one request, waits for one response. No pipelining in v1.

### 2.1 Registry Resolution Contract

To execute code, the sidecar must resolve the incoming names and IDs to actual executable TypeScript functions.

**Workflow Resolution**:
When `resume_workflow` is received, the sidecar uses `workflow_name` to look up the registered workflow generator function in its global registry.
- If the workflow name is not found, the sidecar yields a `FailWorkflow` command with a `WorkflowNotFoundError`.
- If the workflow name is found but the `workflow_version` is incompatible, it yields a `FailWorkflow` command with a `VersionMismatchError`.

**Step Resolution**:
When `execute_step` is received, the sidecar must resolve `step_id` to an executable function. Because steps in Axiom may be defined as inline closures (e.g., `ctx.step.run("charge", () => ...)`), the sidecar achieves resolution by performing a stateless **AST Replay**:
1. It instantiates the workflow function (identified by `workflow_name` and `workflow_version`) with the provided `input`.
2. It evaluates the workflow from the beginning using the provided `history` array to skip previously completed steps.
3. Because the workflow function is strictly pure and side-effect free outside of `ctx.step.run`, this AST Replay is computationally cheap and completely safe.
4. When the AST evaluation reaches the `ctx.step.run` call matching the requested `step_id`, the sidecar halts replay and **invokes the attached closure**, executing the actual side effect.
Alternatively, if the step is globally registered (e.g., `axiom.step("charge", ...)`), the sidecar can resolve and execute it directly from the registry without replaying the workflow. If the `step_id` cannot be resolved by either method, it returns a `step_result` with `status: "failure"` and `StepNotFoundError`.

## 3. Message Envelope

Every message (both directions) follows this schema:

```json
{
  "type": "<message_type>",
  "correlation_id": "<uuid>",
  "payload": { ... }
}
```

- `type` (string, required): One of the defined message types below.
- `correlation_id` (string, required): UUID linking request to response.
- `payload` (object, required): Message-specific data.

## 4. Rust → TypeScript Messages

### 4.1 `resume_workflow`

Instructs the sidecar to replay a workflow from the beginning using the provided semantic history, and yield the next command.

**Payload fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `run_id` | string (UUID) | Yes | The workflow run ID |
| `workflow_name` | string | Yes | The registered name of the workflow function |
| `workflow_version` | number | Yes | The version of the workflow definition |
| `input` | any (JSON) | Yes | The initial input provided when the run was started |
| `history` | array | Yes | Ordered array of semantic events (from the `events` table) |

Each element in `history` has:
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Semantic event type (e.g., `WorkflowStarted`, `StepCompleted`) |
| `sequence_number` | number | Yes | Monotonic position in history |
| `data` | object | Yes | Event-specific payload (contains `id`, `output`, `error`, `value`, etc.) |

**Example:**
```json
{
  "type": "resume_workflow",
  "correlation_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "payload": {
    "run_id": "550e8400-e29b-41d4-a716-446655440000",
    "workflow_name": "order_flow",
    "workflow_version": 1,
    "input": { "orderId": 42 },
    "history": [
      { "type": "WorkflowStarted", "sequence_number": 1, "data": { "input": { "orderId": 42 } } },
      { "type": "StepCompleted", "sequence_number": 2, "data": { "id": "charge", "output": { "status": "ok" } } }
    ]
  }
}
```

**Expected response:** `command`.

### 4.2 `execute_step`

Instructs the sidecar to execute a specific step function (the actual side-effecting code).

**Payload fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `run_id` | string (UUID) | Yes | The workflow run ID |
| `step_id` | string | Yes | The step ID to execute |
| `attempt` | number | Yes | Current attempt number (1-based). Used for idempotency key generation. |
| `workflow_name` | string | Yes | The registered name of the workflow function |
| `workflow_version` | number | Yes | The version of the workflow definition |
| `input` | any (JSON) | Yes | The initial input provided when the run was started |
| `history` | array | Yes | Ordered array of semantic events (from the `events` table) |

**Example:**
```json
{
  "type": "execute_step",
  "correlation_id": "e5f6g7h8-i9j0-k1l2-m3n4-o5p6q7r8s9t0",
  "payload": {
    "run_id": "550e8400-e29b-41d4-a716-446655440000",
    "step_id": "charge",
    "attempt": 1,
    "workflow_name": "order_flow",
    "workflow_version": 1,
    "input": { "orderId": 42 },
    "history": [
      { "type": "WorkflowStarted", "sequence_number": 1, "data": { "input": { "orderId": 42 } } }
    ]
  }
}
```

**Expected response:** `step_result`.

## 5. TypeScript → Rust Messages

### 5.1 `command`

Yielded by the sidecar in response to `resume_workflow`. Indicates what the workflow wants to do next.

**Payload fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `command_type` | string | Yes | One of: `ScheduleStep`, `CompleteWorkflow`, `FailWorkflow` |

Additional fields depend on `command_type`:

#### `ScheduleStep`
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `step_id` | string | Yes | The ID of the step to schedule |
| `options` | object | No | Step options (retry_policy, timeout, idempotency_key) |

```json
{
  "type": "command",
  "correlation_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "payload": {
    "command_type": "ScheduleStep",
    "step_id": "send_email",
    "options": {
      "retry_policy": { "max_attempts": 3, "initial_delay": 1000, "backoff_multiplier": 2 }
    }
  }
}
```

#### `CompleteWorkflow`
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `output` | any (JSON) | Yes | The workflow's return value |

```json
{
  "type": "command",
  "correlation_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "payload": {
    "command_type": "CompleteWorkflow",
    "output": { "success": true, "orderId": 42 }
  }
}
```

#### `FailWorkflow`
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `error` | object | Yes | Error details |
| `error.message` | string | Yes | Human-readable error message |
| `error.type` | string | No | Error type/class name |
| `error.stack` | string | No | Stack trace |
| `error.is_determinism_violation` | boolean | No | True if this failure is due to replay mismatch |

```json
{
  "type": "command",
  "correlation_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "payload": {
    "command_type": "FailWorkflow",
    "error": {
      "message": "Replay mismatch at index 2: expected StepCompleted but found TimerFired",
      "type": "DeterminismViolation",
      "is_determinism_violation": true
    }
  }
}
```

### 5.2 `step_result`

Returned by the sidecar in response to `execute_step`, after the step function has completed.

**Payload fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | string | Yes | `"success"` or `"failure"` |
| `output` | any (JSON) | If success | The step function's return value |
| `error` | object | If failure | Error details |
| `error.message` | string | Yes (if error) | Human-readable error message |
| `error.type` | string | No | Error type/class name |
| `error.is_retryable` | boolean | No | Hint to Rust whether this error should be retried (default: true) |

**Success example:**
```json
{
  "type": "step_result",
  "correlation_id": "e5f6g7h8-i9j0-k1l2-m3n4-o5p6q7r8s9t0",
  "payload": {
    "status": "success",
    "output": { "receipt": "rcpt_999" }
  }
}
```

**Failure example:**
```json
{
  "type": "step_result",
  "correlation_id": "e5f6g7h8-i9j0-k1l2-m3n4-o5p6q7r8s9t0",
  "payload": {
    "status": "failure",
    "error": { "message": "Connection refused", "type": "NetworkError", "is_retryable": true }
  }
}
```

## 6. Interaction Sequences

### 6.1 New Workflow (No History)

```
Rust                              TypeScript
  │                                    │
  │── resume_workflow ────────────────▶│  (empty history)
  │                                    │  workflow starts
  │                                    │  ctx.step.run("A") → no event → LIVE
  │◀── command(ScheduleStep,"A") ─────│
  │                                    │
  │── execute_step("A", attempt=1) ──▶│
  │                                    │  runs step function
  │◀── step_result(success, output) ──│
  │                                    │
  │  Rust appends StepCompleted(A)     │
  │  to events table                   │
  │                                    │
  │── resume_workflow ────────────────▶│  (history: [Started, StepCompleted(A)])
  │                                    │  replay: consume StepCompleted(A)
  │                                    │  ctx.step.run("B") → no event → LIVE
  │◀── command(ScheduleStep,"B") ─────│
  │                                    │
  ...
```

### 6.2 Crash Recovery (Replay)

```
Rust                              TypeScript
  │                                    │
  │  Worker crashed after StepCompleted(A) was recorded.
  │  New worker acquires lease (fence_token incremented).
  │  Loads history: [Started, StepCompleted(A)]
  │                                    │
  │── resume_workflow ────────────────▶│  (history has StepCompleted(A))
  │                                    │  ctx.step.run("A") → consume event → return output
  │                                    │  ctx.step.run("B") → no event → LIVE
  │◀── command(ScheduleStep,"B") ─────│
  │                                    │
  ... (normal execution continues)
```

## 7. Error Handling & Edge Cases

### 7.1 Timeouts

Rust enforces a configurable timeout on every IPC call using `tokio::time::timeout` wrapping the entire receive loop (including any intermediate `state_request` round-trips):
- `execute_step`: configurable via `AXIOM_IPC_STEP_TIMEOUT_MS` (default: 30,000 ms / 30 seconds).
- `resume_workflow`: configurable via `AXIOM_IPC_RESUME_TIMEOUT_MS` (default: 10,000 ms / 10 seconds).

If the sidecar does not respond within the timeout:
1. Rust logs the timeout error.
2. Rust kills the sidecar process (`child.kill().await` and reaps with `child.wait().await`).
3. Rust returns a typed error (`SidecarError::Timeout { operation, timeout }`).
4. For `execute_step`: the consumer intercepts the timeout, records a failed step attempt (`StepFailed` event in `events` table and status `Failed` in `step_executions`), and releases the lease so the scheduler can evaluate the retry policy.
5. For `resume_workflow`: the scheduler catches the timeout and transitions the workflow run to terminal `Failed` status (appending `WorkflowFailed` to history) instead of spinning indefinitely on lease reacquisition.

### 7.2 Sidecar Crash

If the sidecar process exits unexpectedly:
1. Rust detects the process exit via the stdin/stdout pipe closing.
2. Rust restarts the sidecar process.
3. Any in-flight `execute_step` is treated as a failed attempt.
4. Any in-flight `resume_workflow` is retried with the same history.

### 7.3 Malformed Messages

If the sidecar sends:
- Non-JSON text → Rust logs the error, kills the sidecar, and treats it as a crash.
- Valid JSON but missing required fields → Same as above.
- Unknown `type` → Same as above.
- Wrong `correlation_id` → Rust logs a correlation mismatch warning, kills the sidecar.

### 7.4 Determinism Violation

If the sidecar detects a `DeterminismViolation` during replay:
1. The sidecar catches the error.
2. The sidecar yields `command` with `command_type: "FailWorkflow"` and `error.is_determinism_violation: true`.
3. Rust marks the run as `failed` with a determinism violation error. The run is NOT retried.

### 7.5 State Ownership During Suspension

When the sidecar yields a `ScheduleStep` command:
- The sidecar suspends the workflow coroutine but stays alive.
- Rust may send `execute_step` for that step (or another step from a different run).
- After step completion, Rust sends a new `resume_workflow` (with updated history).
- The sidecar discards the old suspended coroutine and replays from scratch.

When the sidecar yields `CompleteWorkflow` or `FailWorkflow`:
- The sidecar discards the coroutine.
- Rust will NOT send further messages for this run.

## 8. Phase 2 Extensibility

Phase 2 will add new command types for timers and signals. The protocol is extensible:

- New `command_type` values: `ScheduleTimer`, `AwaitSignal`, `RecordTimestamp`, `RecordRandom`.
- The message envelope (`type`, `correlation_id`, `payload`) remains unchanged.
- Rust must ignore unknown fields in payloads (forward compatibility).
- The sidecar must not send command types that the Rust worker doesn't understand.
