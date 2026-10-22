use crate::server::AppState;
use axum::extract::State;
use axum::Json;
use serde::Serialize;

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
    let pg_status = match sqlx::query("SELECT 1").execute(&state.db.pool).await {
        Ok(_) => "ok".to_string(),
        Err(_) => "error".to_string(),
    };

    Json(ReadyResponse {
        status: if pg_status == "ok" {
            "ready".to_string()
        } else {
            "degraded".to_string()
        },
        checks: Checks {
            postgres: pg_status,
            nats: "ok".to_string(),
        },
    })
}

#[derive(Serialize)]
pub struct OverviewStats {
    pub active_runs: i64,
    pub last_24h_completed: i64,
    pub last_24h_failed: i64,
    pub active_workers: i64,
    pub avg_duration_ms: Option<i64>,
    pub success_rate_pct: Option<f64>,
}

pub async fn overview_stats(
    crate::auth::AuthenticatedTenant(tenant_id): crate::auth::AuthenticatedTenant,
    State(state): State<AppState>,
) -> Result<Json<crate::handlers::workflows::ApiData<OverviewStats>>, crate::error::ApiError> {
    let active_runs: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM workflow_runs WHERE tenant_id = $1 AND status IN ('pending', 'running', 'sleeping', 'waiting', 'retrying')",
    )
    .bind(tenant_id.0)
    .fetch_one(&state.db.pool).await.unwrap_or(0);

    let last_24h_completed: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM workflow_runs WHERE tenant_id = $1 AND status = 'completed' AND COALESCE(completed_at, updated_at) >= NOW() - INTERVAL '24 hours'",
    )
    .bind(tenant_id.0)
    .fetch_one(&state.db.pool).await.unwrap_or(0);

    let last_24h_failed: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM workflow_runs WHERE tenant_id = $1 AND status = 'failed' AND COALESCE(completed_at, updated_at) >= NOW() - INTERVAL '24 hours'",
    )
    .bind(tenant_id.0)
    .fetch_one(&state.db.pool).await.unwrap_or(0);

    let active_workers: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM workers WHERE (tenant_id = $1 OR tenant_id IS NULL) AND status = 'active' AND last_heartbeat >= NOW() - INTERVAL '2 minutes'",
    )
    .bind(tenant_id.0)
    .fetch_one(&state.db.pool).await.unwrap_or(0);

    let avg_duration_ms: Option<i64> = sqlx::query_scalar(
        "SELECT CAST(AVG(EXTRACT(EPOCH FROM (COALESCE(completed_at, updated_at) - COALESCE(started_at, created_at))) * 1000) AS BIGINT)
         FROM workflow_runs
         WHERE tenant_id = $1 AND status = 'completed' AND COALESCE(completed_at, updated_at) >= NOW() - INTERVAL '24 hours'",
    )
    .bind(tenant_id.0)
    .fetch_one(&state.db.pool).await.unwrap_or(None);

    let total_terminal = last_24h_completed + last_24h_failed;
    let success_rate_pct = if total_terminal > 0 {
        Some((last_24h_completed as f64 / total_terminal as f64) * 100.0)
    } else {
        None
    };

    Ok(Json(crate::handlers::workflows::ApiData {
        data: OverviewStats {
            active_runs,
            last_24h_completed,
            last_24h_failed,
            active_workers,
            avg_duration_ms,
            success_rate_pct,
        },
    }))
}
