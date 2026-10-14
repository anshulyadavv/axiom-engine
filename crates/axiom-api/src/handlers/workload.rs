use axum::{extract::State, Json};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;
use uuid::Uuid;

use axiom_core::{FenceToken, RunId, RunStatus, TenantId, WorkflowId};
use axiom_storage::models::{OutboxMessageRow, WorkflowRow, WorkflowRunRow};
use axiom_storage::traits::{RunRepository, WorkflowRepository};

use crate::{
    auth::{AuthenticatedUser, RequireAdmin},
    error::ApiError,
    handlers::workflows::ApiData,
    server::AppState,
    telemetry::{EventCategory, OperationalEvent},
};

pub struct WorkloadGeneratorState {
    pub is_running: AtomicBool,
    pub submitted_count: AtomicU64,
    pub failed_count: AtomicU64,
    pub active_type: std::sync::Mutex<Option<String>>,
}

impl WorkloadGeneratorState {
    pub fn new() -> Self {
        Self {
            is_running: AtomicBool::new(false),
            submitted_count: AtomicU64::new(0),
            failed_count: AtomicU64::new(0),
            active_type: std::sync::Mutex::new(None),
        }
    }
}

#[derive(Deserialize)]
pub struct StartWorkloadReq {
    pub workload_type: Option<String>,
    pub rate_per_minute: Option<u64>,
    pub total_runs: Option<u64>,
}

#[derive(Deserialize)]
pub struct TriggerWorkloadReq {
    pub workload_type: String,
}

#[derive(Serialize)]
pub struct WorkloadStatusResp {
    pub is_running: bool,
    pub submitted_count: u64,
    pub failed_count: u64,
    pub active_type: Option<String>,
    pub supported_types: Vec<&'static str>,
    pub supported_workloads: Vec<&'static str>,
    pub total_runs_spawned: u64,
    pub rate_per_sec: u64,
    pub max_concurrency: u64,
    pub uptime_seconds: u64,
}

pub const SUPPORTED_WORKLOAD_TYPES: &[&str] = &[
    "multi_step_flow",
    "retry_flow",
    "failing_flow",
    "delayed_flow",
    "incident_triage_agent",
    "test-flow",
];

/// Helper to ensure workflow definition exists in DB before starting runs
async fn ensure_workflow_registered(
    state: &AppState,
    tenant_id: TenantId,
    workflow_name: &str,
) -> Result<WorkflowRow, ApiError> {
    if let Ok(Some(existing)) = state.db.get_workflow_by_name(tenant_id.clone(), workflow_name, 1).await {
        return Ok(existing);
    }

    let description = match workflow_name {
        "multi_step_flow" => "Real multi-step calculation and summary pipeline",
        "retry_flow" => "Workflow with controlled bounded retry via durable state",
        "failing_flow" => "Workflow demonstrating controlled failure observability",
        "delayed_flow" => "Workflow performing bounded sleep delay",
        "incident_triage_agent" => "Real AI-agent workflow triaging operational incidents",
        _ => "Standard test workflow",
    };

    let wf = WorkflowRow {
        id: WorkflowId(Uuid::new_v4()),
        tenant_id: tenant_id.clone(),
        name: workflow_name.to_string(),
        version: 1,
        description: Some(description.to_string()),
        definition: serde_json::json!({ "name": workflow_name, "version": 1 }),
        status: "active".to_string(),
        retry_policy: None,
        timeout: Some(60000),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };

    let created = state.db.create_workflow(wf.clone()).await
        .map_err(|e| ApiError::Internal(e.into()))?;

    // Invalidate cache and emit event
    state.cache.delete(&format!("wf:{}:{}", tenant_id.0, workflow_name)).await;
    state.telemetry.emit(OperationalEvent {
        event_id: Uuid::new_v4(),
        timestamp: Utc::now(),
        category: EventCategory::Workflow,
        event_type: "workflow_registered".into(),
        tenant_id: tenant_id.0,
        workflow_id: Some(created.id.0),
        workflow_name: Some(workflow_name.to_string()),
        run_id: None,
        step_id: None,
        worker_id: None,
        message: format!("Workflow '{}' registered", workflow_name),
        metadata: serde_json::json!({ "version": 1 }),
    });

    Ok(created)
}

/// Helper to trigger a single workflow run
pub async fn submit_single_workload(
    state: &AppState,
    tenant_id: TenantId,
    workload_type: &str,
) -> Result<WorkflowRunRow, ApiError> {
    let wf = ensure_workflow_registered(state, tenant_id.clone(), workload_type).await?;

    let run_id = RunId(Uuid::new_v4());
    let correlation_id = format!("dev-workload-{}-{}", workload_type, Uuid::new_v4());

    let input = match workload_type {
        "multi_step_flow" => serde_json::json!({ "baseNumber": 42 + (rand::random::<u16>() % 500) }),
        "retry_flow" => serde_json::json!({ "simulateRecovery": true, "maxRetries": 3 }),
        "failing_flow" => serde_json::json!({ "errorMessage": "PaymentGatewayTimeout: upstream 504 on capture step" }),
        "delayed_flow" => serde_json::json!({ "durationMs": 2500 }),
        "incident_triage_agent" => serde_json::json!({
            "incidentId": format!("inc-{}", Uuid::new_v4()),
            "alertType": "WorkerHeartbeatMissed",
            "serviceName": "axiom-worker-pool-east",
            "errorSnippet": "Worker lease expired after 30s without heartbeat renewal",
            "runId": run_id.0.to_string(),
        }),
        _ => serde_json::json!({}),
    };

    let run = WorkflowRunRow {
        id: run_id,
        tenant_id: tenant_id.clone(),
        workflow_id: wf.id.clone(),
        workflow_version: wf.version,
        status: RunStatus::Pending,
        input: Some(input.clone()),
        output: None,
        error: None,
        idempotency_key: Some(format!("idemp-{}", correlation_id)),
        correlation_id: Some(correlation_id.clone()),
        parent_run_id: None,
        parent_operation_id: None,
        worker_id: None,
        fence_token: FenceToken(0),
        lease_expires_at: None,
        attempt_count: 0,
        max_attempts: 3,
        created_at: Utc::now(),
        updated_at: Utc::now(),
        started_at: None,
        completed_at: None,
    };

    let created_run = state.db.create_run(run).await
        .map_err(|e| ApiError::Internal(e.into()))?;

    // Invalidate cached overview stats
    state.cache.delete(&format!("overview:stats:{}", tenant_id.0)).await;

    // Emit live telemetry event
    state.telemetry.emit(OperationalEvent {
        event_id: Uuid::new_v4(),
        timestamp: Utc::now(),
        category: EventCategory::Run,
        event_type: "run_scheduled".into(),
        tenant_id: tenant_id.0,
        workflow_id: Some(wf.id.0),
        workflow_name: Some(wf.name.clone()),
        run_id: Some(created_run.id.0),
        step_id: None,
        worker_id: None,
        message: format!("Scheduled real development run for workflow '{}'", wf.name),
        metadata: serde_json::json!({
            "correlation_id": correlation_id,
            "workload_type": workload_type,
            "input": input,
        }),
    });

    Ok(created_run)
}

pub async fn get_status(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
) -> Result<Json<ApiData<WorkloadStatusResp>>, ApiError> {
    let is_running = state.workload_generator.is_running.load(Ordering::Relaxed);
    let submitted_count = state.workload_generator.submitted_count.load(Ordering::Relaxed);
    let failed_count = state.workload_generator.failed_count.load(Ordering::Relaxed);
    let active_type = state.workload_generator.active_type.lock().unwrap().clone();

    Ok(Json(ApiData {
        data: WorkloadStatusResp {
            is_running,
            submitted_count,
            failed_count,
            active_type,
            supported_types: SUPPORTED_WORKLOAD_TYPES.to_vec(),
            supported_workloads: SUPPORTED_WORKLOAD_TYPES.to_vec(),
            total_runs_spawned: submitted_count,
            rate_per_sec: if is_running { 1 } else { 0 },
            max_concurrency: 5,
            uptime_seconds: 60,
        },
    }))
}

pub async fn trigger_single(
    RequireAdmin(user): RequireAdmin,
    State(state): State<AppState>,
    Json(payload): Json<TriggerWorkloadReq>,
) -> Result<Json<ApiData<WorkflowRunRow>>, ApiError> {
    if !SUPPORTED_WORKLOAD_TYPES.contains(&payload.workload_type.as_str()) {
        return Err(ApiError::Validation(
            format!("Invalid workload_type. Supported types: {:?}", SUPPORTED_WORKLOAD_TYPES),
            vec![],
        ));
    }

    let run = submit_single_workload(&state, user.tenant_id, &payload.workload_type).await?;
    state.workload_generator.submitted_count.fetch_add(1, Ordering::Relaxed);

    Ok(Json(ApiData { data: run }))
}

pub async fn start_generator(
    RequireAdmin(user): RequireAdmin,
    State(state): State<AppState>,
    Json(payload): Json<StartWorkloadReq>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let w_type = payload.workload_type.unwrap_or_else(|| "multi_step_flow".to_string());
    if !SUPPORTED_WORKLOAD_TYPES.contains(&w_type.as_str()) {
        return Err(ApiError::Validation(
            format!("Invalid workload_type. Supported types: {:?}", SUPPORTED_WORKLOAD_TYPES),
            vec![],
        ));
    }

    let rate = payload.rate_per_minute.unwrap_or(12).clamp(1, 60);
    let total_limit = payload.total_runs.unwrap_or(50).clamp(1, 500);

    state.workload_generator.is_running.store(true, Ordering::Relaxed);
    *state.workload_generator.active_type.lock().unwrap() = Some(w_type.clone());

    let state_clone = state.clone();
    let tenant_id = user.tenant_id;
    let w_type_clone = w_type.clone();

    tokio::spawn(async move {
        let interval_ms = (60_000 / rate).max(1000);
        let mut submitted: u64 = 0;

        tracing::info!(
            "Starting development workload generator: type={}, rate={}/min, limit={}",
            w_type_clone, rate, total_limit
        );

        while state_clone.workload_generator.is_running.load(Ordering::Relaxed) && submitted < total_limit {
            match submit_single_workload(&state_clone, tenant_id.clone(), &w_type_clone).await {
                Ok(_) => {
                    state_clone.workload_generator.submitted_count.fetch_add(1, Ordering::Relaxed);
                    submitted += 1;
                }
                Err(e) => {
                    tracing::error!("Workload generator submission failed: {:?}", e);
                    state_clone.workload_generator.failed_count.fetch_add(1, Ordering::Relaxed);
                }
            }

            tokio::time::sleep(Duration::from_millis(interval_ms)).await;
        }

        state_clone.workload_generator.is_running.store(false, Ordering::Relaxed);
        *state_clone.workload_generator.active_type.lock().unwrap() = None;
        tracing::info!("Development workload generator finished. Submitted: {}", submitted);
    });

    Ok(Json(serde_json::json!({
        "status": "started",
        "workload_type": w_type,
        "rate_per_minute": rate,
        "total_limit": total_limit
    })))
}

pub async fn stop_generator(
    RequireAdmin(_user): RequireAdmin,
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, ApiError> {
    state.workload_generator.is_running.store(false, Ordering::Relaxed);
    *state.workload_generator.active_type.lock().unwrap() = None;
    Ok(Json(serde_json::json!({ "status": "stopped" })))
}

pub async fn cleanup_dev_workloads(
    RequireAdmin(user): RequireAdmin,
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let result = sqlx::query(
        "DELETE FROM workflow_runs 
         WHERE tenant_id = $1 AND (idempotency_key LIKE 'idemp-dev-workload-%' OR correlation_id LIKE 'dev-workload-%')",
    )
    .bind(user.tenant_id.0)
    .execute(&state.db.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    // Invalidate caches
    state.cache.delete(&format!("overview:stats:{}", user.tenant_id.0)).await;

    Ok(Json(serde_json::json!({
        "status": "cleaned",
        "purged_runs_count": result.rows_affected()
    })))
}
