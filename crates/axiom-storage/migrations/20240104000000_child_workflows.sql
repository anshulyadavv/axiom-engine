-- Add parent_operation_id to track deterministic child workflow invocations
ALTER TABLE workflow_runs
ADD COLUMN parent_operation_id TEXT;

-- Enforce strict deduplication: a parent run can only create one child per operation ID
CREATE UNIQUE INDEX idx_workflow_runs_parent_op
ON workflow_runs (parent_run_id, parent_operation_id)
WHERE parent_run_id IS NOT NULL AND parent_operation_id IS NOT NULL;
