use axum::{extract::State, Json};
use crate::{
    server::AppState,
    error::ApiError,
    auth::AuthenticatedTenant,
    handlers::workflows::ApiData,
};
use axiom_storage::models::WorkerRow;
use axiom_storage::traits::WorkerRepository;

pub async fn list_workers(
    AuthenticatedTenant(tenant_id): AuthenticatedTenant,
    State(state): State<AppState>,
) -> Result<Json<ApiData<Vec<WorkerRow>>>, ApiError> {
    let workers = state.db.list_workers(tenant_id).await
        .map_err(|e| ApiError::Internal(e.into()))?;
    Ok(Json(ApiData { data: workers }))
}
