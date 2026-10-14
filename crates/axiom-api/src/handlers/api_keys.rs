use axum::{
    extract::{Path, State},
    Json,
};
use serde::{Deserialize, Serialize};
use crate::{
    server::AppState,
    error::ApiError,
    auth::AuthenticatedTenant,
};
use axiom_storage::models::{ApiKeyRow, AuditLogRow};
use axiom_storage::traits::{AuthRepository, AuditRepository};
use chrono::Utc;
use uuid::Uuid;
use sha2::{Sha256, Digest};
use rand::RngCore;
use rand::rngs::OsRng;

#[derive(Deserialize)]
pub struct CreateApiKeyReq {
    pub description: Option<String>,
}

#[derive(Serialize)]
pub struct CreateApiKeyResponse {
    pub key_id: String,
    pub key: String,
    pub description: Option<String>,
    pub created_at: chrono::DateTime<Utc>,
}

#[derive(Serialize)]
pub struct ApiData<T> {
    pub data: T,
}

pub async fn create_api_key(
    AuthenticatedTenant(tenant_id): AuthenticatedTenant,
    State(state): State<AppState>,
    Json(payload): Json<CreateApiKeyReq>,
) -> Result<Json<ApiData<CreateApiKeyResponse>>, ApiError> {
    let mut key_bytes = [0u8; 32];
    OsRng.fill_bytes(&mut key_bytes);
    let key_material = hex::encode(key_bytes);
    
    // Hash the key using SHA-256
    let mut hasher = Sha256::new();
    hasher.update(key_material.as_bytes());
    let key_hash = hex::encode(hasher.finalize());
    
    let key_id = format!("key_{}", Uuid::new_v4().simple());
    
    let key_row = ApiKeyRow {
        key_id: key_id.clone(),
        tenant_id: tenant_id.clone(),
        key_hash,
        description: payload.description.clone(),
        is_active: true,
        created_at: Utc::now(),
        revoked_at: None,
    };
    
    let created = state.db.create_api_key(key_row).await
        .map_err(|e| ApiError::Internal(e.into()))?;
        
    let _ = state.db.append_audit_log(AuditLogRow {
        id: Uuid::new_v4(),
        tenant_id: tenant_id.clone(),
        action: "ApiKeyCreated".to_string(),
        resource_type: "ApiKey".to_string(),
        resource_id: Some(key_id.clone()),
        correlation_id: None,
        created_at: Utc::now(),
    }).await;
    
    Ok(Json(ApiData {
        data: CreateApiKeyResponse {
            key_id,
            key: key_material,
            description: payload.description,
            created_at: created.created_at,
        }
    }))
}

#[derive(Serialize)]
pub struct ApiKeyListResponse {
    pub key_id: String,
    pub description: Option<String>,
    pub is_active: bool,
    pub created_at: chrono::DateTime<Utc>,
    pub revoked_at: Option<chrono::DateTime<Utc>>,
}

pub async fn list_api_keys(
    AuthenticatedTenant(tenant_id): AuthenticatedTenant,
    State(state): State<AppState>,
) -> Result<Json<ApiData<Vec<ApiKeyListResponse>>>, ApiError> {
    let keys = state.db.list_api_keys(tenant_id).await
        .map_err(|e| ApiError::Internal(e.into()))?;
        
    let response = keys.into_iter().map(|k| ApiKeyListResponse {
        key_id: k.key_id,
        description: k.description,
        is_active: k.is_active,
        created_at: k.created_at,
        revoked_at: k.revoked_at,
    }).collect();
    
    Ok(Json(ApiData { data: response }))
}

pub async fn revoke_api_key(
    AuthenticatedTenant(tenant_id): AuthenticatedTenant,
    State(state): State<AppState>,
    Path(key_id): Path<String>,
) -> Result<Json<ApiData<bool>>, ApiError> {
    let revoked = state.db.revoke_api_key(tenant_id.clone(), &key_id).await
        .map_err(|e| ApiError::Internal(e.into()))?;
        
    if !revoked {
        return Err(ApiError::NotFound("API Key not found or already revoked".to_string()));
    }
    
    let _ = state.db.append_audit_log(AuditLogRow {
        id: Uuid::new_v4(),
        tenant_id: tenant_id.clone(),
        action: "ApiKeyRevoked".to_string(),
        resource_type: "ApiKey".to_string(),
        resource_id: Some(key_id.clone()),
        correlation_id: None,
        created_at: Utc::now(),
    }).await;
    
    Ok(Json(ApiData { data: true }))
}
