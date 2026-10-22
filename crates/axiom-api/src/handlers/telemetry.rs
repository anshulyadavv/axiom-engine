use crate::{
    auth::AuthenticatedUser, cache::CacheStatsSnapshot, error::ApiError,
    handlers::workflows::ApiData, server::AppState,
};
use axum::{extract::State, Json};

pub async fn get_cache_telemetry(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
) -> Result<Json<ApiData<CacheStatsSnapshot>>, ApiError> {
    let stats = state.cache.get_stats().await;
    Ok(Json(ApiData { data: stats }))
}

pub async fn get_ai_telemetry(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
) -> Result<Json<ApiData<serde_json::Value>>, ApiError> {
    let metrics = state.telemetry.get_ai_metrics();
    Ok(Json(ApiData { data: metrics }))
}
