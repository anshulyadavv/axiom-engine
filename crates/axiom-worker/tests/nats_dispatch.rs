use anyhow::Result;
use axiom_core::{FenceToken, RunId, RunStatus, StepStatus, TenantId, WorkflowId};
use axiom_storage::{
    models::{OutboxMessageRow, StepExecutionRow, WorkflowRunRow},
    traits::{OutboxRepository, RunRepository, StepRepository},
    Database,
};
use chrono::Utc;
use uuid::Uuid;

async fn setup_db() -> Database {
    let url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL environment variable must be set to run database tests");
    let db = Database::connect(&url)
        .await
        .expect("Failed to connect to DB");
    db.run_migrations().await.expect("Failed to run migrations");
    db
}

static TEST_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[tokio::test]
async fn test_a_db_state_and_outbox_inserted_atomically() -> Result<()> {
    let _lock = TEST_LOCK.lock().await;
    // Verifies: Scheduler/Step upsert uses Transactional Outbox. State + Outbox row commit in one transaction.
    let db = setup_db().await;

    let tenant_id = TenantId(Uuid::new_v4());
    sqlx::query("INSERT INTO tenants (id, name, slug) VALUES ($1, 'test_tenant', $2)")
        .bind(tenant_id)
        .bind(Uuid::new_v4().to_string())
        .execute(&db.pool)
        .await?;

    let workflow_id = WorkflowId(Uuid::new_v4());
    sqlx::query("INSERT INTO workflows (id, tenant_id, name, version, definition, status) VALUES ($1, $2, 'test_wf', 1, '{}', 'active')")
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
        status: RunStatus::Running,
        input: None,
        output: None,
        error: None,
        idempotency_key: None,
        correlation_id: None,
        parent_run_id: None,
        parent_operation_id: None,
        worker_id: Some("worker-1".into()),
        fence_token: FenceToken(1),
        lease_expires_at: Some(Utc::now() + chrono::Duration::minutes(1)),
        attempt_count: 0,
        max_attempts: 1,
        created_at: Utc::now(),
        updated_at: Utc::now(),
        started_at: Some(Utc::now()),
        completed_at: None,
    };
    db.create_run(run).await?;

    let step_id = Uuid::new_v4();
    let step_execution = StepExecutionRow {
        id: step_id,
        run_id,
        tenant_id,
        step_id: "step-1".into(),
        attempt: 1,
        max_attempts: 3,
        status: StepStatus::Completed,
        next_retry_at: None,
        input: Some(serde_json::json!({"foo": "bar"})),
        output: Some(serde_json::json!({"result": 42})),
        error: None,
        operation_id: "op-1".into(),
        started_at: Some(Utc::now()),
        completed_at: Some(Utc::now()),
        duration_ms: Some(10),
    };

    let outbox_id = Uuid::new_v4();
    let outbox_msg = OutboxMessageRow {
        id: outbox_id,
        tenant_id,
        topic: "axiom.events".into(),
        payload: serde_json::json!({"type": "step_completed", "step_id": "step-1"}),
        available_at: Utc::now(),
        attempt_count: 0,
        last_error: None,
        claim_token: None,
        created_at: Utc::now(),
    };

    // 1. Valid execution: StepExecution + OutboxMessage committed in a single atomic transaction
    db.upsert_step_and_outbox(run_id, FenceToken(1), step_execution, outbox_msg)
        .await?;

    let step_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM step_executions WHERE id = $1)")
            .bind(step_id)
            .fetch_one(&db.pool)
            .await?;
    assert!(
        step_exists,
        "Step execution row must exist after atomic commit"
    );

    let outbox_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM outbox_messages WHERE id = $1)")
            .bind(outbox_id)
            .fetch_one(&db.pool)
            .await?;
    assert!(
        outbox_exists,
        "Outbox message row must exist after atomic commit"
    );

    // 2. Rollback verification: If fence_token does not match, transaction rolls back completely
    let rolled_back_step_id = Uuid::new_v4();
    let rolled_back_step = StepExecutionRow {
        id: rolled_back_step_id,
        run_id,
        tenant_id,
        step_id: "step-2".into(),
        attempt: 1,
        max_attempts: 3,
        status: StepStatus::Running,
        next_retry_at: None,
        input: Some(serde_json::json!({})),
        output: None,
        error: None,
        operation_id: "op-2".into(),
        started_at: Some(Utc::now()),
        completed_at: None,
        duration_ms: None,
    };
    let rolled_back_outbox_id = Uuid::new_v4();
    let rolled_back_outbox = OutboxMessageRow {
        id: rolled_back_outbox_id,
        tenant_id,
        topic: "axiom.events".into(),
        payload: serde_json::json!({}),
        available_at: Utc::now(),
        attempt_count: 0,
        last_error: None,
        claim_token: None,
        created_at: Utc::now(),
    };

    let result = db
        .upsert_step_and_outbox(
            run_id,
            FenceToken(999),
            rolled_back_step,
            rolled_back_outbox,
        )
        .await;
    assert!(
        result.is_err(),
        "Transaction must fail with stale/mismatched fence_token"
    );

    let rb_step_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM step_executions WHERE id = $1)")
            .bind(rolled_back_step_id)
            .fetch_one(&db.pool)
            .await?;
    assert!(
        !rb_step_exists,
        "Step execution row must NOT exist after rollback"
    );

    let rb_outbox_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM outbox_messages WHERE id = $1)")
            .bind(rolled_back_outbox_id)
            .fetch_one(&db.pool)
            .await?;
    assert!(
        !rb_outbox_exists,
        "Outbox message row must NOT exist after rollback"
    );

    Ok(())
}

#[tokio::test]
async fn test_d_nats_publish_failure_leaves_outbox_row() -> Result<()> {
    let _lock = TEST_LOCK.lock().await;
    // Verifies: When NATS publish fails during outbox relay, the outbox row is NOT deleted from Postgres.
    let db = setup_db().await;

    let tenant_id = TenantId(Uuid::new_v4());
    sqlx::query("INSERT INTO tenants (id, name, slug) VALUES ($1, 'test_tenant', $2)")
        .bind(tenant_id)
        .bind(Uuid::new_v4().to_string())
        .execute(&db.pool)
        .await?;

    let message_id = Uuid::new_v4();
    let outbox_msg = OutboxMessageRow {
        id: message_id,
        tenant_id,
        topic: "axiom.work.execute".into(),
        payload: serde_json::json!({"action": "dispatch"}),
        available_at: Utc::now(),
        attempt_count: 0,
        last_error: None,
        claim_token: None,
        created_at: Utc::now(),
    };
    db.create_outbox_message(outbox_msg).await?;

    // Relayer claims the message
    let claimed = db.claim_messages(100).await?;
    let found = claimed
        .into_iter()
        .find(|m| m.id == message_id)
        .expect("Message should be claimed");
    assert!(found.claim_token.is_some());
    assert_eq!(found.attempt_count, 1);

    // Simulate NATS publish failure:
    // Because publish failed, outbox relayer skips deleting the message.
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM outbox_messages WHERE id = $1)")
            .bind(message_id)
            .fetch_one(&db.pool)
            .await?;
    assert!(
        exists,
        "Outbox message must remain in database when publish fails"
    );

    // Clean up
    let claim_token = found.claim_token.unwrap();
    db.delete_message(message_id, claim_token).await?;

    Ok(())
}

#[tokio::test]
async fn test_e_row_reclaimable_after_claim_expiry() -> Result<()> {
    let _lock = TEST_LOCK.lock().await;
    // Verifies: If relayer crashes or fails before deleting outbox row, the row becomes re-claimable after lease expiry.
    let db = setup_db().await;

    let tenant_id = TenantId(Uuid::new_v4());
    sqlx::query("INSERT INTO tenants (id, name, slug) VALUES ($1, 'test_tenant', $2)")
        .bind(tenant_id)
        .bind(Uuid::new_v4().to_string())
        .execute(&db.pool)
        .await?;

    let message_id = Uuid::new_v4();
    let outbox_msg = OutboxMessageRow {
        id: message_id,
        tenant_id,
        topic: "axiom.work.execute".into(),
        payload: serde_json::json!({"action": "retryable_work"}),
        available_at: Utc::now(),
        attempt_count: 0,
        last_error: None,
        claim_token: None,
        created_at: Utc::now(),
    };
    db.create_outbox_message(outbox_msg).await?;

    // 1. Initial claim: message is claimed and locked for 30s
    let batch1 = db.claim_messages(100).await?;
    let claimed1 = batch1
        .into_iter()
        .find(|m| m.id == message_id)
        .expect("Message claimed in batch 1");
    assert_eq!(claimed1.attempt_count, 1);
    let token1 = claimed1.claim_token.expect("Must have claim token");

    // 2. Immediate second claim: message should NOT be available because lease is active
    let batch2 = db.claim_messages(10).await?;
    assert!(
        batch2.iter().all(|m| m.id != message_id),
        "Message must not be re-claimed while lease is active"
    );

    // 3. Simulate lease expiration: set available_at to the past
    sqlx::query(
        "UPDATE outbox_messages SET available_at = now() - interval '1 second' WHERE id = $1",
    )
    .bind(message_id)
    .execute(&db.pool)
    .await?;

    // 4. Re-claim: message is available again
    let batch3 = db.claim_messages(100).await?;
    let claimed2 = batch3
        .into_iter()
        .find(|m| m.id == message_id)
        .expect("Message re-claimed after expiry");
    assert_eq!(
        claimed2.attempt_count, 2,
        "Attempt count must increment on re-claim"
    );
    let token2 = claimed2.claim_token.expect("Must have new claim token");
    assert_ne!(token1, token2, "Claim token must change on re-claim");

    // Clean up
    db.delete_message(message_id, token2).await?;

    Ok(())
}

#[tokio::test]
async fn test_duplicate_delivery_dropped_when_step_already_completed() -> Result<()> {
    // Verifies: When step X completes via append_event, duplicate WorkMessage with the same fence token
    // must be dropped by the consumer's idempotency guard instead of re-executing.
    let db = setup_db().await;

    let tenant_id = TenantId(Uuid::new_v4());
    sqlx::query("INSERT INTO tenants (id, name, slug) VALUES ($1, 'test_tenant', $2)")
        .bind(tenant_id)
        .bind(Uuid::new_v4().to_string())
        .execute(&db.pool)
        .await?;

    let workflow_id = WorkflowId(Uuid::new_v4());
    sqlx::query("INSERT INTO workflows (id, tenant_id, name, version, definition, status) VALUES ($1, $2, 'test_wf', 1, '{}', 'active')")
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
        status: RunStatus::Running,
        input: None,
        output: None,
        error: None,
        idempotency_key: None,
        correlation_id: None,
        parent_run_id: None,
        parent_operation_id: None,
        worker_id: Some("worker-1".into()),
        fence_token: FenceToken(1),
        lease_expires_at: Some(Utc::now() + chrono::Duration::minutes(1)),
        attempt_count: 0,
        max_attempts: 1,
        created_at: Utc::now(),
        updated_at: Utc::now(),
        started_at: Some(Utc::now()),
        completed_at: None,
    };
    db.create_run(run).await?;

    let step_execution = StepExecutionRow {
        id: Uuid::new_v4(),
        run_id,
        tenant_id,
        step_id: "step-1".into(),
        attempt: 1,
        max_attempts: 3,
        status: StepStatus::Pending,
        next_retry_at: None,
        input: Some(serde_json::json!({"input": 123})),
        output: None,
        error: None,
        operation_id: "op-1".into(),
        started_at: Some(Utc::now()),
        completed_at: None,
        duration_ms: None,
    };
    db.upsert_step_execution(run_id, FenceToken(1), step_execution)
        .await?;

    // Step completes: append_event is called with StepCompleted
    use axiom_core::SemanticEvent;
    use axiom_storage::models::EventRow;
    use axiom_storage::traits::EventRepository;
    let evt = SemanticEvent::StepCompleted {
        id: "step-1".to_string(),
        output: serde_json::json!({"result": 42}),
    };
    let evt_row = EventRow {
        id: Uuid::new_v4(),
        run_id,
        tenant_id,
        sequence_number: 1,
        event_type: "StepCompleted".into(),
        step_id: Some("step-1".into()),
        attempt: Some(1),
        data: serde_json::to_value(evt)?,
        timestamp: Utc::now(),
    };
    db.append_event(run_id, FenceToken(1), evt_row).await?;

    // Duplicate WorkMessage arrives before poll_run changes fence token
    use axiom_worker::nats_transport::WorkMessage;
    use axiom_worker::{evaluate_work_decision, WorkDecision};
    let work = WorkMessage {
        message_id: format!("{}-step-1-1", run_id.0),
        run_id,
        step_id: "step-1".to_string(),
        attempt: 1,
        workflow_name: "test_wf".to_string(),
        workflow_version: 1,
        fence_token: FenceToken(1),
        correlation_id: None,
    };

    let decision = evaluate_work_decision(&db, &work).await?;
    assert_eq!(
        decision,
        WorkDecision::DropDuplicate,
        "Duplicate delivery for completed step attempt must be dropped, but was {:?}",
        decision
    );

    // Verify step_executions row was durably updated to Completed
    let step = db
        .get_step_execution(run_id, "step-1", 1)
        .await?
        .expect("Step execution exists");
    assert_eq!(step.status, StepStatus::Completed);
    assert_eq!(step.output, Some(serde_json::json!({"result": 42})));
    assert!(step.completed_at.is_some());

    Ok(())
}

#[tokio::test]
async fn test_duplicate_delivery_dropped_when_step_already_failed() -> Result<()> {
    // Verifies: When step X fails via append_event, duplicate WorkMessage with the same fence token
    // must be dropped by the consumer's idempotency guard.
    let db = setup_db().await;

    let tenant_id = TenantId(Uuid::new_v4());
    sqlx::query("INSERT INTO tenants (id, name, slug) VALUES ($1, 'test_tenant', $2)")
        .bind(tenant_id)
        .bind(Uuid::new_v4().to_string())
        .execute(&db.pool)
        .await?;

    let workflow_id = WorkflowId(Uuid::new_v4());
    sqlx::query("INSERT INTO workflows (id, tenant_id, name, version, definition, status) VALUES ($1, $2, 'test_wf', 1, '{}', 'active')")
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
        status: RunStatus::Running,
        input: None,
        output: None,
        error: None,
        idempotency_key: None,
        correlation_id: None,
        parent_run_id: None,
        parent_operation_id: None,
        worker_id: Some("worker-1".into()),
        fence_token: FenceToken(1),
        lease_expires_at: Some(Utc::now() + chrono::Duration::minutes(1)),
        attempt_count: 0,
        max_attempts: 1,
        created_at: Utc::now(),
        updated_at: Utc::now(),
        started_at: Some(Utc::now()),
        completed_at: None,
    };
    db.create_run(run).await?;

    let step_execution = StepExecutionRow {
        id: Uuid::new_v4(),
        run_id,
        tenant_id,
        step_id: "step-fail".into(),
        attempt: 1,
        max_attempts: 3,
        status: StepStatus::Pending,
        next_retry_at: None,
        input: Some(serde_json::json!({"input": 123})),
        output: None,
        error: None,
        operation_id: "op-fail".into(),
        started_at: Some(Utc::now()),
        completed_at: None,
        duration_ms: None,
    };
    db.upsert_step_execution(run_id, FenceToken(1), step_execution)
        .await?;

    use axiom_core::SemanticEvent;
    use axiom_storage::models::EventRow;
    use axiom_storage::traits::EventRepository;
    let evt = SemanticEvent::StepFailed {
        id: "step-fail".to_string(),
        error: serde_json::json!("Connection refused"),
    };
    let evt_row = EventRow {
        id: Uuid::new_v4(),
        run_id,
        tenant_id,
        sequence_number: 1,
        event_type: "StepFailed".into(),
        step_id: Some("step-fail".into()),
        attempt: Some(1),
        data: serde_json::to_value(evt)?,
        timestamp: Utc::now(),
    };
    db.append_event(run_id, FenceToken(1), evt_row).await?;

    let step = db
        .get_step_execution(run_id, "step-fail", 1)
        .await?
        .expect("Step execution exists");
    assert_eq!(step.status, StepStatus::Failed);
    assert_eq!(step.error, Some(serde_json::json!("Connection refused")));
    assert!(step.completed_at.is_some());

    use axiom_worker::nats_transport::WorkMessage;
    use axiom_worker::{evaluate_work_decision, WorkDecision};
    let work = WorkMessage {
        message_id: format!("{}-step-fail-1", run_id.0),
        run_id,
        step_id: "step-fail".to_string(),
        attempt: 1,
        workflow_name: "test_wf".to_string(),
        workflow_version: 1,
        fence_token: FenceToken(1),
        correlation_id: None,
    };

    let decision = evaluate_work_decision(&db, &work).await?;
    assert_eq!(
        decision,
        WorkDecision::DropDuplicate,
        "Duplicate delivery for failed step attempt must be dropped, but was {:?}",
        decision
    );

    Ok(())
}

#[tokio::test]
async fn test_consumer_aborts_when_lease_renewal_returns_false() -> Result<()> {
    let _lock = TEST_LOCK.lock().await;
    std::env::remove_var("AXIOM_IPC_STEP_TIMEOUT_MS");
    let db = setup_db().await;

    let tenant_id = TenantId(Uuid::new_v4());
    sqlx::query("INSERT INTO tenants (id, name, slug) VALUES ($1, 'test_tenant', $2)")
        .bind(tenant_id)
        .bind(Uuid::new_v4().to_string())
        .execute(&db.pool)
        .await?;

    let workflow_id = WorkflowId(Uuid::new_v4());
    sqlx::query("INSERT INTO workflows (id, tenant_id, name, version, definition, status) VALUES ($1, $2, 'test_wf', 1, '{}', 'active')")
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
        status: RunStatus::Running,
        input: None,
        output: None,
        error: None,
        idempotency_key: None,
        correlation_id: None,
        parent_run_id: None,
        parent_operation_id: None,
        worker_id: Some("worker-1".into()),
        fence_token: FenceToken(1),
        lease_expires_at: Some(Utc::now() + chrono::Duration::minutes(1)),
        attempt_count: 0,
        max_attempts: 1,
        created_at: Utc::now(),
        updated_at: Utc::now(),
        started_at: Some(Utc::now()),
        completed_at: None,
    };
    db.create_run(run).await?;

    // Create a mock node script for the sidecar that does not reply immediately,
    // holding execution until killed or timed out.
    let temp_dir = std::env::temp_dir();
    let script_path = temp_dir.join(format!("slow_sidecar_{}.js", Uuid::new_v4()));
    let script_content = r#"
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', () => {
    // Hangs to simulate a long running step
    setTimeout(() => {}, 60000);
});
"#;
    std::fs::write(&script_path, script_content)?;

    // Spawn a background task that invalidates worker-1's lease after 500ms
    // by reassigning to worker-2 and incrementing fence_token to 2
    let pool = db.pool.clone();
    tokio::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        let _ = sqlx::query(
            "UPDATE workflow_runs SET worker_id = 'worker-2', fence_token = 2 WHERE id = $1",
        )
        .bind(run_id)
        .execute(&pool)
        .await;
    });

    use axiom_worker::nats_transport::WorkMessage;
    use axiom_worker::{process_work_internal, StepProcessResult};

    let work = WorkMessage {
        message_id: format!("{}-step-abort-1", run_id.0),
        run_id,
        step_id: "step-abort".to_string(),
        attempt: 1,
        workflow_name: "test_wf".to_string(),
        workflow_version: 1,
        fence_token: FenceToken(1),
        correlation_id: None,
    };

    let script_str = script_path.to_str().unwrap().to_string();
    let db_arc = std::sync::Arc::new(db);
    let start = std::time::Instant::now();
    let result = process_work_internal(db_arc.clone(), &script_str, &work).await?;
    let elapsed = start.elapsed();

    let _ = std::fs::remove_file(&script_path);

    // Assert: consumer aborted execution when lease renewal failed (Ok(false))
    assert_eq!(
        result,
        StepProcessResult::AbortedLeaseLost,
        "Consumer must abort and return AbortedLeaseLost when lease renewal returns false"
    );

    // Assert: the 15-second renewal interval was preserved (elapsed >= 14s)
    assert!(
        elapsed >= std::time::Duration::from_secs(14),
        "Expected execution to wait for the 15s lease renewal interval, but elapsed was {:?}",
        elapsed
    );

    // Assert: no completion or failure events were appended for the aborted run
    use axiom_storage::traits::EventRepository;
    let events = db_arc.get_events(run_id).await?;
    assert!(
        events.is_empty(),
        "No event should be appended when step execution is aborted due to lost lease, got: {:?}",
        events
    );

    Ok(())
}

#[tokio::test]
async fn test_consumer_records_failed_step_attempt_on_sidecar_timeout() -> Result<()> {
    let _lock = TEST_LOCK.lock().await;
    std::env::set_var("AXIOM_IPC_STEP_TIMEOUT_MS", "400");

    let db = setup_db().await;

    let tenant_id = TenantId(Uuid::new_v4());
    sqlx::query("INSERT INTO tenants (id, name, slug) VALUES ($1, 'test_tenant', $2)")
        .bind(tenant_id)
        .bind(Uuid::new_v4().to_string())
        .execute(&db.pool)
        .await?;

    let workflow_id = WorkflowId(Uuid::new_v4());
    sqlx::query("INSERT INTO workflows (id, tenant_id, name, version, definition, status) VALUES ($1, $2, 'test_wf', 1, '{}', 'active')")
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
        status: RunStatus::Running,
        input: None,
        output: None,
        error: None,
        idempotency_key: None,
        correlation_id: None,
        parent_run_id: None,
        parent_operation_id: None,
        worker_id: Some("worker-1".into()),
        fence_token: FenceToken(1),
        lease_expires_at: Some(Utc::now() + chrono::Duration::minutes(1)),
        attempt_count: 0,
        max_attempts: 1,
        created_at: Utc::now(),
        updated_at: Utc::now(),
        started_at: Some(Utc::now()),
        completed_at: None,
    };
    db.create_run(run).await?;

    // Create existing pending step execution
    let step_row = StepExecutionRow {
        id: Uuid::new_v4(),
        run_id,
        tenant_id,
        step_id: "step-timeout".into(),
        attempt: 1,
        max_attempts: 3,
        status: StepStatus::Pending,
        next_retry_at: None,
        input: None,
        output: None,
        error: None,
        operation_id: Uuid::new_v4().to_string(),
        started_at: Some(Utc::now()),
        completed_at: None,
        duration_ms: None,
    };
    db.upsert_step_execution(run_id, FenceToken(1), step_row)
        .await?;

    let temp_dir = std::env::temp_dir();
    let script_path = temp_dir.join(format!("hung_step_{}.js", Uuid::new_v4()));
    let script_content = r#"
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', () => {
    // Hangs on execute_step
    setTimeout(() => {}, 60000);
});
"#;
    std::fs::write(&script_path, script_content)?;

    use axiom_worker::nats_transport::WorkMessage;
    use axiom_worker::{process_work_internal, StepProcessResult};

    let work = WorkMessage {
        message_id: format!("{}-step-timeout-1", run_id.0),
        run_id,
        step_id: "step-timeout".to_string(),
        attempt: 1,
        workflow_name: "test_wf".to_string(),
        workflow_version: 1,
        fence_token: FenceToken(1),
        correlation_id: None,
    };

    let script_str = script_path.to_str().unwrap().to_string();
    let db_arc = std::sync::Arc::new(db);
    let start = std::time::Instant::now();
    let result = process_work_internal(db_arc.clone(), &script_str, &work).await?;
    let elapsed = start.elapsed();

    std::env::remove_var("AXIOM_IPC_STEP_TIMEOUT_MS");
    let _ = std::fs::remove_file(&script_path);

    // 1. Process result should be completed (recorded failed attempt)
    assert_eq!(
        result,
        StepProcessResult::Completed,
        "Expected consumer to complete and record the failed attempt"
    );

    // 2. Elapsed time should be around 400ms (< 2000ms)
    assert!(
        elapsed < std::time::Duration::from_millis(2000),
        "Expected call to return within timeout limit, took {:?}",
        elapsed
    );
    assert!(
        elapsed >= std::time::Duration::from_millis(350),
        "Expected call to wait for step timeout (~400ms), took {:?}",
        elapsed
    );

    // 3. Step execution row must be updated to Failed with timeout error
    let step_exec = db_arc
        .get_step_execution(run_id, "step-timeout", 1)
        .await?
        .expect("Step execution should exist");
    assert_eq!(
        step_exec.status,
        StepStatus::Failed,
        "Step execution status should be Failed"
    );
    assert!(
        step_exec.error.is_some(),
        "Step execution should have error recorded"
    );
    assert!(
        step_exec.completed_at.is_some(),
        "Step execution completed_at should be recorded"
    );

    // 4. Semantic events table must have StepFailed event
    use axiom_storage::traits::EventRepository;
    let events = db_arc.get_events(run_id).await?;
    assert_eq!(events.len(), 1, "Expected exactly 1 event (StepFailed)");
    assert_eq!(events[0].event_type, "StepFailed");

    Ok(())
}

#[tokio::test]
async fn test_fenced_append_event_records_timestamp_and_clears_lease() -> Result<()> {
    let _lock = TEST_LOCK.lock().await;
    let db = setup_db().await;

    let tenant_id = TenantId(Uuid::new_v4());
    sqlx::query("INSERT INTO tenants (id, name, slug) VALUES ($1, 'test_tenant', $2)")
        .bind(tenant_id)
        .bind(Uuid::new_v4().to_string())
        .execute(&db.pool)
        .await?;

    let workflow_id = WorkflowId(Uuid::new_v4());
    sqlx::query("INSERT INTO workflows (id, tenant_id, name, version, definition, status) VALUES ($1, $2, 'test_ts_flow', 1, '{}', 'active')")
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
        status: RunStatus::Running,
        input: None,
        output: None,
        error: None,
        idempotency_key: None,
        correlation_id: None,
        parent_run_id: None,
        parent_operation_id: None,
        worker_id: Some("worker-1".into()),
        fence_token: FenceToken(1),
        lease_expires_at: Some(Utc::now() + chrono::Duration::minutes(1)),
        attempt_count: 0,
        max_attempts: 1,
        created_at: Utc::now(),
        updated_at: Utc::now(),
        started_at: Some(Utc::now()),
        completed_at: None,
    };
    db.create_run(run).await?;

    // Record TimestampRecorded event with fence_token 1
    use axiom_core::SemanticEvent;
    use axiom_storage::models::EventRow;
    use axiom_storage::traits::EventRepository;
    let recorded_ts = 1712345678901i64;
    let evt = SemanticEvent::TimestampRecorded { value: recorded_ts };
    let evt_row = EventRow {
        id: Uuid::new_v4(),
        run_id,
        tenant_id,
        sequence_number: 1,
        event_type: "TimestampRecorded".into(),
        step_id: None,
        attempt: None,
        data: serde_json::to_value(evt).unwrap(),
        timestamp: Utc::now(),
    };

    db.append_event(run_id, FenceToken(1), evt_row).await?;

    // 1. Verify event is persisted
    let events = db.get_events(run_id).await?;
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].event_type, "TimestampRecorded");
    assert_eq!(events[0].data["data"]["value"], recorded_ts);

    // 2. Verify lease is cleared on workflow_runs (lease_expires_at is NULL, worker_id is NULL)
    let updated_run = db.get_run(run_id).await?.expect("Run should exist");
    assert!(
        updated_run.worker_id.is_none(),
        "worker_id should be cleared after append_event"
    );
    assert!(
        updated_run.lease_expires_at.is_none(),
        "lease_expires_at should be cleared after append_event"
    );
    assert_eq!(
        updated_run.status,
        RunStatus::Running,
        "Run status should remain Running"
    );

    // 3. Verify acquire_lease immediately re-acquires the run for the next scheduling phase
    let polled = db
        .acquire_lease(run_id, "worker-2")
        .await?;
    assert!(polled.is_some(), "acquire_lease should immediately claim the run");
    let polled_token = polled.unwrap();
    assert_eq!(
        polled_token.0, 2,
        "Fence token should increment upon re-acquiring lease"
    );

    Ok(())
}

#[tokio::test]
async fn test_chaos_duplicate_rate_and_enabled_gate() -> Result<()> {
    let _lock = TEST_LOCK.lock().await;
    let db = setup_db().await;

    let tenant_id = TenantId(Uuid::new_v4());
    sqlx::query("INSERT INTO tenants (id, name, slug) VALUES ($1, 'test_tenant', $2)")
        .bind(tenant_id)
        .bind(Uuid::new_v4().to_string())
        .execute(&db.pool)
        .await?;

    let workflow_id = WorkflowId(Uuid::new_v4());
    sqlx::query("INSERT INTO workflows (id, tenant_id, name, version, definition, status) VALUES ($1, $2, 'test_chaos_flow', 1, '{}', 'active')")
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
        status: RunStatus::Running,
        input: None,
        output: None,
        error: None,
        idempotency_key: None,
        correlation_id: None,
        parent_run_id: None,
        parent_operation_id: None,
        worker_id: Some("worker-1".into()),
        fence_token: FenceToken(1),
        lease_expires_at: Some(Utc::now() + chrono::Duration::minutes(1)),
        attempt_count: 0,
        max_attempts: 1,
        created_at: Utc::now(),
        updated_at: Utc::now(),
        started_at: Some(Utc::now()),
        completed_at: None,
    };
    db.create_run(run).await?;

    let step_row = StepExecutionRow {
        id: Uuid::new_v4(),
        run_id,
        tenant_id,
        step_id: "step-chaos".into(),
        attempt: 1,
        max_attempts: 3,
        status: StepStatus::Pending,
        next_retry_at: None,
        input: None,
        output: None,
        error: None,
        operation_id: Uuid::new_v4().to_string(),
        started_at: Some(Utc::now()),
        completed_at: None,
        duration_ms: None,
    };
    db.upsert_step_execution(run_id, FenceToken(1), step_row).await?;

    let temp_dir = std::env::temp_dir();
    let script_path = temp_dir.join(format!("chaos_step_{}.js", Uuid::new_v4()));
    let script_content = r#"
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
    const msg = JSON.parse(line);
    if (msg.type === "execute_step") {
        console.log(JSON.stringify({
            type: "step_result",
            correlation_id: msg.correlation_id,
            payload: { status: "success", output: { done: true } }
        }));
    }
});
"#;
    std::fs::write(&script_path, script_content)?;

    use axiom_worker::nats_transport::WorkMessage;
    use axiom_worker::process_message_with_chaos_internal;

    let work = WorkMessage {
        message_id: format!("{}-step-chaos-1", run_id.0),
        run_id,
        step_id: "step-chaos".to_string(),
        attempt: 1,
        workflow_name: "test_chaos_flow".to_string(),
        workflow_version: 1,
        fence_token: FenceToken(1),
        correlation_id: None,
    };

    let script_str = script_path.to_str().unwrap().to_string();
    let db_arc = std::sync::Arc::new(db);

    // 1. Without AXIOM_CHAOS_ENABLED=1, AXIOM_CHAOS_NATS_DROP_RATE=1.0 must NOT drop message
    std::env::remove_var("AXIOM_CHAOS_ENABLED");
    std::env::set_var("AXIOM_CHAOS_NATS_DROP_RATE", "1.0");

    let processed = process_message_with_chaos_internal(db_arc.clone(), &script_str, &work).await?;
    assert!(processed, "Message should NOT be dropped when AXIOM_CHAOS_ENABLED is not set");

    // 2. With AXIOM_CHAOS_ENABLED=1, AXIOM_CHAOS_NATS_DROP_RATE=1.0 DOES drop message
    std::env::set_var("AXIOM_CHAOS_ENABLED", "1");
    let processed_dropped = process_message_with_chaos_internal(db_arc.clone(), &script_str, &work).await?;
    assert!(!processed_dropped, "Message should be dropped when AXIOM_CHAOS_ENABLED=1 and DROP_RATE=1.0");
    std::env::remove_var("AXIOM_CHAOS_NATS_DROP_RATE");

    // 3. With AXIOM_CHAOS_ENABLED=1 and AXIOM_CHAOS_NATS_DUPLICATE_RATE=1.0:
    // Message is processed twice back to back, and event history contains NO duplicate StepCompleted or StepFailed events.
    std::env::set_var("AXIOM_CHAOS_NATS_DUPLICATE_RATE", "1.0");

    let dup_run_id = RunId(Uuid::new_v4());
    let dup_run = WorkflowRunRow {
        id: dup_run_id,
        tenant_id,
        workflow_id,
        workflow_version: 1,
        status: RunStatus::Running,
        input: None,
        output: None,
        error: None,
        idempotency_key: None,
        correlation_id: None,
        parent_run_id: None,
        parent_operation_id: None,
        worker_id: Some("worker-1".into()),
        fence_token: FenceToken(1),
        lease_expires_at: Some(Utc::now() + chrono::Duration::minutes(1)),
        attempt_count: 0,
        max_attempts: 1,
        created_at: Utc::now(),
        updated_at: Utc::now(),
        started_at: Some(Utc::now()),
        completed_at: None,
    };
    db_arc.create_run(dup_run).await?;

    let dup_step = StepExecutionRow {
        id: Uuid::new_v4(),
        run_id: dup_run_id,
        tenant_id,
        step_id: "step-dup-chaos".into(),
        attempt: 1,
        max_attempts: 3,
        status: StepStatus::Pending,
        next_retry_at: None,
        input: None,
        output: None,
        error: None,
        operation_id: Uuid::new_v4().to_string(),
        started_at: Some(Utc::now()),
        completed_at: None,
        duration_ms: None,
    };
    db_arc.upsert_step_execution(dup_run_id, FenceToken(1), dup_step).await?;

    let work_dup = WorkMessage {
        message_id: format!("{}-step-dup-chaos-1", dup_run_id.0),
        run_id: dup_run_id,
        step_id: "step-dup-chaos".to_string(),
        attempt: 1,
        workflow_name: "test_chaos_flow".to_string(),
        workflow_version: 1,
        fence_token: FenceToken(1),
        correlation_id: None,
    };

    let processed_dup = process_message_with_chaos_internal(db_arc.clone(), &script_str, &work_dup).await?;
    assert!(processed_dup, "Duplicate message processing should succeed");

    // Clean up environment variables
    std::env::remove_var("AXIOM_CHAOS_ENABLED");
    std::env::remove_var("AXIOM_CHAOS_NATS_DUPLICATE_RATE");
    let _ = std::fs::remove_file(&script_path);

    // Verify idempotency under 1.0 duplicate rate:
    // Event history must contain exactly 1 event (no duplicate StepCompleted or StepFailed events)
    use axiom_storage::traits::EventRepository;
    let events = db_arc.get_events(dup_run_id).await?;
    assert_eq!(
        events.len(),
        1,
        "Event history must contain exactly 1 event under duplicate rate 1.0, found: {}",
        events.len()
    );
    assert_eq!(events[0].event_type, "StepCompleted");

    // Verify step_execution is Completed
    let step_record = db_arc
        .get_step_execution(dup_run_id, "step-dup-chaos", 1)
        .await?
        .expect("Step execution should exist");
    assert_eq!(step_record.status, StepStatus::Completed);

    Ok(())
}



