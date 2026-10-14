use std::sync::Arc;
use tokio::net::TcpListener;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use axiom_storage::Database;
use axiom_api::server::{create_router, AppState, RateLimiter};
use axiom_api::cache::RedisCache;
use axiom_api::telemetry::TelemetryHub;
use axiom_api::handlers::workload::WorkloadGeneratorState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "axiom_api=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer().json())
        .init();

    let db_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://axiom:password@localhost:5432/axiom_engine".to_string());
        
    let db = Database::connect(&db_url).await?;
    db.run_migrations().await?;

    let builder = metrics_exporter_prometheus::PrometheusBuilder::new();
    let metrics_handle = builder.install_recorder().expect("failed to install Prometheus recorder");

    let rate_limiter = Arc::new(RateLimiter::new());
    let cache = Arc::new(RedisCache::new(None).await);
    let telemetry = Arc::new(TelemetryHub::new(2048, 200));
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

    let port = std::env::var("PORT").unwrap_or_else(|_| "3000".to_string());
    let bind_addr = format!("0.0.0.0:{}", port);
    let listener = TcpListener::bind(&bind_addr).await?;
    tracing::info!("Axiom API Gateway listening on {}", listener.local_addr()?);
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    tracing::info!("Shutdown signal received, starting graceful shutdown");
}
