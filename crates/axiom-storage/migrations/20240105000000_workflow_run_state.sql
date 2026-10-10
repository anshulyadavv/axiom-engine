-- Workflow-local durable state for a run.
-- State belongs to the run, not to a worker. It survives worker reassignment.
-- Tenant isolation is enforced by tenant_id on every row.
-- schema_version allows future migration of the value shape if needed.
CREATE TABLE workflow_run_state (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL,
    run_id      UUID NOT NULL,
    key         TEXT NOT NULL,
    value       JSONB NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 1,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Strict uniqueness: one value per (run, key)
    CONSTRAINT uq_workflow_run_state UNIQUE (run_id, key),
    -- Tenant-scoped FK would require tenant_id on workflow_runs FK, so we enforce at query level
    FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
);

-- Index for per-tenant lookups (tenant isolation guard)
CREATE INDEX idx_workflow_run_state_tenant_run ON workflow_run_state (tenant_id, run_id);
