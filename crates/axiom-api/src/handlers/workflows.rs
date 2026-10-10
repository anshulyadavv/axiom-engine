use axum::{
    extract::{Path, State, Query},
    Json,
};
use serde::{Deserialize, Serialize};
use axiom_core::{TenantId, WorkflowId, RunId};
use crate::{
    server::AppState,
    error::ApiError,
    auth::AuthenticatedTenant,
};
use axiom_storage::models::{WorkflowRow, WorkflowRunRow};
use axiom_storage::traits::{WorkflowRepository, RunRepository, AuditRepository};
use chrono::Utc;
use uuid::Uuid;

#[derive(Deserialize)]
pub struct RegisterWorkflowReq {
    pub name: String,
    pub description: Option<String>,
    pub version: i32,
    pub retry_policy: Option<serde_json::Value>,
    pub timeout_ms: Option<i64>,
}

#[derive(Serialize)]
pub struct ApiData<T> {
    pub data: T,
}

pub async fn register_workflow(
    AuthenticatedTenant(tenant_id): AuthenticatedTenant,
    State(state): State<AppState>,
    Json(payload): Json<RegisterWorkflowReq>,
) -> Result<Json<ApiData<WorkflowRow>>, ApiError> {
    if payload.name.trim().is_empty() {
        return Err(ApiError::Validation("Workflow name cannot be empty".into(), vec![]));
    }
    if payload.name.len() > 100 {
        return Err(ApiError::Validation("Workflow name too long".into(), vec![]));
    }

    let workflow = WorkflowRow {
        id: WorkflowId(Uuid::new_v4()),
        tenant_id,
        name: payload.name,
        version: payload.version,
        description: payload.description,
        definition: serde_json::json!({}), // Kept simple for Phase 1
        status: "active".to_string(),
        retry_policy: payload.retry_policy,
        timeout: payload.timeout_ms,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };

    let created = state.db.create_workflow(workflow.clone()).await
        .map_err(|e| ApiError::Internal(e.into()))?;

    let _ = state.db.append_audit_log(axiom_storage::models::AuditLogRow {
        id: Uuid::new_v4(),
        tenant_id: tenant_id.clone(),
        action: "WorkflowRegistered".to_string(),
        resource_type: "Workflow".to_string(),
        resource_id: Some(created.id.0.to_string()),
        correlation_id: None,
        created_at: Utc::now(),
    }).await;

    Ok(Json(ApiData { data: created }))
}

#[derive(Deserialize)]
pub struct ListWorkflowsQuery {
    pub status: Option<String>,
    pub name: Option<String>,
    pub limit: Option<usize>,
    pub cursor: Option<String>,
}

#[derive(Serialize)]
pub struct PaginatedApiData<T> {
    pub data: Vec<T>,
    pub pagination: Pagination,
}

#[derive(Serialize)]
pub struct Pagination {
    pub cursor: Option<String>,
    pub has_more: bool,
}

pub async fn list_workflows(
    AuthenticatedTenant(tenant_id): AuthenticatedTenant,
    State(state): State<AppState>,
    Query(query): Query<ListWorkflowsQuery>,
) -> Result<Json<PaginatedApiData<WorkflowRow>>, ApiError> {
    let limit = query.limit.unwrap_or(20).min(100) as i64;
    // For Phase 1 we will just ignore the cursor and offset and always fetch the first page,
    // or parse the cursor as an offset if provided.
    let offset: i64 = query.cursor.as_deref().and_then(|c| c.parse().ok()).unwrap_or(0);

    let rows = state.db.list_workflows(tenant_id, limit + 1, offset, query.name.clone()).await
        .map_err(|e| ApiError::Internal(e.into()))?;

    let mut has_more = false;
    let mut data = rows;
    
    if data.len() > limit as usize {
        has_more = true;
        data.pop();
    }
    
    let next_cursor = if has_more {
        Some((offset + limit).to_string())
    } else {
        None
    };

    Ok(Json(PaginatedApiData {
        data,
        pagination: Pagination {
            cursor: next_cursor,
            has_more,
        },
    }))
}

#[derive(Serialize)]
pub struct WorkflowDetailData {
    pub id: String,
    pub name: String,
    pub version: i32,
    pub description: Option<String>,
    pub status: String,
    pub retry_policy: Option<serde_json::Value>,
    pub timeout_ms: Option<i64>,
    pub stats: axiom_core::ExecutionAnalytics,
    pub created_at: chrono::DateTime<Utc>,
    pub updated_at: chrono::DateTime<Utc>,
}

pub async fn get_workflow(
    AuthenticatedTenant(tenant_id): AuthenticatedTenant,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ApiData<WorkflowDetailData>>, ApiError> {
    let workflow_uuid = Uuid::parse_str(&id).map_err(|_| ApiError::NotFound("Invalid workflow ID".into()))?;
    let wf = state.db.get_workflow(WorkflowId(workflow_uuid)).await
        .map_err(|e| ApiError::Internal(e.into()))?;

    let wf = wf.ok_or_else(|| ApiError::NotFound("Workflow not found".into()))?;

    if wf.tenant_id != tenant_id {
        return Err(ApiError::NotFound("Workflow not found".into()));
    }

    // Stats from DB
    let stats = state.db.get_workflow_stats(tenant_id, wf.id).await
        .unwrap_or_else(|_| axiom_core::ExecutionAnalytics {
            total_runs: 0,
            active_runs: 0,
            success_rate: 0.0,
            avg_duration_ms: 0,
            p95_duration_ms: 0,
        });

    let data = WorkflowDetailData {
        id: wf.id.0.to_string(),
        name: wf.name,
        version: wf.version,
        description: wf.description,
        status: wf.status,
        retry_policy: wf.retry_policy,
        timeout_ms: wf.timeout,
        stats,
        created_at: wf.created_at,
        updated_at: wf.updated_at,
    };

    Ok(Json(ApiData { data }))
}

#[derive(Deserialize)]
pub struct StartRunReq {
    pub input: Option<serde_json::Value>,
    pub idempotency_key: Option<String>,
    pub correlation_id: Option<String>,
}

pub async fn start_run(
    AuthenticatedTenant(tenant_id): AuthenticatedTenant,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<StartRunReq>,
) -> Result<Json<ApiData<WorkflowRunRow>>, ApiError> {
    let workflow_uuid = Uuid::parse_str(&id).map_err(|_| ApiError::NotFound("Invalid workflow ID".into()))?;
    let wf = state.db.get_workflow(WorkflowId(workflow_uuid)).await
        .map_err(|e| ApiError::Internal(e.into()))?;

    let wf = wf.ok_or_else(|| ApiError::NotFound("Workflow not found".into()))?;

    if wf.tenant_id != tenant_id {
        return Err(ApiError::NotFound("Workflow not found".into()));
    }

    if let Some(key) = &payload.idempotency_key {
        if let Ok(Some(existing_run)) = state.db.get_run_by_idempotency_key(tenant_id.clone(), key).await {
            // Found an existing run with this idempotency key.
            // Strict check: if input differs, 409 Conflict.
            let inputs_match = existing_run.input == payload.input;
            if !inputs_match {
                return Err(ApiError::Conflict("Idempotency key already used with a different input".into()));
            }
            return Ok(Json(ApiData { data: existing_run }));
        }
    }

    use axiom_core::RunStatus;

    let run = WorkflowRunRow {
        id: RunId(Uuid::new_v4()),
        tenant_id: tenant_id.clone(),
        workflow_id: WorkflowId(workflow_uuid),
        workflow_version: wf.version,
        status: RunStatus::Pending,
        input: payload.input,
        output: None,
        error: None,
        idempotency_key: payload.idempotency_key,
        correlation_id: payload.correlation_id,
        parent_run_id: None,
        parent_operation_id: None,
        worker_id: None,
        fence_token: axiom_core::FenceToken(0),
        lease_expires_at: None,
        attempt_count: 0,
        max_attempts: 3,
        created_at: Utc::now(),
        updated_at: Utc::now(),
        started_at: None,
        completed_at: None,
    };

    let created = state.db.create_run(run.clone()).await
        .map_err(|e| ApiError::Internal(e.into()))?;

    let span = tracing::info_span!("start_run", 
        run_id = %created.id.0, 
        workflow_id = %workflow_uuid, 
        correlation_id = ?created.correlation_id,
        tenant_id = %tenant_id.0
    );
    {
        let _enter = span.enter();
        tracing::info!("Started new workflow run");
        metrics::counter!("axiom_workflow_runs_started", "workflow" => wf.name).increment(1);
        metrics::gauge!("axiom_active_workflow_runs").increment(1.0);
    }

    let _ = state.db.append_audit_log(axiom_storage::models::AuditLogRow {
        id: Uuid::new_v4(),
        tenant_id: tenant_id.clone(),
        action: "RunStarted".to_string(),
        resource_type: "WorkflowRun".to_string(),
        resource_id: Some(created.id.0.to_string()),
        correlation_id: created.correlation_id.clone(),
        created_at: Utc::now(),
    }).await;

    // In a full implementation, we'd also emit a WorkflowStarted event here or let the scheduler do it.
    
    Ok(Json(ApiData { data: created }))
}
