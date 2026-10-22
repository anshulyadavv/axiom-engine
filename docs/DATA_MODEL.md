# Axiom Engine — Data Model

This document defines all data schemas, their storage backends, relationships,
and migration strategy.

## 1. Entity Relationship Overview

```
Tenant 1──* Workflow 1──* WorkflowRun 1──* Event
                                      1──* StepExecution
                                      1──* Timer
                                      1──* Signal

Tenant 1──* ApiKey
Tenant 1──* User 1──* Role

Worker *──* WorkflowRun (via Lease)
```

## 2. PostgreSQL Schema

### 2.1 Tenants

```sql
CREATE TABLE tenants (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    slug            TEXT NOT NULL UNIQUE,
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'suspended', 'deleted')),
    settings        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tenants_slug ON tenants (slug);
```

### 2.2 API Keys

```sql
CREATE TABLE api_keys (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    name            TEXT NOT NULL,
    key_hash        TEXT NOT NULL,                    -- bcrypt/argon2 hash
    key_prefix      TEXT NOT NULL,                    -- first 8 chars for identification
    permissions     TEXT[] NOT NULL DEFAULT '{}',
    expires_at      TIMESTAMPTZ,
    last_used_at    TIMESTAMPTZ,
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'revoked')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_api_keys_tenant ON api_keys (tenant_id);
CREATE INDEX idx_api_keys_prefix ON api_keys (key_prefix);
-- key_hash is NOT indexed; lookup is by prefix, then verify hash.
```

**Rationale for key_prefix index**: API key lookup is a two-step process:
find candidate keys by prefix, then verify the full hash. This avoids a
full-table hash comparison on every request.

### 2.3 Workflows (Definitions)

```sql
CREATE TABLE workflows (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    name            TEXT NOT NULL,
    version         INTEGER NOT NULL DEFAULT 1,
    description     TEXT,
    definition      JSONB NOT NULL,                   -- serialized workflow metadata
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'paused', 'archived')),
    retry_policy    JSONB,                            -- default retry policy
    timeout         BIGINT,                           -- default timeout in ms
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (tenant_id, name, version)
);

CREATE INDEX idx_workflows_tenant ON workflows (tenant_id);
CREATE INDEX idx_workflows_tenant_name ON workflows (tenant_id, name);
```

**Rationale for (tenant_id, name, version) unique constraint**: Ensures no
two versions of the same workflow collide. Combined with tenant_id for
isolation.

### 2.4 Workflow Runs

```sql
CREATE TABLE workflow_runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    workflow_id     UUID NOT NULL REFERENCES workflows(id),
    workflow_version INTEGER NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN (
                        'pending', 'running', 'sleeping', 'waiting',
                        'retrying', 'completed', 'failed', 'cancelled',
                        'version_mismatch'
                    )),
    input           JSONB,
    output          JSONB,
    error           JSONB,
    idempotency_key TEXT,
    correlation_id  TEXT,
    parent_run_id   UUID REFERENCES workflow_runs(id),
    worker_id       TEXT,                             -- current owning worker
    fence_token     BIGINT NOT NULL DEFAULT 0,
    lease_expires_at TIMESTAMPTZ,
    attempt_count   INTEGER NOT NULL DEFAULT 0,
    max_attempts    INTEGER NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ
);

CREATE INDEX idx_runs_tenant ON workflow_runs (tenant_id);
CREATE INDEX idx_runs_workflow ON workflow_runs (workflow_id);
CREATE INDEX idx_runs_status ON workflow_runs (tenant_id, status);
CREATE INDEX idx_runs_parent ON workflow_runs (parent_run_id)
    WHERE parent_run_id IS NOT NULL;
CREATE UNIQUE INDEX idx_runs_idempotency
    ON workflow_runs (tenant_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_runs_lease_expiry
    ON workflow_runs (lease_expires_at)
    WHERE status IN ('running', 'retrying');
```

**Index justifications**:
- `idx_runs_tenant`: Tenant-scoped queries (list runs).
- `idx_runs_workflow`: Workflow-scoped queries (runs of a specific workflow).
- `idx_runs_status`: Filter runs by status within a tenant.
- `idx_runs_parent`: Find child runs of a parent.
- `idx_runs_idempotency`: Prevent duplicate runs with same idempotency key.
- `idx_runs_lease_expiry`: Scheduler query for expired leases to reassign.

### 2.5 Event History

```sql
CREATE TABLE events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id          UUID NOT NULL REFERENCES workflow_runs(id),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    sequence_number BIGINT NOT NULL,
    event_type      TEXT NOT NULL CHECK (event_type IN (
        'WorkflowStarted', 'WorkflowCompleted', 'WorkflowFailed',
        'WorkflowCancelled',
        'StepCompleted', 'StepFailed',
        'TimerFired',
        'SignalReceived', 'SignalTimedOut',
        'ChildWorkflowCompleted', 'ChildWorkflowFailed',
        'TimestampRecorded', 'RandomRecorded'
    )),
    step_id         TEXT,
    attempt         INTEGER,
    data            JSONB NOT NULL,                   -- event-specific payload
    timestamp       TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (run_id, sequence_number)
);

CREATE INDEX idx_events_run ON events (run_id, sequence_number);
CREATE INDEX idx_events_tenant ON events (tenant_id);
```

**Design choices**:
- **Append-only**: Events are never updated or deleted. This is the audit trail.
- **sequence_number**: Monotonically increasing per run. Defines replay order.
- **UNIQUE (run_id, sequence_number)**: Prevents duplicate events at the same
  position, guarding against retry-induced duplicates.

### 2.6 Timers

```sql
CREATE TABLE timers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id          UUID NOT NULL REFERENCES workflow_runs(id),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    timer_id        TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'scheduled'
                    CHECK (status IN ('scheduled', 'fired', 'cancelled')),
    scheduled_at    TIMESTAMPTZ NOT NULL,
    due_at          TIMESTAMPTZ NOT NULL,
    fired_at        TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (run_id, timer_id)
);

CREATE INDEX idx_timers_due ON timers (due_at)
    WHERE status = 'scheduled';
CREATE INDEX idx_timers_run ON timers (run_id);
```

**Rationale for `idx_timers_due`**: The scheduler polls for due timers:
`SELECT * FROM timers WHERE status = 'scheduled' AND due_at <= now()`.
Partial index avoids scanning fired/cancelled timers.

### 2.7 Signals

```sql
CREATE TABLE signals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id          UUID NOT NULL REFERENCES workflow_runs(id),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    signal_name     TEXT NOT NULL,
    payload         JSONB,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'delivered', 'expired')),
    received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    delivered_at    TIMESTAMPTZ,

    UNIQUE (run_id, signal_name)
);

CREATE INDEX idx_signals_run ON signals (run_id);
CREATE INDEX idx_signals_pending ON signals (run_id, signal_name)
    WHERE status = 'pending';
```

### 2.8 Step Executions

```sql
CREATE TABLE step_executions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id          UUID NOT NULL REFERENCES workflow_runs(id),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    step_id         TEXT NOT NULL,
    attempt         INTEGER NOT NULL DEFAULT 1,
    max_attempts    INTEGER NOT NULL DEFAULT 1,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN (
                        'pending', 'running', 'completed', 'failed', 'timed_out'
                    )),
    next_retry_at   TIMESTAMPTZ,                       -- Time when this attempt should run
    input           JSONB,
    output          JSONB,
    error           JSONB,
    operation_id    TEXT NOT NULL,                     -- deterministic idempotency key
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    duration_ms     BIGINT,

    UNIQUE (run_id, step_id, attempt)
);

CREATE INDEX idx_steps_run ON step_executions (run_id);
CREATE INDEX idx_steps_operation ON step_executions (operation_id);
CREATE INDEX idx_steps_pending ON step_executions (next_retry_at) 
    WHERE status = 'pending';
```

**Retry Semantics**: Each retry attempt is a distinct row in `step_executions`. If attempt 1 fails and is eligible for retry, a new row is inserted with `attempt = 2`, `status = 'pending'`, and `next_retry_at` set according to the backoff. The Rust runtime polls `idx_steps_pending` for due attempts.

### 2.9 Outbox Messages

```sql
CREATE TABLE outbox_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    topic           TEXT NOT NULL,
    payload         JSONB NOT NULL,
    available_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempt_count   INTEGER NOT NULL DEFAULT 0,
    last_error      TEXT,
    claim_token     UUID,                              -- UUID of the current relayer claim
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_outbox_available ON outbox_messages (available_at);
```

**Outbox Relayer Operational Semantics**:
1. **Claiming**: Relayers claim a batch of messages using `FOR UPDATE SKIP LOCKED`, generating a unique claim token.
   ```sql
   UPDATE outbox_messages
   SET available_at = now() + interval '30 seconds',
       attempt_count = attempt_count + 1,
       claim_token = gen_random_uuid()
   WHERE id IN (
       SELECT id FROM outbox_messages 
       WHERE available_at <= now() 
       ORDER BY created_at ASC 
       LIMIT 100 
       FOR UPDATE SKIP LOCKED
   )
   RETURNING id, topic, payload, claim_token;
   ```
2. **Concurrency**: Multiple relayer instances can run concurrently. The `SKIP LOCKED` clause prevents contention.
3. **Dispatch**: The relayer publishes the messages to NATS.
4. **Cleanup**: Once NATS acknowledges receipt, the message is deleted using the claim token to prevent stale deletions: `DELETE FROM outbox_messages WHERE id = $1 AND claim_token = $2`.
5. **Failures**: If NATS is unavailable or rejects the message, the message remains in the outbox. It becomes eligible for claiming again after `available_at` (30 seconds). `last_error` is updated.
6. **Crash Tolerance**: If the relayer crashes *after* publishing to NATS but *before* deleting the row, the message will eventually become `available_at` and be re-published. This enforces at-least-once delivery; downstream consumers MUST be idempotent.
7. **Business Processing**: NATS publish acknowledgment DOES NOT mean the business process succeeded. It only guarantees internal message delivery.

### 2.10 Workers

```sql
CREATE TABLE workers (
    id              TEXT PRIMARY KEY,
    tenant_id       UUID,                             -- NULL for system workers
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'draining', 'offline')),
    last_heartbeat  TIMESTAMPTZ NOT NULL DEFAULT now(),
    metadata        JSONB NOT NULL DEFAULT '{}',
    registered_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_workers_heartbeat ON workers (last_heartbeat)
    WHERE status = 'active';
```

### 2.11 Audit Log

```sql
CREATE TABLE audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    actor_type      TEXT NOT NULL,                     -- 'user', 'api_key', 'system'
    actor_id        TEXT NOT NULL,
    action          TEXT NOT NULL,
    resource_type   TEXT NOT NULL,
    resource_id     TEXT NOT NULL,
    metadata        JSONB NOT NULL DEFAULT '{}',
    ip_address      INET,
    timestamp       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_tenant ON audit_log (tenant_id, timestamp DESC);
CREATE INDEX idx_audit_resource ON audit_log (resource_type, resource_id);
```

## 3. FoundationDB Key Space (Optional, Deferred)

When FoundationDB is enabled, it manages coordination state:

```
/axiom/
    /leases/
        /workflow/{run_id} → { worker_id, fence_token, expires_at }
    /workers/
        /heartbeat/{worker_id} → { timestamp, metadata }
    /placement/
        /workflow/{run_id} → { worker_id }
    /locks/
        /scheduler/leader → { node_id, expires_at }
```

**Why FoundationDB for this**:
- Lease acquisition and fencing require low-latency transactions.
- High-contention scenarios (many workers competing for the same run) are
  better handled by FoundationDB's optimistic concurrency than PostgreSQL
  row locks.
- Worker heartbeats at high frequency can generate significant write
  amplification in PostgreSQL.

**When deferred**: PostgreSQL handles leases via persistent lease rows with
monotonic fence tokens in the `workflow_runs` table directly (see ADR 0003).

## 4. Distributed KV Store (Phase 4)

Each workflow type may optionally need workflow-local state. Because workflows can be dynamically reassigned to different workers across the cluster upon crash or lease expiry, strictly worker-local files (like SQLite) are unsuitable for Phase 1. 

In Phase 4, a distributed key-value store (backed by PostgreSQL or FoundationDB) will be introduced to support `ctx.state.get/set/delete` APIs.

## 5. ClickHouse Analytics Schema (Planned, Phase 3)

```sql
CREATE TABLE workflow_events (
    tenant_id       UUID,
    workflow_id     UUID,
    workflow_name   String,
    run_id          UUID,
    event_type      LowCardinality(String),
    step_id         Nullable(String),
    attempt         Nullable(UInt32),
    status          LowCardinality(String),
    duration_ms     Nullable(UInt64),
    error_type      Nullable(String),
    worker_id       Nullable(String),
    timestamp       DateTime64(3, 'UTC'),
    metadata        String                            -- JSON string
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (tenant_id, workflow_id, run_id, timestamp);
```

**Design choices**:
- Partitioned by month for efficient range queries and TTL.
- Ordered by tenant → workflow → run → time for typical query patterns.
- `LowCardinality` for enum-like columns (significant compression).
- `String` for metadata (ClickHouse JSON support is limited; parse at query time).

## 6. NATS Message Schemas

### 6.1 Subject Naming Convention

```
axiom.{domain}.{action}
axiom.{domain}.{entity_id}.{action}
```

### 6.2 Message Envelope

All NATS messages use a common envelope:

```json
{
  "message_id": "uuid",
  "correlation_id": "uuid",
  "tenant_id": "uuid",
  "timestamp": "2024-01-01T00:00:00Z",
  "payload": { ... }
}
```

### 6.3 Specific Messages

#### `axiom.workflow.execute`

```json
{
  "workflow_id": "uuid",
  "run_id": "uuid",
  "workflow_name": "order-processing",
  "workflow_version": 1,
  "input": { ... }
}
```

#### `axiom.step.execute`

```json
{
  "run_id": "uuid",
  "step_id": "charge-payment",
  "attempt": 1,
  "operation_id": "deterministic-hash",
  "timeout_ms": 30000
}
```

#### `axiom.timer.fire`

```json
{
  "run_id": "uuid",
  "timer_id": "sleep-24h",
  "scheduled_at": "2024-01-01T00:00:00Z",
  "due_at": "2024-01-02T00:00:00Z"
}
```

#### `axiom.signal.received`

```json
{
  "run_id": "uuid",
  "signal_name": "manager-approved",
  "payload": { "approved_by": "user-123" }
}
```

#### `axiom.workflow.cancel`

```json
{
  "run_id": "uuid",
  "reason": "user-requested",
  "requested_by": "user-456"
}
```

## 7. Migration Strategy

### 7.1 Tool

Use a migration tool compatible with Rust. Candidates:
- `sqlx` migrations (built into sqlx)
- `refinery` (Rust migration library)

### 7.2 Conventions

- Migrations are numbered sequentially: `V001__initial_schema.sql`.
- Each migration is a single SQL file.
- Migrations are forward-only in production.
- Down migrations are provided for development but not guaranteed for
  production (data loss is acceptable in development, not production).
- Migrations are tested in CI.

### 7.3 Compatibility

- Additive changes (new columns, new tables) are always safe.
- Column removal requires a deprecation period.
- Index changes may require concurrent index creation in production.
- Event history schema changes must be backward-compatible (old events
  must still be readable).

## 8. Data Lifecycle

### 8.1 Retention

| Data | Default Retention | Configurable |
|------|-------------------|-------------|
| Event history | Indefinite | Yes |
| Completed runs | 90 days | Yes |
| Audit log | 365 days | Yes |
| ClickHouse events | 90 days | Yes |
| Dist KV workflow-local | Lifetime of workflow | N/A |

### 8.2 Archival

Completed workflow runs and their event histories can be archived (moved to
cold storage) after the retention period. The archival mechanism is out of
scope for Phase 1.

### 8.3 Deletion

Tenant deletion must cascade to all tenant-owned resources. This is enforced
by foreign key constraints and explicit cleanup.
