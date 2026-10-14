use axum::{
    extract::State,
    routing::{get, post},
    Router,
};
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use std::time::Instant;
use tower_http::cors::{AllowOrigin, Any, CorsLayer};
use tower_http::trace::TraceLayer;
use axiom_storage::Database;

use crate::{
    cache::RedisCache,
    telemetry::TelemetryHub,
    handlers::{
        health::{health_check, ready_check, overview_stats},
        workflows::{list_workflows, get_workflow, register_workflow, start_run},
        runs::{list_runs, get_run, get_run_history, cancel_run, get_run_timeline},
        workers::list_workers,
        api_keys::{create_api_key, list_api_keys, revoke_api_key},
        search::search_all,
        auth::{bootstrap_admin, login, logout, get_me, set_secret, get_secret},
        events::{event_stream, recent_events},
        telemetry::{get_cache_telemetry, get_ai_telemetry},
        workload::{get_status, trigger_single, start_generator, stop_generator, cleanup_dev_workloads, WorkloadGeneratorState},
    },
};

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Database>,
    pub metrics_handle: metrics_exporter_prometheus::PrometheusHandle,
    pub rate_limiter: Arc<RateLimiter>,
    pub cache: Arc<RedisCache>,
    pub telemetry: Arc<TelemetryHub>,
    pub workload_generator: Arc<WorkloadGeneratorState>,
}

pub struct RateLimiter {
    // tenant_id -> (tokens, last_refill)
    pub limits: Mutex<HashMap<uuid::Uuid, (u32, Instant)>>,
}

impl RateLimiter {
    pub fn new() -> Self {
        Self { limits: Mutex::new(HashMap::new()) }
    }
    
    pub fn check_and_consume(&self, id: uuid::Uuid, capacity: u32, refill_rate_per_sec: u32) -> bool {
        let mut limits = self.limits.lock().unwrap();
        let now = Instant::now();
        let entry = limits.entry(id).or_insert((capacity, now));
        
        let elapsed = now.duration_since(entry.1).as_secs();
        if elapsed > 0 {
            let add = elapsed as u32 * refill_rate_per_sec;
            entry.0 = std::cmp::min(capacity, entry.0 + add);
            entry.1 = now;
        }
        
        if entry.0 > 0 {
            entry.0 -= 1;
            true
        } else {
            false
        }
    }
}

pub fn create_router(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::mirror_request())
        .allow_methods([
            axum::http::Method::GET,
            axum::http::Method::POST,
            axum::http::Method::PUT,
            axum::http::Method::DELETE,
            axum::http::Method::OPTIONS,
        ])
        .allow_headers([
            axum::http::header::AUTHORIZATION,
            axum::http::header::CONTENT_TYPE,
            axum::http::header::ACCEPT,
            axum::http::header::ORIGIN,
            axum::http::header::HeaderName::from_static("x-tenant-id"),
            axum::http::header::HeaderName::from_static("x-api-key"),
        ])
        .allow_credentials(true);

    Router::new()
        .route("/metrics", get(|State(state): State<AppState>| async move { state.metrics_handle.render() }))
        .route("/health", get(health_check))
        .route("/ready", get(ready_check))
        .route("/v1/overview/stats", get(overview_stats))
        .route("/v1/workflows", get(list_workflows).post(register_workflow))
        .route("/v1/workflows/:id", get(get_workflow))
        .route("/v1/workflows/:id/runs", post(start_run))
        .route("/v1/runs", get(list_runs))
        .route("/v1/runs/:id", get(get_run))
        .route("/v1/runs/:id/timeline", get(get_run_timeline))
        .route("/v1/runs/:id/history", get(get_run_history))
        .route("/v1/runs/:id/cancel", post(cancel_run))
        .route("/v1/workers", get(list_workers))
        .route("/v1/api-keys", get(list_api_keys).post(create_api_key))
        .route("/v1/api-keys/:id/revoke", post(revoke_api_key))
        .route("/v1/search", get(search_all))

        // Authentication & Cryptography
        .route("/v1/auth/bootstrap", post(bootstrap_admin))
        .route("/v1/auth/login", post(login))
        .route("/v1/auth/logout", post(logout))
        .route("/v1/auth/me", get(get_me))
        .route("/v1/auth/secrets", post(set_secret))
        .route("/v1/auth/secrets/:name", get(get_secret))

        // Live Operational Events & SSE Updates
        .route("/v1/events/stream", get(event_stream))
        .route("/v1/events/recent", get(recent_events))

        // Real Telemetry Observations
        .route("/v1/telemetry/cache", get(get_cache_telemetry))
        .route("/v1/telemetry/ai", get(get_ai_telemetry))

        // Development Workload Generator
        .route("/v1/workload/status", get(get_status))
        .route("/v1/workload/start", post(start_generator))
        .route("/v1/workload/stop", post(stop_generator))
        .route("/v1/workload/trigger", post(trigger_single))
        .route("/v1/workload/cleanup", post(cleanup_dev_workloads))
        .route("/v1/dev/workload/status", get(get_status))
        .route("/v1/dev/workload/start", post(start_generator))
        .route("/v1/dev/workload/stop", post(stop_generator))
        .route("/v1/dev/workload/trigger", post(trigger_single))
        .route("/v1/dev/workload/cleanup", post(cleanup_dev_workloads))

        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
