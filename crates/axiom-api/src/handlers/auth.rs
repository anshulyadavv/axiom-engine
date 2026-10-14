use axum::{
    extract::{Path, State},
    http::header::{SET_COOKIE, HeaderMap},
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::{Duration, Utc};
use crate::{
    server::AppState,
    error::ApiError,
    auth::{AuthenticatedUser, RequireAdmin},
    crypto::{hash_password, verify_password, generate_secure_token, hash_token, encrypt_aes_gcm, decrypt_aes_gcm, resolve_master_key},
    handlers::workflows::ApiData,
};

#[derive(Deserialize)]
pub struct BootstrapReq {
    pub email: String,
    pub password: String,
    pub tenant_slug: Option<String>,
    pub bootstrap_secret: Option<String>,
}

#[derive(Serialize)]
pub struct UserInfo {
    pub id: Uuid,
    pub email: String,
    pub role: String,
    pub tenant_id: Uuid,
}

#[derive(Deserialize)]
pub struct LoginReq {
    pub email: String,
    pub password: String,
}

#[derive(Serialize)]
pub struct LoginResp {
    pub user: UserInfo,
    pub session_token: String,
    pub csrf_token: String,
}

#[derive(Deserialize)]
pub struct SetSecretReq {
    pub name: String,
    pub value: String,
}

pub async fn bootstrap_admin(
    State(state): State<AppState>,
    Json(payload): Json<BootstrapReq>,
) -> Result<Response, ApiError> {
    let email = payload.email.trim().to_lowercase();
    if email.is_empty() || !email.contains('@') {
        return Err(ApiError::Validation("Valid email address is required".into(), vec![]));
    }
    if payload.password.len() < 8 {
        return Err(ApiError::Validation("Password must be at least 8 characters".into(), vec![]));
    }

    // Check existing users count
    let user_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&state.db.pool)
        .await
        .unwrap_or(0);

    if user_count > 0 {
        // If users already exist, require valid bootstrap secret
        let configured_secret = std::env::var("AXIOM_BOOTSTRAP_SECRET").unwrap_or_default();
        if configured_secret.is_empty() || payload.bootstrap_secret.as_deref() != Some(&configured_secret) {
            return Err(ApiError::Forbidden("Bootstrap disabled: system already initialized and invalid bootstrap secret".into()));
        }
    }

    // Get or create tenant
    let slug = payload.tenant_slug.unwrap_or_else(|| "default".to_string());
    let tenant_id: Uuid = match sqlx::query_scalar::<_, Uuid>("SELECT id FROM tenants WHERE slug = $1")
        .bind(&slug)
        .fetch_optional(&state.db.pool)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?
    {
        Some(id) => id,
        None => {
            let new_id = Uuid::new_v4();
            sqlx::query("INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3)")
                .bind(new_id)
                .bind(&slug)
                .bind(&slug)
                .execute(&state.db.pool)
                .await
                .map_err(|e| ApiError::Internal(e.into()))?;
            new_id
        }
    };

    let password_hash = hash_password(&payload.password)
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("Hashing error: {}", e)))?;

    let user_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO users (id, tenant_id, email, password_hash, role) 
         VALUES ($1, $2, $3, $4, 'admin')
         ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin'",
    )
    .bind(user_id)
    .bind(tenant_id)
    .bind(&email)
    .bind(&password_hash)
    .execute(&state.db.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    // Create session so the administrator is logged in immediately
    let raw_token = generate_secure_token();
    let session_hash = hash_token(&raw_token);
    let csrf_token = generate_secure_token();
    let expires_at = Utc::now() + Duration::days(7);

    sqlx::query(
        "INSERT INTO user_sessions (id, user_id, tenant_id, role, csrf_token, expires_at)
         VALUES ($1, $2, $3, 'admin', $4, $5)",
    )
    .bind(&session_hash)
    .bind(user_id)
    .bind(tenant_id)
    .bind(&csrf_token)
    .bind(expires_at)
    .execute(&state.db.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    let cookie_val = format!(
        "axiom_session={}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800",
        raw_token
    );

    let body = Json(ApiData {
        data: LoginResp {
            user: UserInfo {
                id: user_id,
                email,
                role: "admin".into(),
                tenant_id,
            },
            session_token: raw_token,
            csrf_token,
        },
    });

    let mut response = body.into_response();
    if let Ok(cookie_header) = cookie_val.parse() {
        response.headers_mut().insert(SET_COOKIE, cookie_header);
    }
    Ok(response)
}

pub async fn login(
    State(state): State<AppState>,
    Json(payload): Json<LoginReq>,
) -> Result<Response, ApiError> {
    let email = payload.email.trim().to_lowercase();
    if email.is_empty() || payload.password.is_empty() {
        return Err(ApiError::Unauthorized);
    }

    // Query user by email
    let user_row: Option<(Uuid, Uuid, String, String)> = sqlx::query_as(
        "SELECT id, tenant_id, password_hash, role FROM users WHERE email = $1",
    )
    .bind(&email)
    .fetch_optional(&state.db.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    let (user_id, tenant_id, password_hash, role_str) = match user_row {
        Some(row) => row,
        None => return Err(ApiError::Unauthorized),
    };

    // Verify Argon2id password hash
    if verify_password(&payload.password, &password_hash).is_err() {
        tracing::warn!("Failed login attempt for email {}", email);
        return Err(ApiError::Unauthorized);
    }

    // Generate secure session token and CSRF token
    let raw_token = generate_secure_token();
    let session_hash = hash_token(&raw_token);
    let csrf_token = generate_secure_token();
    let expires_at = Utc::now() + Duration::days(7);

    sqlx::query(
        "INSERT INTO user_sessions (id, user_id, tenant_id, role, csrf_token, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(&session_hash)
    .bind(user_id)
    .bind(tenant_id)
    .bind(&role_str)
    .bind(&csrf_token)
    .bind(expires_at)
    .execute(&state.db.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    let cookie_val = format!(
        "axiom_session={}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800",
        raw_token
    );

    let body = Json(ApiData {
        data: LoginResp {
            user: UserInfo {
                id: user_id,
                email,
                role: role_str,
                tenant_id,
            },
            session_token: raw_token,
            csrf_token,
        },
    });

    let mut response = body.into_response();
    response.headers_mut().insert(
        SET_COOKIE,
        cookie_val.parse().map_err(|e| ApiError::Internal(anyhow::anyhow!("{:?}", e)))?,
    );
    Ok(response)
}

pub async fn logout(
    State(state): State<AppState>,
    user: Result<AuthenticatedUser, ApiError>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    if let Ok(_u) = user {
        if let Some(cookies) = headers.get("Cookie").and_then(|v| v.to_str().ok()) {
            for cookie in cookies.split(';') {
                let cookie = cookie.trim();
                if cookie.starts_with("axiom_session=") {
                    let raw_token = cookie.trim_start_matches("axiom_session=").trim();
                    let session_hash = hash_token(raw_token);
                    let _ = sqlx::query("DELETE FROM user_sessions WHERE id = $1")
                        .bind(&session_hash)
                        .execute(&state.db.pool)
                        .await;
                }
            }
        }
    }

    let cookie_val = "axiom_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0";
    let body = Json(serde_json::json!({ "ok": true }));
    let mut response = body.into_response();
    response.headers_mut().insert(
        SET_COOKIE,
        cookie_val.parse().unwrap(),
    );
    Ok(response)
}

pub async fn get_me(
    user: AuthenticatedUser,
) -> Result<Json<ApiData<UserInfo>>, ApiError> {
    Ok(Json(ApiData {
        data: UserInfo {
            id: user.user_id.unwrap_or_default(),
            email: user.email.unwrap_or_else(|| "api-key-caller@axiom.internal".into()),
            role: user.role.as_str().into(),
            tenant_id: user.tenant_id.0,
        },
    }))
}

pub async fn set_secret(
    RequireAdmin(user): RequireAdmin,
    State(state): State<AppState>,
    Json(payload): Json<SetSecretReq>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let master_key = resolve_master_key();
    let (ciphertext, nonce) = encrypt_aes_gcm(payload.value.as_bytes(), &master_key)
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("Encryption error: {}", e)))?;

    sqlx::query(
        "INSERT INTO encrypted_secrets (tenant_id, name, ciphertext, nonce, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (tenant_id, name) DO UPDATE SET ciphertext = EXCLUDED.ciphertext, nonce = EXCLUDED.nonce, updated_at = NOW()",
    )
    .bind(user.tenant_id.0)
    .bind(&payload.name)
    .bind(&ciphertext)
    .bind(&nonce)
    .execute(&state.db.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    Ok(Json(serde_json::json!({
        "status": "stored",
        "name": payload.name,
        "algorithm": "AES-256-GCM",
    })))
}

pub async fn get_secret(
    RequireAdmin(user): RequireAdmin,
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let master_key = resolve_master_key();
    let row: Option<(Vec<u8>, Vec<u8>)> = sqlx::query_as(
        "SELECT ciphertext, nonce FROM encrypted_secrets WHERE tenant_id = $1 AND name = $2",
    )
    .bind(user.tenant_id.0)
    .bind(&name)
    .fetch_optional(&state.db.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    match row {
        Some((ciphertext, nonce)) => {
            let plaintext_bytes = decrypt_aes_gcm(&ciphertext, &nonce, &master_key)
                .map_err(|e| ApiError::Internal(anyhow::anyhow!("Decryption error: {}", e)))?;
            let plaintext = String::from_utf8(plaintext_bytes)
                .map_err(|e| ApiError::Internal(anyhow::anyhow!("UTF-8 decode error: {}", e)))?;
            Ok(Json(serde_json::json!({
                "name": name,
                "value": plaintext,
                "algorithm": "AES-256-GCM"
            })))
        }
        None => Err(ApiError::NotFound(format!("Secret '{}' not found", name))),
    }
}
