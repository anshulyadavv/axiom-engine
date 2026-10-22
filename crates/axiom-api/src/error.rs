use axum::{
    http::{HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use thiserror::Error;

#[derive(Clone, Debug, Serialize)]
pub struct ErrorDetail {
    pub field: String,
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct ApiErrorResponse {
    pub error: ApiErrorBody,
}

#[derive(Clone, Debug, Serialize)]
pub struct ApiErrorBody {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub details: Vec<ErrorDetail>,
    pub request_id: Option<String>,
}

#[derive(Error, Debug)]
pub enum ApiError {
    #[error("Validation Error: {0}")]
    Validation(String, Vec<ErrorDetail>),

    #[error("Unauthorized")]
    Unauthorized,

    #[error("Forbidden: {0}")]
    Forbidden(String),

    #[error("Not Found")]
    NotFound(String),

    #[error("Conflict: {0}")]
    Conflict(String),

    #[error("Unprocessable Entity: {0}")]
    Unprocessable(String),

    #[error("Rate Limited")]
    RateLimited,

    #[error("Internal Server Error")]
    Internal(#[from] anyhow::Error),

    #[error("Service Unavailable")]
    ServiceUnavailable,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, code, message, details) = match self {
            ApiError::Validation(msg, dets) => {
                (StatusCode::BAD_REQUEST, "VALIDATION_ERROR", msg, dets)
            }
            ApiError::Unauthorized => (
                StatusCode::UNAUTHORIZED,
                "UNAUTHORIZED",
                "Missing or invalid authentication".to_string(),
                vec![],
            ),
            ApiError::Forbidden(msg) => (StatusCode::FORBIDDEN, "FORBIDDEN", msg, vec![]),
            ApiError::NotFound(msg) => (StatusCode::NOT_FOUND, "NOT_FOUND", msg, vec![]),
            ApiError::Conflict(msg) => (StatusCode::CONFLICT, "CONFLICT", msg, vec![]),
            ApiError::Unprocessable(msg) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "UNPROCESSABLE",
                msg,
                vec![],
            ),
            ApiError::RateLimited => (
                StatusCode::TOO_MANY_REQUESTS,
                "RATE_LIMITED",
                "Too many requests".to_string(),
                vec![],
            ),
            ApiError::Internal(e) => {
                tracing::error!("Internal server error: {:?}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "INTERNAL_ERROR",
                    "Unexpected server error".to_string(),
                    vec![],
                )
            }
            ApiError::ServiceUnavailable => (
                StatusCode::SERVICE_UNAVAILABLE,
                "SERVICE_UNAVAILABLE",
                "Service is temporarily unable to handle the request".to_string(),
                vec![],
            ),
        };

        let body = ApiErrorResponse {
            error: ApiErrorBody {
                code: code.to_string(),
                message,
                details,
                request_id: None, // Injected via middleware if needed
            },
        };

        if status == StatusCode::TOO_MANY_REQUESTS {
            let mut response = (status, Json(body)).into_response();
            let limit_str = std::env::var("AXIOM_RATE_LIMIT_RUNS_PER_MIN")
                .unwrap_or_else(|_| "1000".to_string());
            if let Ok(limit_val) = HeaderValue::from_str(&limit_str) {
                response.headers_mut().insert("X-RateLimit-Limit", limit_val);
            }
            response
                .headers_mut()
                .insert("X-RateLimit-Remaining", HeaderValue::from_static("0"));
            response
                .headers_mut()
                .insert("X-RateLimit-Reset", HeaderValue::from_static("60"));
            response
                .headers_mut()
                .insert("Retry-After", HeaderValue::from_static("60"));
            return response;
        }

        (status, Json(body)).into_response()
    }
}
