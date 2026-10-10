use axiom_core::{FenceToken, RunId, StepId, TenantId, WorkflowId, RunStatus, StepStatus};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct WorkflowRow {
    pub id: WorkflowId,
    pub tenant_id: TenantId,
    pub name: String,
    pub version: i32,
    pub description: Option<String>,
    pub definition: serde_json::Value,
    pub status: String, // 'active', 'paused', 'archived'
    pub retry_policy: Option<serde_json::Value>,
    pub timeout: Option<i64>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct WorkflowRunRow {
    pub id: RunId,
    pub tenant_id: TenantId,
    pub workflow_id: WorkflowId,
    pub workflow_version: i32,
    pub status: RunStatus,
    pub input: Option<serde_json::Value>,
    pub output: Option<serde_json::Value>,
    pub error: Option<serde_json::Value>,
    pub idempotency_key: Option<String>,
    pub correlation_id: Option<String>,
    pub parent_run_id: Option<RunId>,
    pub parent_operation_id: Option<String>,
    pub worker_id: Option<String>,
    pub fence_token: FenceToken,
    pub lease_expires_at: Option<DateTime<Utc>>,
    pub attempt_count: i32,
    pub max_attempts: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct EventRow {
    pub id: uuid::Uuid,
    pub run_id: RunId,
    pub tenant_id: TenantId,
    pub sequence_number: i64,
    pub event_type: String,
    pub step_id: Option<String>,
    pub attempt: Option<i32>,
    pub data: serde_json::Value,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct StepExecutionRow {
    pub id: uuid::Uuid,
    pub run_id: RunId,
    pub tenant_id: TenantId,
    pub step_id: String,
    pub attempt: i32,
    pub max_attempts: i32,
    pub status: StepStatus,
    pub next_retry_at: Option<DateTime<Utc>>,
    pub input: Option<serde_json::Value>,
    pub output: Option<serde_json::Value>,
    pub error: Option<serde_json::Value>,
    pub operation_id: String,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub duration_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct OutboxMessageRow {
    pub id: uuid::Uuid,
    pub tenant_id: TenantId,
    pub topic: String,
    pub payload: serde_json::Value,
    pub available_at: DateTime<Utc>,
    pub attempt_count: i32,
    pub last_error: Option<String>,
    pub claim_token: Option<uuid::Uuid>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ApiKeyRow {
    pub key_id: String,
    pub tenant_id: TenantId,
    pub key_hash: String,
    pub description: Option<String>,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub revoked_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct AuditLogRow {
    pub id: uuid::Uuid,
    pub tenant_id: TenantId,
    pub action: String,
    pub resource_type: String,
    pub resource_id: Option<String>,
    pub correlation_id: Option<String>,
    pub created_at: DateTime<Utc>,
}

/// Durable workflow-local state. Belongs to a run, survives worker reassignment.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct RunStateRow {
    pub id: uuid::Uuid,
    pub tenant_id: TenantId,
    pub run_id: RunId,
    pub key: String,
    pub value: serde_json::Value,
    pub schema_version: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct WorkerRow {
    pub id: String,
    pub tenant_id: Option<TenantId>,
    pub status: String,
    pub last_heartbeat: DateTime<Utc>,
    pub metadata: serde_json::Value,
    pub registered_at: DateTime<Utc>,
}
