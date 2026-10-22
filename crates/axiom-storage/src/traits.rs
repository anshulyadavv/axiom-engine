use crate::models::{EventRow, OutboxMessageRow, StepExecutionRow, WorkflowRow, WorkflowRunRow};
use async_trait::async_trait;
use axiom_core::{FenceToken, Result, RunId, TenantId, WorkflowId};

#[async_trait]
pub trait WorkflowRepository: Send + Sync {
    async fn create_workflow(&self, workflow: WorkflowRow) -> Result<WorkflowRow>;
    async fn get_workflow(&self, id: WorkflowId) -> Result<Option<WorkflowRow>>;
    async fn get_workflow_by_name(
        &self,
        tenant_id: TenantId,
        name: &str,
        version: i32,
    ) -> Result<Option<WorkflowRow>>;
    async fn list_workflows(
        &self,
        tenant_id: TenantId,
        limit: i64,
        offset: i64,
        name: Option<String>,
    ) -> Result<Vec<WorkflowRow>>;
    async fn get_workflow_stats(
        &self,
        tenant_id: TenantId,
        workflow_id: WorkflowId,
    ) -> Result<axiom_core::ExecutionAnalytics>;
}

#[async_trait]
pub trait AuthRepository: Send + Sync {
    async fn get_tenant_by_api_key_hash(&self, key_hash: &str) -> Result<Option<TenantId>>;
    async fn create_api_key(
        &self,
        key: crate::models::ApiKeyRow,
    ) -> Result<crate::models::ApiKeyRow>;
    async fn list_api_keys(&self, tenant_id: TenantId) -> Result<Vec<crate::models::ApiKeyRow>>;
    async fn revoke_api_key(&self, tenant_id: TenantId, key_id: &str) -> Result<bool>;
}

#[async_trait]
pub trait RunRepository: Send + Sync {
    async fn create_run(&self, run: WorkflowRunRow) -> Result<WorkflowRunRow>;
    async fn create_run_and_outbox(
        &self,
        run: WorkflowRunRow,
        outbox: crate::models::OutboxMessageRow,
    ) -> Result<WorkflowRunRow>;
    async fn get_run(&self, id: RunId) -> Result<Option<WorkflowRunRow>>;
    async fn list_runs(
        &self,
        tenant_id: TenantId,
        limit: i64,
        offset: i64,
        status: Option<String>,
    ) -> Result<Vec<WorkflowRunRow>>;

    async fn get_run_by_idempotency_key(
        &self,
        tenant_id: TenantId,
        idempotency_key: &str,
    ) -> Result<Option<WorkflowRunRow>>;
    async fn get_child_run(
        &self,
        tenant_id: TenantId,
        parent_run_id: RunId,
        parent_operation_id: &str,
    ) -> Result<Option<WorkflowRunRow>>;
    async fn get_children_for_run(
        &self,
        tenant_id: TenantId,
        parent_run_id: RunId,
    ) -> Result<Vec<WorkflowRunRow>>;

    // Lease protocol operations (monotonically fenced)
    async fn poll_run(
        &self,
        worker_id: &str,
        duration: std::time::Duration,
    ) -> Result<Option<(RunId, FenceToken)>>;
    async fn acquire_lease(&self, id: RunId, worker_id: &str) -> Result<Option<FenceToken>>;
    async fn renew_lease(
        &self,
        id: RunId,
        worker_id: &str,
        fence_token: FenceToken,
    ) -> Result<bool>;
    async fn release_lease(
        &self,
        id: RunId,
        worker_id: &str,
        fence_token: FenceToken,
    ) -> Result<bool>;
    async fn update_run_status(
        &self,
        id: RunId,
        fence_token: FenceToken,
        status: axiom_core::RunStatus,
        output: Option<serde_json::Value>,
        error: Option<serde_json::Value>,
    ) -> Result<()>;

    // Atomically updates the run status (e.g. child terminal status) and wakes up the parent
    async fn complete_run_with_parent_wakeup(
        &self,
        child_id: RunId,
        child_fence_token: FenceToken,
        child_status: axiom_core::RunStatus,
        child_output: Option<serde_json::Value>,
        child_error: Option<serde_json::Value>,
        parent_id: RunId,
        parent_event: EventRow,
        parent_outbox: crate::models::OutboxMessageRow,
    ) -> Result<()>;

    async fn cancel_run(&self, id: RunId) -> Result<bool>;
}

#[async_trait]
pub trait EventRepository: Send + Sync {
    // Requires the fence token to prevent split-brain appends
    async fn append_event(
        &self,
        id: RunId,
        fence_token: FenceToken,
        event: EventRow,
    ) -> Result<EventRow>;
    async fn get_events(&self, id: RunId) -> Result<Vec<EventRow>>;
}

#[async_trait]
pub trait StepRepository: Send + Sync {
    async fn get_step_execution(
        &self,
        run_id: RunId,
        step_id: &str,
        attempt: i32,
    ) -> Result<Option<StepExecutionRow>>;
    async fn upsert_step_execution(
        &self,
        run_id: RunId,
        fence_token: FenceToken,
        step: StepExecutionRow,
    ) -> Result<StepExecutionRow>;
    async fn get_steps_for_run(&self, run_id: RunId) -> Result<Vec<StepExecutionRow>>;

    // Transactionally upserts step execution and inserts the corresponding outbox message.
    // This provides the required atomicity so we never have a step without dispatch, or dispatch without a step.
    async fn upsert_step_and_outbox(
        &self,
        run_id: RunId,
        fence_token: FenceToken,
        step: StepExecutionRow,
        outbox: crate::models::OutboxMessageRow,
    ) -> Result<()>;
}

#[async_trait]
pub trait OutboxRepository: Send + Sync {
    // Write an outbox message inside a transaction (called alongside event appends, etc)
    // NOTE: In a real implementation we would pass the sqlx::Transaction or have a unit of work trait,
    // but for Phase 1A scaffolding we'll expose a standalone method that uses its own transaction for now,
    // or rely on a `with_transaction` extension method later.
    async fn create_outbox_message(&self, message: OutboxMessageRow) -> Result<OutboxMessageRow>;

    // Polling and claiming logic using FOR UPDATE SKIP LOCKED
    async fn claim_messages(&self, batch_size: i64) -> Result<Vec<OutboxMessageRow>>;

    // Successful dispatch deletion using the claim token
    async fn delete_message(&self, id: uuid::Uuid, claim_token: uuid::Uuid) -> Result<bool>;
}

#[async_trait]
pub trait AuditRepository: Send + Sync {
    async fn append_audit_log(&self, log: crate::models::AuditLogRow) -> Result<()>;
}

/// Repository for durable workflow-local state.
/// State belongs to the run, not to the worker.
/// All methods enforce tenant isolation via tenant_id.
#[async_trait]
pub trait StateRepository: Send + Sync {
    /// Returns the current value for the given (tenant, run, key), or None if not set.
    async fn get_state(
        &self,
        tenant_id: TenantId,
        run_id: RunId,
        key: &str,
    ) -> Result<Option<crate::models::RunStateRow>>;

    /// Atomically upserts the state value. Thread-safe via PostgreSQL ON CONFLICT.
    async fn set_state(
        &self,
        tenant_id: TenantId,
        run_id: RunId,
        key: &str,
        value: serde_json::Value,
    ) -> Result<crate::models::RunStateRow>;

    /// Deletes a state key. Idempotent: does not fail if the key does not exist.
    async fn delete_state(&self, tenant_id: TenantId, run_id: RunId, key: &str) -> Result<()>;
}

#[async_trait]
pub trait WorkerRepository: Send + Sync {
    async fn list_workers(&self, tenant_id: TenantId) -> Result<Vec<crate::models::WorkerRow>>;
    async fn register_worker(
        &self,
        id: &str,
        tenant_id: Option<TenantId>,
        metadata: serde_json::Value,
    ) -> Result<()>;
    async fn heartbeat_worker(&self, id: &str) -> Result<()>;
}
