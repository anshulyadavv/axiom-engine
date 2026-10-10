use axum::{
    async_trait,
    extract::FromRequestParts,
    http::request::Parts,
};
use axiom_core::TenantId;
use crate::error::ApiError;
use sha2::{Sha256, Digest};
use axiom_storage::traits::AuthRepository;
use crate::server::AppState;

pub struct AuthenticatedTenant(pub TenantId);

#[async_trait]
impl FromRequestParts<AppState> for AuthenticatedTenant
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let auth_header = parts.headers.get("Authorization")
            .and_then(|value| value.to_str().ok());
            
        match auth_header {
            Some(auth) if auth.starts_with("Bearer ") => {
                let key_material = auth.trim_start_matches("Bearer ");
                
                // Hash the key using SHA-256
                let mut hasher = Sha256::new();
                hasher.update(key_material.as_bytes());
                let result = hasher.finalize();
                let key_hash = hex::encode(result);
                
                // Lookup the tenant in the database
                let tenant_id = state.db.get_tenant_by_api_key_hash(&key_hash)
                    .await
                    .map_err(|e| {
                        tracing::error!("Auth DB error: {}", e);
                        ApiError::Internal(e.into())
                    })?;
                    
                if let Some(id) = tenant_id {
                    // Check rate limit: 100 requests per minute
                    if !state.rate_limiter.check_and_consume(id.0, 100, 2) {
                        return Err(ApiError::RateLimited);
                    }
                    Ok(AuthenticatedTenant(id))
                } else {
                    Err(ApiError::Unauthorized)
                }
            }
            _ => Err(ApiError::Unauthorized),
        }
    }
}
