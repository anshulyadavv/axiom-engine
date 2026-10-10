use axum::{
    extract::State,
    routing::{get, post},
    Router,
};
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use std::time::Instant;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use axiom_storage::Database;

use crate::handlers::{
    health::{health_check, ready_check, overview_stats},
    workflows::{list_workflows, get_workflow, register_workflow, start_run},
    runs::{list_runs, get_run, get_run_history, cancel_run, get_run_timeline},
    workers::list_workers,
    api_keys::{create_api_key, list_api_keys, revoke_api_key},
    search::search_all,
};

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Database>,
    pub metrics_handle: metrics_exporter_prometheus::PrometheusHandle,
    pub rate_limiter: Arc<RateLimiter>,
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
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

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
        // Signals endpoints can be added when required
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
