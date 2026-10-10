-- Tenants
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

-- API Keys
CREATE TABLE api_keys (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    name            TEXT NOT NULL,
    key_hash        TEXT NOT NULL,
    key_prefix      TEXT NOT NULL,
    permissions     TEXT[] NOT NULL DEFAULT '{}',
    expires_at      TIMESTAMPTZ,
    last_used_at    TIMESTAMPTZ,
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'revoked')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_api_keys_tenant ON api_keys (tenant_id);
CREATE INDEX idx_api_keys_prefix ON api_keys (key_prefix);

-- Workflows
CREATE TABLE workflows (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    name            TEXT NOT NULL,
    version         INTEGER NOT NULL DEFAULT 1,
    description     TEXT,
    definition      JSONB NOT NULL,
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'paused', 'archived')),
    retry_policy    JSONB,
    timeout         BIGINT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name, version)
);

CREATE INDEX idx_workflows_tenant ON workflows (tenant_id);
CREATE INDEX idx_workflows_tenant_name ON workflows (tenant_id, name);

-- Workflow Runs
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
    worker_id       TEXT,
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
CREATE INDEX idx_runs_parent ON workflow_runs (parent_run_id) WHERE parent_run_id IS NOT NULL;
CREATE UNIQUE INDEX idx_runs_idempotency ON workflow_runs (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_runs_lease_expiry ON workflow_runs (lease_expires_at) WHERE status IN ('running', 'retrying');

-- Events
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
    data            JSONB NOT NULL,
    timestamp       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (run_id, sequence_number)
);

CREATE INDEX idx_events_run ON events (run_id, sequence_number);
CREATE INDEX idx_events_tenant ON events (tenant_id);

-- Timers
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

CREATE INDEX idx_timers_due ON timers (due_at) WHERE status = 'scheduled';
CREATE INDEX idx_timers_run ON timers (run_id);

-- Signals
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
CREATE INDEX idx_signals_pending ON signals (run_id, signal_name) WHERE status = 'pending';

-- Step Executions
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
    next_retry_at   TIMESTAMPTZ,
    input           JSONB,
    output          JSONB,
    error           JSONB,
    operation_id    TEXT NOT NULL,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    duration_ms     BIGINT,
    UNIQUE (run_id, step_id, attempt)
);

CREATE INDEX idx_steps_run ON step_executions (run_id);
CREATE INDEX idx_steps_operation ON step_executions (operation_id);
CREATE INDEX idx_steps_pending ON step_executions (next_retry_at) WHERE status = 'pending';

-- Outbox Messages
CREATE TABLE outbox_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    topic           TEXT NOT NULL,
    payload         JSONB NOT NULL,
    available_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempt_count   INTEGER NOT NULL DEFAULT 0,
    last_error      TEXT,
    claim_token     UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_outbox_available ON outbox_messages (available_at);

-- Workers
CREATE TABLE workers (
    id              TEXT PRIMARY KEY,
    tenant_id       UUID,
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'draining', 'offline')),
    last_heartbeat  TIMESTAMPTZ NOT NULL DEFAULT now(),
    metadata        JSONB NOT NULL DEFAULT '{}',
    registered_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_workers_heartbeat ON workers (last_heartbeat) WHERE status = 'active';

-- Audit Log
CREATE TABLE audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    actor_type      TEXT NOT NULL,
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

-- Seed Default Tenant for Development
INSERT INTO tenants (id, name, slug, status)
VALUES ('00000000-0000-0000-0000-000000000000', 'System Default', 'system', 'active')
ON CONFLICT DO NOTHING;
