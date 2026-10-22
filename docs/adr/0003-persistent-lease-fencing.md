# ADR 0003: Persistent Leases with Monotonic Fencing

## Context
The initial architecture suggested using PostgreSQL's `SELECT ... FOR UPDATE SKIP LOCKED` for workflow ownership. While useful for queueing, this does not provide a durable, time-bound lease mechanism that survives network partitions or slow GC pauses, risking split-brain execution where two workers believe they own the same workflow run.

## Decision
Implement a persistent lease protocol with monotonic fencing:
- The `workflow_runs` table acts as the lease record, storing `worker_id`, `lease_expires_at`, and `fence_token`.
- A worker acquires a lease via an atomic `UPDATE` that increments the `fence_token` and sets a new `lease_expires_at`.
- Every state mutation (event append, step update) must include the `fence_token`.
- The database rejects writes if the provided `fence_token` is stale.

## Consequences
- Strict concurrency control preventing split-brain execution.
- `SELECT ... FOR UPDATE SKIP LOCKED` can still be used as an optimization for *finding* available work, but the atomic `UPDATE` with fence increment is the source of truth for ownership.
