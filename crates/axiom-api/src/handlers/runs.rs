use crate::{
    auth::AuthenticatedTenant, error::ApiError, handlers::workflows::ApiData, server::AppState,
};
use axiom_core::RunId;
use axiom_storage::models::{AuditLogRow, WorkflowRunRow};
use axiom_storage::traits::{AuditRepository, RunRepository, StepRepository, WorkflowRepository};
use axum::{
    extract::{Path, State},
    Json,
};
use chrono::Utc;
use serde::Serialize;
use uuid::Uuid;

#[derive(Serialize)]
pub struct RunDetailData {
    #[serde(flatten)]
    pub run: WorkflowRunRow,
    pub workflow_name: String,
    pub steps: Vec<serde_json::Value>, // Placeholder for steps, need a repo method to query step_executions
}

pub async fn get_run(
    AuthenticatedTenant(tenant_id): AuthenticatedTenant,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ApiData<RunDetailData>>, ApiError> {
    let run_uuid = Uuid::parse_str(&id).map_err(|_| ApiError::NotFound("Invalid run ID".into()))?;
    let run = state
        .db
        .get_run(RunId(run_uuid))
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    let run = run.ok_or_else(|| ApiError::NotFound("Run not found".into()))?;

    if run.tenant_id != tenant_id {
        return Err(ApiError::NotFound("Run not found".into()));
    }

    let wf = state
        .db
        .get_workflow(run.workflow_id.clone())
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    let workflow_name = wf.map(|w| w.name).unwrap_or_else(|| "Unknown".to_string());

    // Fetch step executions
    let steps = state.db.get_steps_for_run(run.id).await.unwrap_or_default();

    // Map to JSON objects
    let steps_json: Vec<serde_json::Value> = steps
        .into_iter()
        .map(|step| {
            serde_json::json!({
                "step_id": step.step_id,
                "status": step.status,
                "attempt": step.attempt,
                "duration_ms": step.duration_ms,
                "started_at": step.started_at,
                "completed_at": step.completed_at
            })
        })
        .collect();

    let data = RunDetailData {
        run,
        workflow_name,
        steps: steps_json,
    };

    Ok(Json(ApiData { data }))
}

#[derive(serde::Deserialize)]
pub struct ListRunsQuery {
    pub status: Option<String>,
    pub limit: Option<usize>,
    pub cursor: Option<String>,
}

pub async fn list_runs(
    AuthenticatedTenant(tenant_id): AuthenticatedTenant,
    State(state): State<AppState>,
    axum::extract::Query(query): axum::extract::Query<ListRunsQuery>,
) -> Result<Json<crate::handlers::workflows::PaginatedApiData<WorkflowRunRow>>, ApiError> {
    let limit = query.limit.unwrap_or(20).min(100) as i64;
    let offset: i64 = query
        .cursor
        .as_deref()
        .and_then(|c| c.parse().ok())
        .unwrap_or(0);

    let mut rows = state
        .db
        .list_runs(tenant_id, limit + 1, offset, query.status)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    let mut has_more = false;
    if rows.len() > limit as usize {
        has_more = true;
        rows.pop();
    }

    let next_cursor = if has_more {
        Some((offset + limit).to_string())
    } else {
        None
    };

    Ok(Json(crate::handlers::workflows::PaginatedApiData {
        data: rows,
        pagination: crate::handlers::workflows::Pagination {
            cursor: next_cursor,
            has_more,
        },
    }))
}

pub async fn get_run_history(
    AuthenticatedTenant(tenant_id): AuthenticatedTenant,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<crate::handlers::workflows::PaginatedApiData<serde_json::Value>>, ApiError> {
    let run_uuid = Uuid::parse_str(&id).map_err(|_| ApiError::NotFound("Invalid run ID".into()))?;
    let run = state
        .db
        .get_run(RunId(run_uuid))
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    let run = run.ok_or_else(|| ApiError::NotFound("Run not found".into()))?;

    if run.tenant_id != tenant_id {
        return Err(ApiError::NotFound("Run not found".into()));
    }

    use axiom_storage::traits::EventRepository;
    let events = state.db.get_events(run.id).await.unwrap_or_default();

    // Map to JSON objects
    let events_json: Vec<serde_json::Value> = events
        .into_iter()
        .map(|event| {
            serde_json::json!({
                "id": event.id,
                "sequence_number": event.sequence_number,
                "event_type": event.event_type,
                "step_id": event.step_id,
                "attempt": event.attempt,
                "data": event.data,
                "timestamp": event.timestamp
            })
        })
        .collect();

    Ok(Json(crate::handlers::workflows::PaginatedApiData {
        data: events_json,
        pagination: crate::handlers::workflows::Pagination {
            cursor: None,
            has_more: false,
        },
    }))
}

#[derive(serde::Deserialize)]
pub struct CancelRunReq {
    pub reason: Option<String>,
}

pub async fn cancel_run(
    AuthenticatedTenant(tenant_id): AuthenticatedTenant,
    State(state): State<AppState>,
    Path(id): Path<String>,
    axum::Json(_payload): axum::Json<CancelRunReq>,
) -> Result<Json<ApiData<WorkflowRunRow>>, ApiError> {
    let run_uuid = Uuid::parse_str(&id).map_err(|_| ApiError::NotFound("Invalid run ID".into()))?;
    let run = state
        .db
        .get_run(RunId(run_uuid))
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    let run = run.ok_or_else(|| ApiError::NotFound("Run not found".into()))?;

    if run.tenant_id != tenant_id {
        return Err(ApiError::NotFound("Run not found".into()));
    }

    use axiom_core::RunStatus;

    if run.status == RunStatus::Completed || run.status == RunStatus::Failed {
        return Err(ApiError::Unprocessable(
            "Run is already in a terminal state".into(),
        ));
    }

    if run.status == RunStatus::Cancelled {
        return Ok(Json(ApiData { data: run }));
    }

    let success = state
        .db
        .cancel_run(run.id)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    if !success {
        return Err(ApiError::Conflict(
            "Failed to cancel run, possibly modified concurrently".into(),
        ));
    }

    let _ = state
        .db
        .append_audit_log(AuditLogRow {
            id: Uuid::new_v4(),
            tenant_id: tenant_id.clone(),
            action: "RunCancelled".to_string(),
            resource_type: "WorkflowRun".to_string(),
            resource_id: Some(run.id.0.to_string()),
            correlation_id: run.correlation_id.clone(),
            created_at: Utc::now(),
        })
        .await;

    // In a real implementation we would log payload.reason

    // Fetch updated run
    let updated_run = state
        .db
        .get_run(run.id)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?
        .unwrap();

    Ok(Json(ApiData { data: updated_run }))
}

#[derive(Serialize)]
pub struct ExecutionTimeline {
    pub run: WorkflowRunRow,
    pub workflow_name: String,
    pub events: Vec<serde_json::Value>,
    pub steps: Vec<serde_json::Value>,
    pub children: Vec<serde_json::Value>,
}

pub async fn get_run_timeline(
    AuthenticatedTenant(tenant_id): AuthenticatedTenant,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ApiData<ExecutionTimeline>>, ApiError> {
    let run_uuid = Uuid::parse_str(&id).map_err(|_| ApiError::NotFound("Invalid run ID".into()))?;
    let run = state
        .db
        .get_run(RunId(run_uuid))
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    let run = run.ok_or_else(|| ApiError::NotFound("Run not found".into()))?;

    if run.tenant_id != tenant_id {
        return Err(ApiError::NotFound("Run not found".into()));
    }

    let wf = state
        .db
        .get_workflow(run.workflow_id.clone())
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    let workflow_name = wf.map(|w| w.name).unwrap_or_else(|| "Unknown".to_string());

    use axiom_storage::traits::EventRepository;

    // 1. Fetch semantic events
    let events = state.db.get_events(run.id).await.unwrap_or_default();
    let events_json: Vec<serde_json::Value> = events
        .into_iter()
        .map(|event| {
            serde_json::json!({
                "id": event.id,
                "sequence_number": event.sequence_number,
                "event_type": event.event_type,
                "step_id": event.step_id,
                "attempt": event.attempt,
                "data": event.data,
                "timestamp": event.timestamp
            })
        })
        .collect();

    // 2. Fetch step executions
    let steps = state.db.get_steps_for_run(run.id).await.unwrap_or_default();
    let steps_json: Vec<serde_json::Value> = steps
        .into_iter()
        .map(|step| {
            serde_json::json!({
                "step_id": step.step_id,
                "status": step.status,
                "attempt": step.attempt,
                "duration_ms": step.duration_ms,
                "started_at": step.started_at,
                "completed_at": step.completed_at
            })
        })
        .collect();

    // 3. Fetch child workflows
    let children = state
        .db
        .get_children_for_run(tenant_id, run.id)
        .await
        .unwrap_or_default();
    let children_json: Vec<serde_json::Value> = children
        .into_iter()
        .map(|child| {
            serde_json::json!({
                "child_run_id": child.id.0,
                "parent_operation_id": child.parent_operation_id,
                "workflow_version": child.workflow_version,
                "status": child.status,
                "started_at": child.started_at,
                "completed_at": child.completed_at
            })
        })
        .collect();

    let data = ExecutionTimeline {
        run,
        workflow_name,
        events: events_json,
        steps: steps_json,
        children: children_json,
    };

    Ok(Json(ApiData { data }))
}
