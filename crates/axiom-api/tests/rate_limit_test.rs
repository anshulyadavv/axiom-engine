use axiom_api::cache::RedisCache;
use axiom_api::handlers::workload::WorkloadGeneratorState;
use axiom_api::server::{create_router, AppState, RateLimiter};
use axiom_api::telemetry::TelemetryHub;
use axiom_core::{TenantId, WorkflowId};
use axiom_storage::models::WorkflowRow;
use axiom_storage::traits::WorkflowRepository;
use axiom_storage::Database;
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use tower::util::ServiceExt;
use uuid::Uuid;

static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[tokio::test]
async fn test_rate_limit_run_creation_exceeds_limit() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    std::env::remove_var("AXIOM_RATE_LIMIT_DISABLED");
    // Set configured limit to 5 runs/min for the test window
    std::env::set_var("AXIOM_RATE_LIMIT_RUNS_PER_MIN", "5");

    let db_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://axiom:password@localhost:5432/axiom_engine".to_string());
    let db = Database::connect(&db_url)
        .await
        .expect("Failed to connect to DB");

    let tenant_id = TenantId(Uuid::new_v4());

    // Insert tenant record
    sqlx::query("INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3)")
        .bind(tenant_id.0)
        .bind("Rate Limit Test Tenant")
        .bind(format!("tenant-{}", Uuid::new_v4()))
        .execute(&db.pool)
        .await
        .expect("Failed to insert tenant");

    let raw_key = format!("axm_test_{}", Uuid::new_v4());
    let mut hasher = Sha256::new();
    hasher.update(raw_key.as_bytes());
    let key_hash = hex::encode(hasher.finalize());

    // Insert active API key for tenant
    sqlx::query(
        "INSERT INTO tenant_api_keys (key_id, tenant_id, key_hash, is_active) VALUES ($1, $2, $3, true)",
    )
    .bind(format!("key_{}", Uuid::new_v4()))
    .bind(tenant_id.0)
    .bind(&key_hash)
    .execute(&db.pool)
    .await
    .expect("Failed to insert tenant API key");

    // Insert a workflow for tenant
    let workflow_id = WorkflowId(Uuid::new_v4());
    let wf = WorkflowRow {
        id: workflow_id.clone(),
        tenant_id: tenant_id.clone(),
        name: "rate-limit-test-workflow".into(),
        version: 1,
        description: None,
        definition: serde_json::json!({}),
        status: "active".into(),
        retry_policy: None,
        timeout: None,
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
    };
    db.create_workflow(wf)
        .await
        .expect("Failed to create workflow");

    let builder = metrics_exporter_prometheus::PrometheusBuilder::new();
    let metrics_handle = builder.build_recorder().handle();
    let rate_limiter = Arc::new(RateLimiter::new());
    let cache = Arc::new(RedisCache::new(None).await);
    let telemetry = Arc::new(TelemetryHub::new(100, 10));
    let workload_generator = Arc::new(WorkloadGeneratorState::new());

    let state = AppState {
        db: Arc::new(db),
        metrics_handle,
        rate_limiter,
        cache,
        telemetry,
        workload_generator,
    };

    let app = create_router(state);

    let configured_limit = 5;
    let total_requests = configured_limit + 2; // 7 requests

    let mut statuses = Vec::new();

    for i in 1..=total_requests {
        let req = Request::builder()
            .method("POST")
            .uri(format!("/v1/workflows/{}/runs", workflow_id.0))
            .header("Authorization", format!("Bearer {}", raw_key))
            .header("Content-Type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&serde_json::json!({
                    "input": { "request_num": i }
                }))
                .unwrap(),
            ))
            .unwrap();

        let response = app.clone().oneshot(req).await.unwrap();
        let status = response.status();
        if i > configured_limit {
            assert_eq!(
                status,
                StatusCode::TOO_MANY_REQUESTS,
                "Request {} exceeding limit must return HTTP 429",
                i
            );
            assert_eq!(response.headers().get("X-RateLimit-Limit").unwrap(), "5");
            assert_eq!(
                response.headers().get("X-RateLimit-Remaining").unwrap(),
                "0"
            );
            assert_eq!(response.headers().get("Retry-After").unwrap(), "60");
        }
        statuses.push(status);
    }

    // Verify first 5 requests succeeded
    for i in 0..configured_limit {
        assert_eq!(
            statuses[i],
            StatusCode::OK,
            "Request {} should have succeeded under the limit",
            i + 1
        );
    }

    // Requests exceeding limit must return 429 Too Many Requests
    assert_eq!(
        statuses[configured_limit],
        StatusCode::TOO_MANY_REQUESTS,
        "Request {} exceeding limit must return HTTP 429",
        configured_limit + 1
    );
    assert_eq!(
        statuses[configured_limit + 1],
        StatusCode::TOO_MANY_REQUESTS,
        "Request {} exceeding limit must return HTTP 429",
        configured_limit + 2
    );
}

#[tokio::test]
async fn test_rate_limit_can_be_disabled_via_env_for_benchmarks() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    // Explicitly disable rate limiting for high-throughput benchmarks
    std::env::set_var("AXIOM_RATE_LIMIT_DISABLED", "1");
    std::env::set_var("AXIOM_RATE_LIMIT_RUNS_PER_MIN", "5");

    let db_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://axiom:password@localhost:5432/axiom_engine".to_string());
    let db = Database::connect(&db_url)
        .await
        .expect("Failed to connect to DB");

    let tenant_id = TenantId(Uuid::new_v4());
    sqlx::query("INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3)")
        .bind(tenant_id.0)
        .bind("Benchmark Test Tenant")
        .bind(format!("tenant-{}", Uuid::new_v4()))
        .execute(&db.pool)
        .await
        .expect("Failed to insert tenant");

    let raw_key = format!("axm_bench_{}", Uuid::new_v4());
    let mut hasher = Sha256::new();
    hasher.update(raw_key.as_bytes());
    let key_hash = hex::encode(hasher.finalize());

    sqlx::query(
        "INSERT INTO tenant_api_keys (key_id, tenant_id, key_hash, is_active) VALUES ($1, $2, $3, true)",
    )
    .bind(format!("key_{}", Uuid::new_v4()))
    .bind(tenant_id.0)
    .bind(&key_hash)
    .execute(&db.pool)
    .await
    .expect("Failed to insert tenant API key");

    let workflow_id = WorkflowId(Uuid::new_v4());
    let wf = WorkflowRow {
        id: workflow_id.clone(),
        tenant_id: tenant_id.clone(),
        name: "benchmark-bypass-workflow".into(),
        version: 1,
        description: None,
        definition: serde_json::json!({}),
        status: "active".into(),
        retry_policy: None,
        timeout: None,
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
    };
    db.create_workflow(wf)
        .await
        .expect("Failed to create workflow");

    let builder = metrics_exporter_prometheus::PrometheusBuilder::new();
    let metrics_handle = builder.build_recorder().handle();
    let rate_limiter = Arc::new(RateLimiter::new());
    let cache = Arc::new(RedisCache::new(None).await);
    let telemetry = Arc::new(TelemetryHub::new(100, 10));
    let workload_generator = Arc::new(WorkloadGeneratorState::new());

    let state = AppState {
        db: Arc::new(db),
        metrics_handle,
        rate_limiter,
        cache,
        telemetry,
        workload_generator,
    };

    let app = create_router(state);

    // Send 10 requests which exceeds 5, but all should succeed because AXIOM_RATE_LIMIT_DISABLED=1
    for i in 1..=10 {
        let req = Request::builder()
            .method("POST")
            .uri(format!("/v1/workflows/{}/runs", workflow_id.0))
            .header("Authorization", format!("Bearer {}", raw_key))
            .header("Content-Type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&serde_json::json!({
                    "input": { "request_num": i }
                }))
                .unwrap(),
            ))
            .unwrap();

        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(
            response.status(),
            StatusCode::OK,
            "Request {} must succeed when rate limiting is disabled for benchmarks",
            i
        );
    }

    // Clean up env var
    std::env::remove_var("AXIOM_RATE_LIMIT_DISABLED");
}
