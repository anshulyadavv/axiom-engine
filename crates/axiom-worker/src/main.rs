use async_nats::jetstream;
use axiom_storage::Database;
use axiom_worker::{consumer::WorkerConsumer, relayer::OutboxRelayer, scheduler::Scheduler};
use std::sync::Arc;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Basic tracing for the worker
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("axiom_worker=debug".parse().unwrap()),
        )
        .init();

    tracing::info!("Starting Axiom Worker...");

    if axiom_worker::is_chaos_enabled() {
        tracing::warn!(
            "⚠️  CHAOS INJECTION IS ENABLED! (AXIOM_CHAOS_ENABLED=1) Fault injection active in worker consumer."
        );
    }

    let metrics_enabled = std::env::var("AXIOM_METRICS_DISABLED").as_deref() != Ok("1");
    if metrics_enabled {
        let port = std::env::var("AXIOM_PROMETHEUS_PORT").unwrap_or_else(|_| "9000".to_string());
        if let Ok(addr) = format!("0.0.0.0:{}", port).parse::<std::net::SocketAddr>() {
            let builder = metrics_exporter_prometheus::PrometheusBuilder::new();
            if let Err(e) = builder.with_http_listener(addr).install() {
                tracing::warn!("Failed to install Prometheus recorder on {}: {}", addr, e);
            }
        }
    }

    let db_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://axiom:password@localhost:5432/axiom_engine".to_string());
    let db = Arc::new(Database::connect(&db_url).await?);

    let nats_url =
        std::env::var("NATS_URL").unwrap_or_else(|_| "nats://localhost:4222".to_string());
    let client = async_nats::connect(&nats_url).await?;
    let js = jetstream::new(client);

    let _stream = js
        .get_or_create_stream(async_nats::jetstream::stream::Config {
            name: "AXIOM_WORK".to_string(),
            subjects: vec!["axiom.>".to_string()],
            ..Default::default()
        })
        .await
        .expect("Failed to get or create NATS stream AXIOM_WORK");

    let worker_id = uuid::Uuid::new_v4().to_string();

    // Path to the MVP TS sidecar entrypoint
    let script_path = std::env::var("SIDECAR_PATH").unwrap_or_else(|_| {
        if std::path::Path::new("packages/sdk/dist/app.js").exists() {
            "packages/sdk/dist/app.js".to_string()
        } else {
            "../../packages/sdk/dist/app.js".to_string()
        }
    });

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

    use axiom_storage::traits::WorkerRepository;

    let hostname = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "localhost".to_string());

    let worker_meta = serde_json::json!({
        "hostname": hostname,
        "pid": std::process::id(),
        "sidecar_path": script_path.clone(),
        "runtime": "axiom-worker-rs",
        "version": env!("CARGO_PKG_VERSION"),
    });

    if let Err(e) = db.register_worker(&worker_id, None, worker_meta).await {
        tracing::warn!("Failed to register worker in DB: {}", e);
    }

    let heartbeat_db = db.clone();
    let heartbeat_id = worker_id.clone();
    let heartbeat_handle = tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(15));
        loop {
            interval.tick().await;
            if let Err(e) = heartbeat_db.heartbeat_worker(&heartbeat_id).await {
                tracing::warn!("Failed to send worker heartbeat: {}", e);
            }
        }
    });

    tracing::info!(
        "Axiom Worker {} running with sidecar {}",
        worker_id,
        script_path
    );

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
            heartbeat_handle.abort();
            tracing::info!("Graceful shutdown initiated. Worker stopping...");
        }
    }

    tracing::info!("Axiom Worker stopped.");
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
    tokio::select! { _ = ctrl_c => {}, _ = terminate => {}, }
}
