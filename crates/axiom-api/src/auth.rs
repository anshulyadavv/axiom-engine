use axum::{
    async_trait,
    extract::FromRequestParts,
    http::{request::Parts, Method},
};
use axiom_core::TenantId;
use crate::error::ApiError;
use crate::server::AppState;
use crate::crypto::hash_token;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UserRole {
    Viewer = 1,
    Operator = 2,
    Admin = 3,
}

impl UserRole {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "admin" => UserRole::Admin,
            "operator" => UserRole::Operator,
            _ => UserRole::Viewer,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            UserRole::Admin => "admin",
            UserRole::Operator => "operator",
            UserRole::Viewer => "viewer",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthenticatedUser {
    pub user_id: Option<Uuid>,
    pub tenant_id: TenantId,
    pub role: UserRole,
    pub email: Option<String>,
}

#[async_trait]
impl FromRequestParts<AppState> for AuthenticatedUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        // 1. Check Cookie-based session
        let cookie_header = parts.headers.get("Cookie")
            .and_then(|v| v.to_str().ok());

        if let Some(cookies) = cookie_header {
            for cookie in cookies.split(';') {
                let cookie = cookie.trim();
                if cookie.starts_with("axiom_session=") {
                    let raw_token = cookie.trim_start_matches("axiom_session=").trim();
                    let session_hash = hash_token(raw_token);

                    let session_row: Option<(Uuid, Uuid, String, String, String)> = sqlx::query_as(
                        "SELECT s.user_id, s.tenant_id, s.role, s.csrf_token, u.email
                         FROM user_sessions s
                         JOIN users u ON s.user_id = u.id
                         WHERE s.id = $1 AND s.expires_at > NOW()",
                    )
                    .bind(&session_hash)
                    .fetch_optional(&state.db.pool)
                    .await
                    .map_err(|e| {
                        tracing::error!("Session DB lookup error: {}", e);
                        ApiError::Internal(e.into())
                    })?;

                    if let Some((user_id, tenant_id, role_str, csrf_token, email)) = session_row {
                        // CSRF verification on state-changing requests with cookie auth
                        if matches!(parts.method, Method::POST | Method::PUT | Method::DELETE | Method::PATCH) {
                            let csrf_header = parts.headers.get("X-CSRF-Token")
                                .and_then(|v| v.to_str().ok())
                                .unwrap_or("");
                            if csrf_header != csrf_token {
                                tracing::warn!("CSRF token mismatch for user {}", user_id);
                                return Err(ApiError::Forbidden("CSRF token validation failed".into()));
                            }
                        }

                        let role = UserRole::from_str(&role_str);
                        return Ok(AuthenticatedUser {
                            user_id: Some(user_id),
                            tenant_id: TenantId(tenant_id),
                            role,
                            email: Some(email),
                        });
                    }
                }
            }
        }

        // 2. Check Authorization Header (supports both session tokens and API keys)
        let auth_header = parts.headers.get("Authorization")
            .and_then(|value| value.to_str().ok());
            
        if let Some(auth) = auth_header {
            if auth.starts_with("Bearer ") {
                let token_material = auth.trim_start_matches("Bearer ").trim();

                // 2a. Check if token_material is an active session token
                let session_hash = hash_token(token_material);
                let session_row: Option<(Uuid, Uuid, String, String)> = sqlx::query_as(
                    "SELECT s.user_id, s.tenant_id, s.role, u.email
                     FROM user_sessions s
                     JOIN users u ON s.user_id = u.id
                     WHERE s.id = $1 AND s.expires_at > NOW()",
                )
                .bind(&session_hash)
                .fetch_optional(&state.db.pool)
                .await
                .map_err(|e| {
                    tracing::error!("Bearer session lookup error: {}", e);
                    ApiError::Internal(e.into())
                })?;

                if let Some((user_id, tenant_id, role_str, email)) = session_row {
                    let role = UserRole::from_str(&role_str);
                    return Ok(AuthenticatedUser {
                        user_id: Some(user_id),
                        tenant_id: TenantId(tenant_id),
                        role,
                        email: Some(email),
                    });
                }

                // 2b. Check if token_material is an API key (hashed with SHA-256)
                let mut hasher = Sha256::new();
                hasher.update(token_material.as_bytes());
                let key_hash = hex::encode(hasher.finalize());
                
                let cache_key = format!("apikey:hash:{}", key_hash);
                if let Some(cached_tenant) = state.cache.get::<String>(&cache_key).await {
                    if let Ok(tid) = Uuid::parse_str(&cached_tenant) {
                        return Ok(AuthenticatedUser {
                            user_id: None,
                            tenant_id: TenantId(tid),
                            role: UserRole::Admin,
                            email: Some("api-key-caller@axiom.internal".into()),
                        });
                    }
                }

                let query = "SELECT tenant_id FROM tenant_api_keys WHERE key_hash = $1 AND is_active = true";
                let row: Option<(Uuid,)> = sqlx::query_as(query)
                    .bind(&key_hash)
                    .fetch_optional(&state.db.pool)
                    .await
                    .map_err(|e| {
                        tracing::error!("Auth DB error: {}", e);
                        ApiError::Internal(e.into())
                    })?;

                if let Some((tenant_uuid,)) = row {
                    state.cache.set(&cache_key, &tenant_uuid.to_string(), 30).await;
                    return Ok(AuthenticatedUser {
                        user_id: None,
                        tenant_id: TenantId(tenant_uuid),
                        role: UserRole::Admin,
                        email: Some("api-key-caller@axiom.internal".into()),
                    });
                }
            }
        }

        // 3. Check Query Parameter for EventSource/SSE (e.g. ?api_key=... or ?token=...)
        if let Some(query) = parts.uri.query() {
            for pair in query.split('&') {
                let mut it = pair.split('=');
                if let (Some(k), Some(v)) = (it.next(), it.next()) {
                    if (k == "api_key" || k == "token") && !v.is_empty() {
                        let token_material = v;
                        let session_hash = hash_token(token_material);
                        let session_row: Option<(Uuid, Uuid, String, String)> = sqlx::query_as(
                            "SELECT s.user_id, s.tenant_id, s.role, u.email
                             FROM user_sessions s
                             JOIN users u ON s.user_id = u.id
                             WHERE s.id = $1 AND s.expires_at > NOW()",
                        )
                        .bind(&session_hash)
                        .fetch_optional(&state.db.pool)
                        .await
                        .ok()
                        .flatten();

                        if let Some((user_id, tenant_id, role_str, email)) = session_row {
                            let role = UserRole::from_str(&role_str);
                            return Ok(AuthenticatedUser {
                                user_id: Some(user_id),
                                tenant_id: TenantId(tenant_id),
                                role,
                                email: Some(email),
                            });
                        }

                        let mut hasher = Sha256::new();
                        hasher.update(token_material.as_bytes());
                        let key_hash = hex::encode(hasher.finalize());
                        let cache_key = format!("apikey:hash:{}", key_hash);
                        if let Some(cached_tenant) = state.cache.get::<String>(&cache_key).await {
                            if let Ok(tid) = Uuid::parse_str(&cached_tenant) {
                                return Ok(AuthenticatedUser {
                                    user_id: None,
                                    tenant_id: TenantId(tid),
                                    role: UserRole::Admin,
                                    email: Some("api-key-caller@axiom.internal".into()),
                                });
                            }
                        }

                        let query = "SELECT tenant_id FROM tenant_api_keys WHERE key_hash = $1 AND is_active = true";
                        if let Ok(Some((tenant_uuid,))) = sqlx::query_as::<_, (Uuid,)>(query)
                            .bind(&key_hash)
                            .fetch_optional(&state.db.pool)
                            .await 
                        {
                            state.cache.set(&cache_key, &tenant_uuid.to_string(), 30).await;
                            return Ok(AuthenticatedUser {
                                user_id: None,
                                tenant_id: TenantId(tenant_uuid),
                                role: UserRole::Admin,
                                email: Some("api-key-caller@axiom.internal".into()),
                            });
                        }
                    }
                }
            }
        }

        Err(ApiError::Unauthorized)
    }
}

/// Extractor for routes that only require tenant context.
pub struct AuthenticatedTenant(pub TenantId);

#[async_trait]
impl FromRequestParts<AppState> for AuthenticatedTenant {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let user = AuthenticatedUser::from_request_parts(parts, state).await?;
        Ok(AuthenticatedTenant(user.tenant_id))
    }
}

/// Extractor that enforces Admin role.
pub struct RequireAdmin(pub AuthenticatedUser);

#[async_trait]
impl FromRequestParts<AppState> for RequireAdmin {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let user = AuthenticatedUser::from_request_parts(parts, state).await?;
        if user.role < UserRole::Admin {
            return Err(ApiError::Forbidden("Admin permissions required".into()));
        }
        Ok(RequireAdmin(user))
    }
}

/// Extractor that enforces Operator or Admin role (for write/execution operations).
pub struct RequireOperator(pub AuthenticatedUser);

#[async_trait]
impl FromRequestParts<AppState> for RequireOperator {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let user = AuthenticatedUser::from_request_parts(parts, state).await?;
        if user.role < UserRole::Operator {
            return Err(ApiError::Forbidden("Operator permissions required".into()));
        }
        Ok(RequireOperator(user))
    }
}
