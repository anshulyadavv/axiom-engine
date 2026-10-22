use anyhow::Result;
use axiom_core::RunId;
use axiom_worker::ipc::ResumeWorkflowPayload;
use axiom_worker::process::SidecarProcess;
use std::path::PathBuf;

#[tokio::test]
async fn test_correlation_mismatch() -> Result<()> {
    if std::process::Command::new("node")
        .arg("--version")
        .output()
        .is_err()
    {
        println!("Skipping test_correlation_mismatch: 'node' is not installed");
        return Ok(());
    }

    let temp_dir = tempfile::tempdir()?;
    let script_path = temp_dir.path().join("mismatch_sidecar.js");

    // Spawn a mock sidecar that purposely echoes a mismatched correlation ID
    let script = r#"
        const readline = require('readline');
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
        rl.on('line', (line) => {
            const response = {
                type: "command",
                correlation_id: "mismatched-correlation-id-9999",
                payload: {
                    command_type: "ScheduleStep",
                    step_id: "step-1"
                }
            };
            console.log(JSON.stringify(response));
        });
    "#;

    std::fs::write(&script_path, script)?;

    let mut sidecar = SidecarProcess::spawn(script_path.to_str().unwrap()).await?;

    let db_url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL environment variable must be set to run database tests");
    let db = std::sync::Arc::new(
        axiom_storage::Database::connect(&db_url)
            .await
            .expect("Failed to connect to DB"),
    );
    let tenant_id = axiom_core::TenantId(uuid::Uuid::new_v4());

    let payload = ResumeWorkflowPayload {
        run_id: RunId(uuid::Uuid::new_v4()),
        workflow_name: "test-flow".into(),
        workflow_version: 1,
        input: serde_json::json!({}),
        history: vec![],
        run_correlation_id: None,
    };

    let result = sidecar.send_resume_workflow(payload, db, tenant_id).await;
    sidecar.kill().await;

    assert!(result.is_err(), "Expected correlation mismatch error");
    let err_msg = result.unwrap_err().to_string();
    assert!(
        err_msg.contains("Correlation ID mismatch"),
        "Error message did not mention correlation ID mismatch: {}",
        err_msg
    );

    Ok(())
}

static ENV_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[tokio::test]
async fn test_ts_sidecar_ipc_exchange() -> Result<()> {
    let _lock = ENV_LOCK.lock().await;
    std::env::remove_var("AXIOM_IPC_RESUME_TIMEOUT_MS");
    // This tests the real TypeScript sidecar over stdin/stdout
    if std::process::Command::new("node")
        .arg("--version")
        .output()
        .is_err()
    {
        println!("Skipping test_ts_sidecar_ipc_exchange: 'node' is not installed");
        return Ok(());
    }

    let temp_dir = tempfile::tempdir()?;
    let script_path = temp_dir.path().join("mock_sidecar.js");

    let sdk_dist = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../packages/sdk/dist");
    let sdk_index = sdk_dist
        .join("index.js")
        .canonicalize()?
        .to_string_lossy()
        .trim_start_matches(r"\\?\")
        .replace('\\', "/");
    let sdk_worker = sdk_dist
        .join("worker.js")
        .canonicalize()?
        .to_string_lossy()
        .trim_start_matches(r"\\?\")
        .replace('\\', "/");

    let script = format!(
        r#"
        const {{ engine, startWorkerLoop }} = require("{}");
        const {{ startWorkerLoop: loopStart }} = require("{}");
        
        // Register a test flow
        engine.register({{
            name: "test-flow",
            version: 1,
            fn: async (ctx, input) => {{
                const s1 = await ctx.step.run("step-1", async () => "S1");
                const s2 = await ctx.step.run("step-2", async () => "S2");
                const s3 = await ctx.step.run("step-3", async () => "S3");
                return {{ s1, s2, s3 }};
            }}
        }});
        
        loopStart();
    "#,
        sdk_index, sdk_worker
    );

    std::fs::write(&script_path, script)?;

    let mut sidecar = SidecarProcess::spawn(script_path.to_str().unwrap()).await?;

    let db_url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL environment variable must be set to run database tests");
    let db = std::sync::Arc::new(
        axiom_storage::Database::connect(&db_url)
            .await
            .expect("Failed to connect to DB"),
    );
    let tenant_id = axiom_core::TenantId(uuid::Uuid::new_v4());

    let payload = ResumeWorkflowPayload {
        run_id: RunId(uuid::Uuid::new_v4()),
        workflow_name: "test-flow".into(),
        workflow_version: 1,
        input: serde_json::json!({}),
        history: vec![],
        run_correlation_id: None,
    };

    let cmd = sidecar.send_resume_workflow(payload, db, tenant_id).await?;
    match cmd {
        axiom_worker::ipc::CommandPayload::ScheduleStep { step_id, .. } => {
            assert_eq!(step_id, "step-1");
        }
        _ => panic!("Expected ScheduleStep"),
    }

    sidecar.kill().await;

    Ok(())
}

#[tokio::test]
async fn test_sidecar_timeout_when_hung() -> Result<()> {
    let _lock = ENV_LOCK.lock().await;
    std::env::set_var("AXIOM_IPC_RESUME_TIMEOUT_MS", "300");

    let temp_dir = tempfile::tempdir()?;
    let script_path = temp_dir.path().join("hung_sidecar.js");
    let script = r#"
        const readline = require('readline');
        const rl = readline.createInterface({ input: process.stdin, terminal: false });
        rl.on('line', () => {
            // Hung: never replies to resume_workflow
            setTimeout(() => {}, 60000);
        });
    "#;
    std::fs::write(&script_path, script)?;

    let mut sidecar = SidecarProcess::spawn(script_path.to_str().unwrap()).await?;

    let db_url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL environment variable must be set to run database tests");
    let db = std::sync::Arc::new(
        axiom_storage::Database::connect(&db_url)
            .await
            .expect("Failed to connect to DB"),
    );
    let tenant_id = axiom_core::TenantId(uuid::Uuid::new_v4());

    let payload = ResumeWorkflowPayload {
        run_id: RunId(uuid::Uuid::new_v4()),
        workflow_name: "test-flow".into(),
        workflow_version: 1,
        input: serde_json::json!({}),
        history: vec![],
        run_correlation_id: None,
    };

    let start = std::time::Instant::now();
    let result = sidecar.send_resume_workflow(payload, db, tenant_id).await;
    let elapsed = start.elapsed();

    std::env::remove_var("AXIOM_IPC_RESUME_TIMEOUT_MS");

    // 1. Returned within the limit (configured 300ms, definitely < 2000ms)
    assert!(
        elapsed < std::time::Duration::from_millis(2000),
        "Expected call to return within timeout limit, but took {:?}",
        elapsed
    );
    assert!(
        elapsed >= std::time::Duration::from_millis(250),
        "Expected call to wait for timeout duration (~300ms), but elapsed was {:?}",
        elapsed
    );

    // 2. Returns a typed timeout error
    assert!(result.is_err(), "Expected call to fail with timeout error");
    let err = result.unwrap_err();
    assert!(
        err.is_timeout(),
        "Expected typed SidecarError::Timeout, got: {:?}",
        err
    );

    // 3. Child process is dead afterwards
    assert!(
        !sidecar.is_alive(),
        "Sidecar child process should be dead after timeout"
    );
    assert!(
        sidecar.try_wait()?.is_some(),
        "Sidecar try_wait should return Some(ExitStatus)"
    );

    Ok(())
}

#[tokio::test]
async fn test_now_ipc_reproduction() -> Result<()> {
    let _lock = ENV_LOCK.lock().await;
    std::env::remove_var("AXIOM_IPC_RESUME_TIMEOUT_MS");
    if std::process::Command::new("node")
        .arg("--version")
        .output()
        .is_err()
    {
        println!("Skipping test_now_ipc_reproduction: 'node' is not installed");
        return Ok(());
    }

    let temp_dir = tempfile::tempdir()?;
    let script_path = temp_dir.path().join("now_sidecar.js");

    let sdk_dist = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../packages/sdk/dist");
    let sdk_index = sdk_dist
        .join("index.js")
        .canonicalize()?
        .to_string_lossy()
        .trim_start_matches(r"\\?\")
        .replace('\\', "/");
    let sdk_worker = sdk_dist
        .join("worker.js")
        .canonicalize()?
        .to_string_lossy()
        .trim_start_matches(r"\\?\")
        .replace('\\', "/");

    let script = format!(
        r#"
        const {{ engine }} = require("{}");
        const {{ startWorkerLoop }} = require("{}");
        
        engine.register({{
            name: "now-test-flow",
            version: 1,
            fn: async (ctx, input) => {{
                const t = ctx.now();
                return {{ timestamp: t }};
            }}
        }});
        
        startWorkerLoop();
    "#,
        sdk_index, sdk_worker
    );

    std::fs::write(&script_path, script)?;

    let mut sidecar = SidecarProcess::spawn(script_path.to_str().unwrap()).await?;

    let db_url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL environment variable must be set to run database tests");
    let db = std::sync::Arc::new(
        axiom_storage::Database::connect(&db_url)
            .await
            .expect("Failed to connect to DB"),
    );
    let tenant_id = axiom_core::TenantId(uuid::Uuid::new_v4());

    let payload = ResumeWorkflowPayload {
        run_id: RunId(uuid::Uuid::new_v4()),
        workflow_name: "now-test-flow".into(),
        workflow_version: 1,
        input: serde_json::json!({}),
        history: vec![],
        run_correlation_id: None,
    };

    let cmd_result = sidecar.send_resume_workflow(payload, db.clone(), tenant_id).await;
    sidecar.kill().await;

    let cmd = cmd_result?;
    match cmd {
        axiom_worker::ipc::CommandPayload::RecordTimestamp => {
            // First run successfully yielded RecordTimestamp
        }
        other => panic!("Expected RecordTimestamp on first run, got: {:?}", other),
    }

    // Second run: replay with TimestampRecorded event in history
    let mut sidecar2 = SidecarProcess::spawn(script_path.to_str().unwrap()).await?;
    let recorded_ts = 1712345678901i64;
    let replay_payload = ResumeWorkflowPayload {
        run_id: RunId(uuid::Uuid::new_v4()),
        workflow_name: "now-test-flow".into(),
        workflow_version: 1,
        input: serde_json::json!({}),
        history: vec![axiom_core::SemanticEvent::TimestampRecorded {
            value: recorded_ts,
        }],
        run_correlation_id: None,
    };
    let cmd2 = sidecar2
        .send_resume_workflow(replay_payload, db.clone(), tenant_id)
        .await?;
    sidecar2.kill().await;

    match cmd2 {
        axiom_worker::ipc::CommandPayload::CompleteWorkflow { output } => {
            assert_eq!(
                output,
                serde_json::json!({ "timestamp": recorded_ts }),
                "Workflow should complete on replay and return the exact recorded timestamp"
            );
        }
        other => panic!("Expected CompleteWorkflow on replay, got: {:?}", other),
    }

    Ok(())
}

#[tokio::test]
async fn test_random_ipc_exchange() -> Result<()> {
    let _lock = ENV_LOCK.lock().await;
    std::env::remove_var("AXIOM_IPC_RESUME_TIMEOUT_MS");
    if std::process::Command::new("node")
        .arg("--version")
        .output()
        .is_err()
    {
        println!("Skipping test_random_ipc_exchange: 'node' is not installed");
        return Ok(());
    }

    let temp_dir = tempfile::tempdir()?;
    let script_path = temp_dir.path().join("random_sidecar.js");

    let sdk_dist = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../packages/sdk/dist");
    let sdk_index = sdk_dist
        .join("index.js")
        .canonicalize()?
        .to_string_lossy()
        .trim_start_matches(r"\\?\")
        .replace('\\', "/");
    let sdk_worker = sdk_dist
        .join("worker.js")
        .canonicalize()?
        .to_string_lossy()
        .trim_start_matches(r"\\?\")
        .replace('\\', "/");

    let script = format!(
        r#"
        const {{ engine }} = require("{}");
        const {{ startWorkerLoop }} = require("{}");
        
        engine.register({{
            name: "random-test-flow",
            version: 1,
            fn: async (ctx, input) => {{
                const r = ctx.random();
                return {{ rand: r }};
            }}
        }});
        
        startWorkerLoop();
    "#,
        sdk_index, sdk_worker
    );

    std::fs::write(&script_path, script)?;

    let mut sidecar = SidecarProcess::spawn(script_path.to_str().unwrap()).await?;

    let db_url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL environment variable must be set to run database tests");
    let db = std::sync::Arc::new(
        axiom_storage::Database::connect(&db_url)
            .await
            .expect("Failed to connect to DB"),
    );
    let tenant_id = axiom_core::TenantId(uuid::Uuid::new_v4());

    let payload = ResumeWorkflowPayload {
        run_id: RunId(uuid::Uuid::new_v4()),
        workflow_name: "random-test-flow".into(),
        workflow_version: 1,
        input: serde_json::json!({}),
        history: vec![],
        run_correlation_id: None,
    };

    let cmd_result = sidecar.send_resume_workflow(payload, db.clone(), tenant_id).await;
    sidecar.kill().await;

    let cmd = cmd_result?;
    match cmd {
        axiom_worker::ipc::CommandPayload::RecordRandom => {
            // First run successfully yielded RecordRandom
        }
        other => panic!("Expected RecordRandom on first run, got: {:?}", other),
    }

    // Second run: replay with RandomRecorded event in history
    let mut sidecar2 = SidecarProcess::spawn(script_path.to_str().unwrap()).await?;
    let recorded_val = 0.87654321f64;
    let replay_payload = ResumeWorkflowPayload {
        run_id: RunId(uuid::Uuid::new_v4()),
        workflow_name: "random-test-flow".into(),
        workflow_version: 1,
        input: serde_json::json!({}),
        history: vec![axiom_core::SemanticEvent::RandomRecorded {
            value: recorded_val,
        }],
        run_correlation_id: None,
    };
    let cmd2 = sidecar2
        .send_resume_workflow(replay_payload, db.clone(), tenant_id)
        .await?;
    sidecar2.kill().await;

    match cmd2 {
        axiom_worker::ipc::CommandPayload::CompleteWorkflow { output } => {
            assert_eq!(
                output,
                serde_json::json!({ "rand": recorded_val }),
                "Workflow should complete on replay and return the exact recorded random number"
            );
        }
        other => panic!("Expected CompleteWorkflow on replay, got: {:?}", other),
    }

    Ok(())
}


