use crate::{
    auth::AuthenticatedTenant, error::ApiError, handlers::workflows::ApiData, server::AppState,
};
use axiom_storage::models::WorkerRow;
use axiom_storage::traits::WorkerRepository;
use axum::{extract::State, Json};

pub async fn list_workers(
    AuthenticatedTenant(tenant_id): AuthenticatedTenant,
    State(state): State<AppState>,
) -> Result<Json<ApiData<Vec<WorkerRow>>>, ApiError> {
    let workers = state
        .db
        .list_workers(tenant_id)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;
    Ok(Json(ApiData { data: workers }))
}
