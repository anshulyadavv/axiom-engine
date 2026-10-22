# Axiom Engine Research & Benchmarks

This document tracks empirical measurements, performance characteristics, and architectural experiments for Axiom Engine.

### Test Environment (2026-10-21)
- **CPU:** Intel(R) Core(TM) i3-1005G1 CPU @ 1.20GHz (2 physical cores, 4 logical processors)
- **RAM:** 7.80 GB (8,375,230,464 bytes)
- **OS:** Microsoft Windows 10 Pro (Version 10.0.19045, Build 19045)
- **PostgreSQL:** 15.19 on x86_64-pc-linux-musl, compiled by gcc (Alpine 15.2.0) 15.2.0, 64-bit (local Docker Compose environment measured; CI uses postgres:16)
- **NATS:** nats-server v2.10.29 (Docker)

## 1. Recovery Latency
**Methodology:** Kill an active worker during step execution and measure the time from failure to resumption by a new worker.
**Hypothesis:** Recovery time equals `Remaining Lease TTL + Scheduler Poll Jitter + Replay/Spawn Overhead`.
**Command:** `powershell -File scripts/benchmark.ps1 -Command recovery -Runs 10 -LeaseTtlMs 5000`
**Date:** 2026-10-21
**Raw Data:** `benchmarks/results/recovery_latency.json`

> **Note on Lease Configuration**: The measured 2.3–6.3 s recovery latency was recorded using `AXIOM_LEASE_TTL_MS=5000` (5-second test lease). At the production default lease of 30 seconds (`AXIOM_LEASE_TTL_MS=30000`), recovery latency is approximately the remaining lease TTL plus poll jitter (typically 15 to 30 seconds).

**Measured Component Breakdown (10 trials, instrumented):**
Timestamps are instrumented at:
1. `kill_time`: Instant Worker 1 is hard-killed (`kill -9`)
2. `lease_expires_at`: Worker 1's active lease expiry timestamp read from PostgreSQL `workflow_runs.lease_expires_at`
3. `claim_time`: Exact moment Worker 2 claims the run via `poll_run` (logged in worker log and DB `workflow_runs.updated_at`)
4. `first_replayed_event`: Moment Worker 2's TypeScript sidecar consumes the first past event (`StepCompleted` for `step1`) during deterministic replay

| Component | Interval Definition | Min | Median | Max |
|---|---|---|---|---|
| **Remaining Lease TTL** | `lease_expires_at - kill_time` | 2,253.59 ms (~2.25 s) | 2,762.59 ms (~2.76 s) | 4,619.14 ms (~4.62 s) |
| **Scheduler Poll Jitter** | `claim_time - lease_expires_at` | 54.36 ms (~0.05 s) | 1,492.48 ms (~1.49 s) | 1,681.89 ms (~1.68 s) |
| **Sidecar Spawn & First Replay** | `first_replayed_event - claim_time` | 240.56 ms (~0.24 s) | 289.61 ms (~0.29 s) | 572.18 ms (~0.57 s) |
| **Total Recovery Latency** | `claim_time - kill_time` | 2,307.95 ms (~2.31 s) | 4,293.25 ms (~4.29 s) | 6,301.03 ms (~6.30 s) |

*Note: p95/p99 are omitted because n = 10 < 100; reporting min/median/max only.*

**Expected Composition (Estimated):**
- **Remaining Lease TTL:** Estimated at ~3,800 ms when killed ~1.2 s into a fresh 5,000 ms lease. In practice, depending on whether step 1 and step 2 dispatch transactions renewed the lease, observed remaining TTL ranged from 2,253 ms to 4,619 ms.
- **Scheduler Poll Jitter:** Estimated at 0 to 2,000 ms (uniform distribution, average 1,000 ms with `AXIOM_SCHEDULER_POLL_MS=2000`). Measured jitter spanned 54 ms to 1,682 ms (median 1,492 ms).
- **Sidecar Spawn & Step 1 Replay:** Estimated at 150 to 300 ms. Measured interval from lease acquisition to first replayed event averaged 289.6 ms (min 240.6 ms, max 572.2 ms).
- **Total Recovery Window:** The observed median total recovery of 4,293 ms aligns directly with measured `Remaining Lease TTL (2,763 ms) + Scheduler Poll Jitter (1,492 ms)`. Replay completes an additional ~290 ms after lease acquisition.

**Re-Execution Invariant Verification:**
In all 10 trials, Step 1 was verified to have executed exactly once (0 duplicate executions in the verification record file) and 0 `DeterminismViolation` events occurred across all recovery runs.

## 2. Replay Overhead
**Methodology:** Send `resume_workflow` payloads to the TypeScript sidecar with histories containing 10, 100, and 1,000 past events.
**History Length Definition:** The count of past `StepCompleted` semantic events passed in the `history` array of the IPC `resume_workflow` payload (replaying `step_0` through `step_{N-1}` in `loop_workflow`).
**Timing Definition:** Timing begins when the JSON `resume_workflow` request line is written to the sidecar process's `stdin` pipe and ends when the complete JSON response line (`ScheduleStep` or `CompleteWorkflow`) is read and parsed from `stdout`. Sidecar process spawn and initial V8 cold start are **NOT** included (the sidecar process is pre-spawned and kept warm).
**Command:** `powershell -File scripts/benchmark.ps1 -Command replay -Runs 20 -WarmupRuns 5`
**Date:** 2026-10-21
**Raw Data:** `benchmarks/results/replay_overhead.json`

**Cold-Start Artifact Investigation:**
In initial un-warmed tests, 10 events took ~35.6 ms while 100 events took ~1.1 ms. Investigation confirmed this was a V8 runtime cold-start artifact: the first request sent to a newly spawned Node.js sidecar incurs one-time V8 JIT compilation, script module evaluation, and initial memory pool allocations. Subsequent invocations reuse warm compiled code. Adding a warm-up phase of K=5 discarded iterations prior to taking benchmark measurements completely eliminates this cold-start artifact.

**Measurements (20 repetitions per history length):**
- **10 events:** Min: 0.3039 ms | Median: 0.4982 ms | Max: 1.5746 ms
- **100 events:** Min: 0.4979 ms | Median: 0.8716 ms | Max: 33.9053 ms
- **1,000 events:** Min: 1.9205 ms | Median: 3.3889 ms | Max: 22.2176 ms

*Note: p95/p99 are omitted because n = 20 < 100; reporting min/median/max only. With warm-up, replay latency scales strictly monotonically with event history length.*

## 3. Checkpoint vs Event Replay
**Note:** Checkpointing is *not* currently implemented in Axiom. This section is a future research experiment to evaluate when the event log becomes too long and requires state snapshotting.
**Experiment Design:** Implement an optional `SaveState` checkpoint at 10,000 events. Measure replay latency with and without the checkpoint.
**Measurements:**
- [not measured] (Checkpointing is not implemented in Axiom Phase 1 runtime)

## 4. Run-Creation Requests Accepted Per Second (API Only)
**Scope & Limitation:** This experiment measures run-creation requests accepted per second by the REST API Gateway. It measures synchronous HTTP run persistence and transactional outbox insertion; **it does NOT measure workflow execution or workflow completion by worker processes.**

**Rate Limiter Behavior:**
The REST API gateway enforces tenant-scoped rate limiting on run creation (`/workflows/:id/runs`). The default limiter uses a token bucket configured for 1,000 runs per minute (`AXIOM_RATE_LIMIT_RUNS_PER_MIN=1000`) with burst capacity equal to the bucket size (1,000 tokens) refilling at `1000 / 60` ≈ 16.67 tokens/second. The default limiter (1000/min per tenant, token bucket with burst) throttles sustained load above ~16.7 req/s.

**Methodology:** Launch 1,000 run-creation requests with a concurrency of 20 to `/workflows/:id/runs`, repeated across 3 consecutive trials for each limiter configuration.
**Commands:** `powershell -File scripts/benchmark.ps1 -Command throughput -Runs 1000 -Concurrency 20 -Trials 3`
**Date:** 2026-10-21
**Raw Data:** `benchmarks/results/throughput.json`

| Limiter Configuration | Metric | Min | Median | Max | Error Count (429s) |
|---|---|---|---|---|---|
| **Rate Limiter Disabled** (`AXIOM_RATE_LIMIT_DISABLED=1`) | Requests accepted / sec | 80.26 req/sec | **100.02 req/sec** | 103.23 req/sec | 0 (all 1,000 accepted per trial) |
| **Default Rate Limiter** (1000/min per tenant token bucket) | Requests accepted / sec | 15.28 req/sec | **34.60 req/sec** | 70.16 req/sec | Min: 0 \| Median: 616 \| Max: 808 |

*Operational Detail on Default Limiter Trials:*
- **Trial 1 (Fresh Bucket Burst):** A newly initialized token bucket with a full burst capacity of 1,000 tokens accepted all 1,000 requests in 14.254 s (70.16 req/sec, 0 errors).
- **Trial 2 (Partially Refilled):** Running immediately after Trial 1 with an empty initial bucket accepted 384 requests while 616 received HTTP 429 over 11.099 s (34.60 accepted req/sec).
- **Trial 3 (Sustained Rate):** With the burst capacity depleted, the limiter throttled throughput to the sustained refill rate, accepting 192 requests and rejecting 808 with HTTP 429 over 12.567 s (15.28 accepted req/sec, matching the ~16.7 req/s refill limit).

### 4.1 Outbox Dispatch Lag Under Load
**Methodology:** Measure the latency between the transactional insertion of an outbox message and its successful publication to NATS JetStream by the worker's `OutboxRelayer`.

**Relayer Architecture & Drain Rate Calculation:**
In `crates/axiom-worker/src/relayer.rs`:
- **Claim Batch Size:** 50 messages per iteration (`self.db.claim_messages(50).await?`, line 24).
- **Loop Sleep Interval:** 500 ms (`sleep(Duration::from_millis(500)).await`, line 18).
- **Theoretical Maximum Drain Rate:** 50 messages / 0.500 s = **100 messages/sec**.

**Offered Load vs Queueing Delay:**
When messages are inserted faster than 100 msgs/s (such as 50 messages every 250 ms ≈ 200 msgs/s), the outbox table accumulates backlog, and measured lag reflects queueing delay from overload rather than relay latency. To distinguish true dispatch latency from queueing backlog, two modes are evaluated with at least 1,000 samples each:
1. **Steady State Mode:** Inserting 25 messages every 500 ms (~50 messages/s, ~50% of the computed drain rate). Offered load remains strictly within relayer capacity.
2. **Burst Mode (Offered Load Above Drain Rate):** Inserting 50 messages every 250 ms (~200 messages/s, 2x computed drain rate).

**Consumer & Sidecar Isolation:**
Synthetic benchmark rows use topic `axiom.benchmarks` with `{}` payload. While `AXIOM_WORK` stream routes subjects `axiom.>` to `WorkerConsumer` (`crates/axiom-worker/src/consumer.rs`), the consumer fails to deserialize `{}` as `WorkMessage`, logs a deserialization error, and drops the message. The consumer never invokes the TypeScript sidecar, executes 0 steps, and causes zero side effects or database mutations. A cleanup query cancels any active workflow runs before collection to prevent scheduler sidecars.

**Timestamp Definitions (Two Timestamps):**
- **Timestamp 1 (`msg.created_at`):** The PostgreSQL `TIMESTAMPTZ` recorded when the transaction inserted the outbox row into `outbox_messages` via SQL `now()`.
- **Timestamp 2 (`chrono::Utc::now()`):** The local UTC wall-clock timestamp recorded in `OutboxRelayer` (`crates/axiom-worker/src/relayer.rs`, line 31) when the outbox message is claimed and published to NATS JetStream.
- **Clock Skew:** Both PostgreSQL and the worker run on the same physical host (`localhost`), so distributed clock skew is negligible.

**Date:** 2026-10-21  
**Raw Data:** `benchmarks/results/outbox_lag.json`

| Mode | Sample Count | Offered Load | Min Lag | Median (p50) | Average Lag | p95 Lag | p99 Lag | Max Lag |
|---|---|---|---|---|---|---|---|---|
| **Steady State (~50% Drain Rate)** | 1,000 msgs | ~50 msgs/s | **48 ms** | **383 ms** | 367.69 ms | **601 ms** | 682 ms | **753 ms** |
| **Burst (Offered Load > Drain Rate)** | 1,000 msgs | ~200 msgs/s | **28 ms** | **3,200 ms** | 3,141.15 ms | **6,190 ms** | 6,382 ms | **6,411 ms** |

*Analysis:*
- In **steady state**, the median lag of 383 ms directly reflects the 500 ms relayer poll loop (uniform random arrivals wait an average of 250–350 ms). The p95 is 601 ms and max is 753 ms, confirming that messages are drained in the next immediate relayer cycle without backlog accumulation.
- In **burst mode**, offered load (200 msgs/s) exceeds drain capacity (100 msgs/s), creating a queue backlog that grows by ~100 messages/s. The observed median of 3,200 ms and p95 of 6,190 ms represent queue dwell time while earlier batches are drained.

### 4.2 End-to-End Workflow Completion Throughput
**Scope:** Submits M runs of a sequential 3-step workflow (`crash_recovery_workflow`) and measures wall-clock time from submission until all runs reach `Completed`. This is reported separately from the API run-creation number.

**Settings:**
- Workflow: `crash_recovery_workflow` (3 sequential steps: `step1` -> `step2` -> `step3` -> `Completed`)
- Runs per trial (M): 5
- Trials: 5
- Worker Count: 1
- Scheduler Poll Interval (`AXIOM_SCHEDULER_POLL_MS`): 2000 ms
- Commands:
  - Before: `powershell -File scripts/benchmark.ps1 -Command e2e-throughput -Runs 5 -WorkerCount 1 -PollIntervalMs 2000 -Trials 5 -SleepAlways`
  - After: `powershell -File scripts/benchmark.ps1 -Command e2e-throughput -Runs 5 -WorkerCount 1 -PollIntervalMs 2000 -Trials 5`

**Before vs After Immediate Scheduler Repoll (5 Trials Each):**
Prior to optimization, the scheduler loop slept the full 2,000 ms idle interval unconditionally on every iteration, even after claiming and processing a run. In the optimized implementation, the scheduler sleeps `AXIOM_SCHEDULER_POLL_MS` (2,000 ms) **only** when `poll_run` returns no run (`Ok(false)`), and polls again immediately (`yield_now`) when a run was handled (`Ok(true)`).

| Metric | Before (`AXIOM_SCHEDULER_SLEEP_ALWAYS=1`) | After (Default: repoll on work, sleep only on empty poll) | Ratio of Medians |
|---|---|---|---|
| **Trials Completed** | 5 / 5 | 5 / 5 | — |
| **Runs per Trial** | 5 | 5 | Identical |
| **Worker Count** | 1 | 1 | Identical |
| **Scheduler Poll Interval** | 2000 ms | 2000 ms | Identical |
| **Total Wall-Clock Time (s)** | Min: 48.079 s \| **Median: 50.142 s** \| Max: 51.153 s | Min: 11.172 s \| **Median: 13.323 s** \| Max: 14.914 s | **3.76x faster** (-73.4% median time) |
| **Completed Runs / sec** | Min: 0.10 \| **Median: 0.10** \| Max: 0.10 runs/sec | Min: 0.34 \| **Median: 0.38** \| Max: 0.45 runs/sec | **3.80x higher** |
| **time from submission to Completed (includes queue wait; all runs submitted at once) (ms)** | Min: 11,801.62 ms \| **Median: 42,964.42 ms** \| Max: 51,012.05 ms | Min: 6,495.51 ms \| **Median: 9,907.49 ms** \| Max: 14,852.89 ms | **4.34x faster** (-76.9% median latency) |

**Empirically Measured Bottlenecks:**
The following bottlenecks were directly measured and observed during benchmark execution:
1. **Unconditional Scheduler Idle Delay**: In the "Before" configuration, each workflow run required 4 scheduler passes (initial schedule, step 2 schedule, step 3 schedule, and workflow completion). With a single worker and 5 queued runs, the 2,000 ms unconditional sleep inserted ~30+ cumulative seconds of idle delay across the 20 total scheduler iterations.
2. **Single-Run Poll Granularity (`LIMIT 1`)**: In `crates/axiom-storage/src/pg/run.rs`, `poll_run` claims runs with `FOR UPDATE SKIP LOCKED LIMIT 1`. Only a single run can be claimed per poll, meaning concurrent runs cannot be batched in a single poll query and must be evaluated sequentially across loop iterations.
3. **Per-Turn Node.js Process Spawns**: Tracing logs show that `SidecarProcess::spawn(&self.script_path)` is executed on every workflow turn in the scheduler and on every step execution in the consumer. In Windows testing, each `node packages/sdk/dist/app.js` spawn takes 150–250 ms to launch V8, load the bundle, and initialize stdio IPC. Across 5 runs with 3 steps each, 35 separate process spawn-and-exit cycles occurred (7 per run), contributing ~1.2–1.8 s of sidecar creation latency per run.
4. **Outbox Relayer Interval**: The transactional outbox relayer loop in `crates/axiom-worker/src/relayer.rs` polls every 500 ms (`sleep(Duration::from_millis(500)).await;`), introducing an observed 36–673 ms (avg ~340 ms) delay before step execution intents reach NATS JetStream.

## 5. Storage Overhead
**Methodology:** Run `scripts/storage-report.sql` after completing 10,000 workflows.
**Hypothesis:** Given the data model, storage size scales proportionally to `Workflows * (1 + 2 * Steps)` rows.
**Measurements:**
- DB Size per 10k workflows: [not measured] (Evaluated 1,000 workflows in throughput benchmark; 10,000 workflow long-run benchmark scheduled for scale testing phase)

## 6. Duplicate Execution Behavior
**Methodology:** Use `AXIOM_CHAOS_NATS_DUPLICATE_RATE` to intentionally duplicate 50% of NATS messages.
**Hypothesis:** The idempotency guard on `step_executions` and the atomic `fence_token` validation guarantees zero duplicate side-effects.
**Observations:**
- [not measured] (Evaluated in integration test suite `crates/axiom-worker/tests/nats_dispatch.rs`; manual chaos benchmark run scheduled for separate soak test)

## 7. Step Retry Policies, Exponential Backoff & Jitter (Phase 2 Design)

*Moved from `docs/EXECUTION_SEMANTICS.md` as this feature is currently in design/planned status for Phase 2.*

### 7.1 Planned Retry Policy Interface
```typescript
interface RetryPolicy {
  maxAttempts: number;        // Maximum number of attempts (including initial)
  initialDelay: number;       // Initial backoff delay in milliseconds
  maxDelay: number;           // Maximum backoff delay
  backoffMultiplier: number;  // Multiplier for exponential backoff
  jitter: boolean;            // Add random jitter to prevent thundering herd
  retryableErrors?: string[]; // Error types that should be retried
  nonRetryableErrors?: string[]; // Error types that should NOT be retried
  timeout?: number;           // Per-attempt timeout in milliseconds
}
```

### 7.2 Planned Runtime Retry Behavior (Operational State)
Retries are an operational concern to be managed strictly by the Rust runtime. The TypeScript sidecar remains unaware of transient failures. No retry-related events exist in semantic history.

| Scenario | Rust Runtime Behavior | Semantic Event Written | Sidecar Sees |
|----------|----------------------|------------------------|--------------|
| **A. First attempt succeeds** | Records `StepCompleted` in semantic history. Resumes sidecar. | `StepCompleted` | Return value |
| **B. First attempt fails, retryable** | Increments `attempt` in `step_executions` table. Schedules retry via scheduler. **No semantic event written.** Sidecar remains suspended. | None | Nothing (suspended) |
| **C. Several attempts fail, then succeeds** | Each failure increments attempt in `step_executions`. On success, records `StepCompleted`. Resumes sidecar. | `StepCompleted` | Return value (as if it succeeded on first try) |
| **D. All attempts exhausted** | Records `StepFailed` in semantic history. Resumes sidecar. | `StepFailed` | Thrown error |
| **E. Non-retryable failure** | Records `StepFailed` immediately in semantic history. Resumes sidecar. | `StepFailed` | Thrown error |
| **F. Worker crash during attempt** | Lease expires. Scheduler reassigns run to new worker. New worker sees step status `pending`/`running` in `step_executions`, applies retry policy. | None (until resolved) | Nothing (suspended) |
| **G. Worker crash after external side effect, before persistence** | Same as F. Step re-executes. External side effect may duplicate. Idempotency keys mitigate this. | None (until resolved) | Nothing (suspended) |

### 7.3 Planned Jitter Formula
```
delay = min(initialDelay * backoffMultiplier^attempt, maxDelay)
if jitter:
    delay = delay * random(0.5, 1.5)
```
This formula prevents retry storms when many workflows experience transient network issues simultaneously.

## 8. Limitations

All benchmark experiments in this document were executed on a single developer workstation (Intel Core i3-1005G1 CPU @ 1.20GHz, 2 physical / 4 logical cores, 7.80 GB RAM, Microsoft Windows 10 Pro) with local Docker-hosted PostgreSQL and NATS services communicating over loopback (`localhost`). Network transit latency, cross-availability-zone consensus delays, distributed clock skew, TLS handshake overhead, and multi-tenant resource contention are absent. These figures characterize architectural runtime overhead, IPC mechanisms, and crash-recovery invariants under controlled local conditions; they do not constitute a production load test or multi-node cluster benchmark.


