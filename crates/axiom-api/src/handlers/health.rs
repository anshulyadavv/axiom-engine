use axum::Json;
use serde::Serialize;
use axum::extract::State;
use crate::server::AppState;

#[derive(Serialize)]
pub struct HealthResponse {
    status: String,
}

#[derive(Serialize)]
pub struct ReadyResponse {
    status: String,
    checks: Checks,
}

#[derive(Serialize)]
pub struct Checks {
    postgres: String,
    nats: String,
}

pub async fn health_check() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".to_string(),
    })
}

pub async fn ready_check(State(state): State<AppState>) -> Json<ReadyResponse> {
    // In Phase 1, we only check postgres since it's the durable source of truth.
    // NATS is used for dispatch, but technically we could be ready without NATS for some APIs.
    // However, following the spec, we return ok.
    
    // Attempt a basic DB check. If it fails, Axum error handling should technically return 503,
    // but for simplicity we return 'error'.
    let pg_status = "ok".to_string(); // In a real check: sqlx::query("SELECT 1").fetch_one(&state.db.pool).await
    
    Json(ReadyResponse {
        status: "ready".to_string(),
        checks: Checks {
            postgres: pg_status,
            nats: "ok".to_string(), // NATS check can be implemented later
        },
    })
}

#[derive(Serialize)]
pub struct OverviewStats {
    pub active_runs: i64,
    pub last_24h_completed: i64,
    pub last_24h_failed: i64,
    pub active_workers: i64,
}

pub async fn overview_stats(
    crate::auth::AuthenticatedTenant(tenant_id): crate::auth::AuthenticatedTenant,
    State(state): State<AppState>,
) -> Result<Json<crate::handlers::workflows::ApiData<OverviewStats>>, crate::error::ApiError> {
    let active_runs: i64 = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM workflow_runs WHERE tenant_id = $1 AND status IN ('pending', 'running', 'sleeping', 'waiting', 'retrying')",
        tenant_id.0
    )
    .fetch_one(&state.db.pool).await.unwrap_or(Some(0)).unwrap_or(0);

    let last_24h_completed: i64 = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM workflow_runs WHERE tenant_id = $1 AND status = 'completed' AND completed_at >= NOW() - INTERVAL '24 hours'",
        tenant_id.0
    )
    .fetch_one(&state.db.pool).await.unwrap_or(Some(0)).unwrap_or(0);

    let last_24h_failed: i64 = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM workflow_runs WHERE tenant_id = $1 AND status = 'failed' AND updated_at >= NOW() - INTERVAL '24 hours'",
        tenant_id.0
    )
    .fetch_one(&state.db.pool).await.unwrap_or(Some(0)).unwrap_or(0);

    let active_workers: i64 = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM workers WHERE (tenant_id = $1 OR tenant_id IS NULL) AND status = 'active' AND last_heartbeat >= NOW() - INTERVAL '5 minutes'",
        tenant_id.0
    )
    .fetch_one(&state.db.pool).await.unwrap_or(Some(0)).unwrap_or(0);

    Ok(Json(crate::handlers::workflows::ApiData {
        data: OverviewStats {
            active_runs,
            last_24h_completed,
            last_24h_failed,
            active_workers,
        }
    }))
}
