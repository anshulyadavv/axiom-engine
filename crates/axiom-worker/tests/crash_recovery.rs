use anyhow::Result;
use axiom_core::{FenceToken, RunId, RunStatus, TenantId, WorkflowId};
use axiom_storage::{
    models::WorkflowRunRow,
    traits::{EventRepository, RunRepository},
    Database,
};
use chrono::Utc;
use std::path::PathBuf;
use std::time::Duration;
use tokio::time::sleep;
use uuid::Uuid;

static TEST_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[tokio::test]
async fn test_worker_crash_recovery_no_reexecution() -> Result<()> {
    let _lock = TEST_LOCK.lock().await;

    // Fail loudly if DATABASE_URL is unset (do not silently return)
    let db_url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL environment variable must be set to run database tests");
    let nats_url =
        std::env::var("NATS_URL").unwrap_or_else(|_| "nats://localhost:4222".to_string());

    let db = Database::connect(&db_url)
        .await
        .expect("Failed to connect to DB");
    db.run_migrations().await.expect("Failed to run migrations");

    // Configure lease TTL to 3 seconds for fast recovery in the test
    let lease_ttl_ms = "3000";

    // 1. Locate the axiom-worker binary and sidecar script
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let bin_name = if cfg!(windows) {
        "axiom-worker.exe"
    } else {
        "axiom-worker"
    };
    let target_dir = manifest_dir.join("../../target/debug");
    let worker_bin = target_dir
        .join(bin_name)
        .canonicalize()?
        .to_string_lossy()
        .trim_start_matches(r"\\?\")
        .to_string();

    let sdk_dist = manifest_dir.join("../../packages/sdk/dist");
    let sidecar_path = sdk_dist
        .join("app.js")
        .canonicalize()?
        .to_string_lossy()
        .trim_start_matches(r"\\?\")
        .replace('\\', "/");

    // Create execution log file for observing step executions
    let temp_dir = tempfile::tempdir()?;
    let record_file = temp_dir
        .path()
        .join(format!("records_{}.log", Uuid::new_v4()));

    // 2. Set up tenant, workflow, and pending run
    let tenant_id = TenantId(Uuid::new_v4());
    sqlx::query("INSERT INTO tenants (id, name, slug) VALUES ($1, 'crash_recovery_tenant', $2)")
        .bind(tenant_id)
        .bind(Uuid::new_v4().to_string())
        .execute(&db.pool)
        .await?;

    let workflow_id = WorkflowId(Uuid::new_v4());
    sqlx::query("INSERT INTO workflows (id, tenant_id, name, version, definition, status) VALUES ($1, $2, 'crash_recovery_workflow', 1, '{}', 'active')")
        .bind(workflow_id)
        .bind(tenant_id)
        .execute(&db.pool)
        .await?;

    let run_id = RunId(Uuid::new_v4());
    let run = WorkflowRunRow {
        id: run_id,
        tenant_id,
        workflow_id,
        workflow_version: 1,
        status: RunStatus::Pending,
        input: Some(serde_json::json!({
            "recordFile": record_file.to_str().unwrap().replace('\\', "/"),
            "step2SleepMs": 4000,
        })),
        output: None,
        error: None,
        idempotency_key: None,
        correlation_id: None,
        parent_run_id: None,
        parent_operation_id: None,
        worker_id: None,
        fence_token: FenceToken(0),
        lease_expires_at: None,
        attempt_count: 0,
        max_attempts: 1,
        created_at: Utc::now(),
        updated_at: Utc::now(),
        started_at: None,
        completed_at: None,
    };
    db.create_run(run).await?;

    // 3. Start Worker A
    println!("Starting Worker A...");
    let mut worker_a = tokio::process::Command::new(&worker_bin)
        .env("DATABASE_URL", &db_url)
        .env("NATS_URL", &nats_url)
        .env("SIDECAR_PATH", &sidecar_path)
        .env("AXIOM_LEASE_TTL_MS", lease_ttl_ms)
        .env("AXIOM_METRICS_DISABLED", "1")
        .kill_on_drop(true)
        .spawn()?;

    // 4. Poll until Step 1 completes and Step 2 is in flight
    println!("Waiting for Step 1 to complete and Step 2 to be in flight...");
    let mut step1_done = false;
    let mut step2_in_flight = false;
    let start_wait = std::time::Instant::now();

    while start_wait.elapsed() < Duration::from_secs(30) {
        let events = db.get_events(run_id).await?;
        if events
            .iter()
            .any(|e| e.event_type == "StepCompleted" && e.step_id.as_deref() == Some("step1"))
        {
            step1_done = true;
        }

        if step1_done && record_file.exists() {
            if let Ok(content) = std::fs::read_to_string(&record_file) {
                if content.contains("\"step2\"") {
                    step2_in_flight = true;
                    break;
                }
            }
        }
        sleep(Duration::from_millis(150)).await;
    }

    assert!(step1_done, "Step 1 did not complete within timeout");
    assert!(
        step2_in_flight,
        "Step 2 did not enter execution within timeout"
    );

    // Fetch the run state before kill
    let run_before_kill = db.get_run(run_id).await?.expect("Run must exist");
    let pre_kill_fence = run_before_kill.fence_token;
    let pre_kill_worker = run_before_kill.worker_id.clone().unwrap_or_default();
    println!(
        "Worker A is executing Step 2 (worker_id: {}, fence_token: {}). Hard-killing Worker A...",
        pre_kill_worker, pre_kill_fence.0
    );

    // 5. Hard-kill Worker A (not a graceful stop)
    worker_a.kill().await?;
    let _ = worker_a.wait().await;
    println!("Worker A hard-killed.");

    // 6. Wait for lease to expire
    println!(
        "Waiting for lease to expire (configured TTL: {} ms)...",
        lease_ttl_ms
    );
    let mut expired = false;
    let expire_wait = std::time::Instant::now();
    while expire_wait.elapsed() < Duration::from_secs(10) {
        let curr_run = db.get_run(run_id).await?.expect("Run must exist");
        if let Some(expires_at) = curr_run.lease_expires_at {
            if expires_at < Utc::now() {
                expired = true;
                break;
            }
        } else {
            expired = true;
            break;
        }
        sleep(Duration::from_millis(100)).await;
    }
    assert!(expired, "Lease did not expire within expected window");
    println!("Lease expired successfully.");

    // 7. Start Worker B
    println!("Starting Worker B to resume workflow...");
    let mut worker_b = tokio::process::Command::new(&worker_bin)
        .env("DATABASE_URL", &db_url)
        .env("NATS_URL", &nats_url)
        .env("SIDECAR_PATH", &sidecar_path)
        .env("AXIOM_LEASE_TTL_MS", lease_ttl_ms)
        .env("AXIOM_METRICS_DISABLED", "1")
        .kill_on_drop(true)
        .spawn()?;

    // 8. Wait for run to reach Completed status
    println!("Waiting for Worker B to complete the run...");
    let mut final_run = None;
    let complete_wait = std::time::Instant::now();
    while complete_wait.elapsed() < Duration::from_secs(45) {
        let r = db.get_run(run_id).await?.expect("Run must exist");
        if r.status == RunStatus::Completed || r.status == RunStatus::Failed {
            final_run = Some(r);
            break;
        }
        sleep(Duration::from_millis(250)).await;
    }

    // Stop Worker B
    let _ = worker_b.kill().await;
    let _ = worker_b.wait().await;

    // 9. Assertions
    let run = final_run.expect("Run must complete within timeout");
    println!("Run finished with status: {:?}", run.status);
    assert_eq!(
        run.status,
        RunStatus::Completed,
        "The run must reach Completed status, but was: {:?}",
        run.status
    );

    // Read execution records
    let records_content = std::fs::read_to_string(&record_file)?;
    let records: Vec<serde_json::Value> = records_content
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str(l).expect("Valid JSON record"))
        .collect();

    println!("Observed execution records:\n{}", records_content);

    let step1_execs: Vec<_> = records
        .iter()
        .filter(|r| r.get("step_id").and_then(|v| v.as_str()) == Some("step1"))
        .collect();

    assert_eq!(
        step1_execs.len(),
        1,
        "Step 1 has exactly one execution record (found {})",
        step1_execs.len()
    );

    // Assert: There is no duplicate StepCompleted per step_id and no DeterminismViolation in the history
    let events = db.get_events(run_id).await?;
    let determinism_violations: Vec<_> = events
        .iter()
        .filter(|e| e.event_type == "DeterminismViolation")
        .collect();
    assert!(
        determinism_violations.is_empty(),
        "Must have no DeterminismViolation in the history, found: {:?}",
        determinism_violations
    );

    for s_id in &["step1", "step2", "step3"] {
        let completions: Vec<_> = events
            .iter()
            .filter(|e| e.event_type == "StepCompleted" && e.step_id.as_deref() == Some(s_id))
            .collect();
        assert_eq!(
            completions.len(),
            1,
            "Must have no duplicate StepCompleted for {}, found: {}",
            s_id,
            completions.len()
        );
    }

    // Assert: fence_token increased
    assert!(
        run.fence_token.0 > pre_kill_fence.0,
        "fence_token must have increased (pre-kill: {}, final: {})",
        pre_kill_fence.0,
        run.fence_token.0
    );
    println!(
        "SUCCESS: fence_token increased from {} to {}",
        pre_kill_fence.0, run.fence_token.0
    );

    Ok(())
}
