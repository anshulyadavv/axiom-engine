use axiom_storage::Database;
use axiom_worker::{scheduler::Scheduler, consumer::WorkerConsumer, relayer::OutboxRelayer};
use async_nats::jetstream;
use std::sync::Arc;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Basic tracing for the worker
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env().add_directive("axiom_worker=debug".parse().unwrap()))
        .init();

    tracing::info!("Starting Axiom Worker...");

    let builder = metrics_exporter_prometheus::PrometheusBuilder::new();
    builder.with_http_listener("0.0.0.0:9000".parse::<std::net::SocketAddr>().unwrap())
           .install()
           .expect("failed to install Prometheus recorder");

    let db_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:5432/axiom".to_string());
    let db = Arc::new(Database::connect(&db_url).await?);
    
    let nats_url = std::env::var("NATS_URL").unwrap_or_else(|_| "nats://localhost:4222".to_string());
    let client = async_nats::connect(&nats_url).await?;
    let js = jetstream::new(client);

    let _stream = js.get_or_create_stream(async_nats::jetstream::stream::Config {
        name: "AXIOM_WORK".to_string(),
        subjects: vec!["axiom.>".to_string()],
        ..Default::default()
    }).await.expect("Failed to get or create NATS stream AXIOM_WORK");

    let worker_id = uuid::Uuid::new_v4().to_string();
    
    // Path to the MVP TS sidecar entrypoint
    let script_path = std::env::var("SIDECAR_PATH").unwrap_or_else(|_| "../../packages/sdk/dist/app.js".to_string());

    let scheduler = Scheduler {
        db: db.clone(),
        js: js.clone(),
        worker_id: worker_id.clone(),
        script_path: script_path.clone(),
    };

    let consumer = WorkerConsumer {
        db: db.clone(),
        js: js.clone(),
        script_path: script_path.clone(),
    };

    let relayer = OutboxRelayer {
        db: db.clone(),
        js: js.clone(),
    };

    tracing::info!("Axiom Worker {} running with sidecar {}", worker_id, script_path);

    tokio::select! {
        res = async {
            tokio::try_join!(
                scheduler.run(),
                consumer.run(),
                relayer.run(),
            )
        } => {
            if let Err(e) = res {
                tracing::error!("Worker tasks failed: {}", e);
            }
        },
        _ = shutdown_signal() => {
            tracing::info!("Graceful shutdown initiated. Worker stopping...");
            // Existing in-flight tasks inside the spawned consumer/scheduler will continue up to their await points.
            // Note: A true production worker would implement a CancellationToken to drain existing work 
            // before exiting. Here, we rely on lease expiry and fencing for durability.
        }
    }

    tracing::info!("Axiom Worker stopped.");
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async { tokio::signal::ctrl_c().await.expect("failed to install Ctrl+C handler"); };
    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install signal handler").recv().await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! { _ = ctrl_c => {}, _ = terminate => {}, }
}
