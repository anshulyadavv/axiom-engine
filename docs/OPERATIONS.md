# Operations Guide

## Health and Readiness Checks
- API provides `/health` (liveness) and `/ready` (readiness).
- Worker provides `/metrics` on port 9000 which can function as readiness.
- Workers can be safely restarted at any time; in-flight runs will be recovered via lease expiration.

## Logs and Correlation IDs
Axiom Engine uses structured JSON logging in production.
Every log trace includes `run_id`, `step_id`, and `tenant_id` where applicable. Searching your logging aggregator (e.g., Datadog, ELK) for a specific `run_id` will yield a complete chronological trace of execution.

## Prometheus Metrics
Both the API (port 3000) and Worker (port 9000) expose `/metrics` for Prometheus scraping.
Key metrics include:
- `axiom_step_executions_total`
- `axiom_step_failures_total`
- `axiom_fencing_failures_total`
- `axiom_step_execution_duration_seconds`

## Stuck or Waiting Runs
If a run appears stuck, investigate:
1. Is a worker running and healthy?
2. Did the lease expire? Check Postgres `workflow_runs` table for `lease_expires_at`.
3. Check NATS consumers to ensure the queue `axiom_workers` is not backing up.

## Worker Restarts
Axiom supports zero-downtime rolling updates. When a worker receives a `SIGTERM`, it stops pulling new NATS messages and attempts to cleanly finish in-flight processes up to a safe suspension point. If it is abruptly killed (`SIGKILL`), the `lease` guarantees that a fresh worker will securely take over within 15-30 seconds.

## Lease and Fencing Behavior
Axiom uses an atomic incremented `fence_token` on every state transition. 
If network partitions cause a split-brain (two workers processing the same run), only one can ever succeed in committing an event to Postgres. The loser will receive a stale-fence error, safely discard its progress, and shut down its sidecar.

## Outbox/JetStream Behavior
Events are reliably shipped to NATS using the Transactional Outbox pattern. The `outbox_relayer` loops over the `outbox` table and publishes messages. Do not bypass the `outbox_relayer` in production.

## Backup and Restore Considerations
PostgreSQL is the single source of truth for the entire engine. Backing up the PostgreSQL database guarantees 100% state capture. NATS does not require persistent backup.
