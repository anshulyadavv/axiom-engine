use axiom_core::{FenceToken, RunId, RunStatus, StepStatus, TenantId, WorkflowId};
use axiom_storage::{models::*, traits::*, Database};
use chrono::Utc;
use uuid::Uuid;

async fn setup_db() -> Database {
    let url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL environment variable must be set to run database tests");
    let db = Database::connect(&url)
        .await
        .expect("Failed to connect to DB");
    // Run migrations
    db.run_migrations().await.expect("Failed to run migrations");
    db
}

#[tokio::test]
async fn test_schema_migration_succeeds() {
    let db = setup_db().await;

    // Test that the schema is usable by creating a tenant
    let tenant_id = TenantId(Uuid::new_v4());
    sqlx::query("INSERT INTO tenants (id, name, slug) VALUES ($1, 'test', $2)")
        .bind(tenant_id)
        .bind(Uuid::new_v4().to_string())
        .execute(&db.pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn test_lease_acquisition_increments_token() {
    let db = setup_db().await;

    let tenant_id = TenantId(Uuid::new_v4());
    sqlx::query("INSERT INTO tenants (id, name, slug) VALUES ($1, 'test', $2)")
        .bind(tenant_id)
        .bind(Uuid::new_v4().to_string())
        .execute(&db.pool)
        .await
        .unwrap();

    let workflow_id = WorkflowId(Uuid::new_v4());
    sqlx::query("INSERT INTO workflows (id, tenant_id, name, version, definition, status) VALUES ($1, $2, 'test_wf', 1, '{}', 'active')")
        .bind(workflow_id).bind(tenant_id).execute(&db.pool).await.unwrap();

    let run_id = RunId(Uuid::new_v4());
    let run = WorkflowRunRow {
        id: run_id,
        tenant_id,
        workflow_id,
        workflow_version: 1,
        status: RunStatus::Pending,
        input: None,
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

    db.create_run(run).await.unwrap();

    // Initial token
    let token1 = db.acquire_lease(run_id, "worker-1").await.unwrap().unwrap();
    assert_eq!(token1.0, 1);

    // Concurrently try to acquire - should return None because worker-1 has the active lease
    let token_fail = db.acquire_lease(run_id, "worker-2").await.unwrap();
    assert!(token_fail.is_none());

    // Force expire lease
    sqlx::query(
        "UPDATE workflow_runs SET lease_expires_at = now() - interval '1 second' WHERE id = $1",
    )
    .bind(run_id)
    .execute(&db.pool)
    .await
    .unwrap();

    // Re-acquire by worker-2
    let token2 = db.acquire_lease(run_id, "worker-2").await.unwrap().unwrap();
    assert_eq!(token2.0, 2); // Monotonically incremented
}

#[tokio::test]
async fn test_fenced_write_succeeds_with_valid_token() {
    let db = setup_db().await;

    let tenant_id = TenantId(Uuid::new_v4());
    sqlx::query("INSERT INTO tenants (id, name, slug) VALUES ($1, 'test', $2)")
        .bind(tenant_id)
        .bind(Uuid::new_v4().to_string())
        .execute(&db.pool)
        .await
        .unwrap();

    let workflow_id = WorkflowId(Uuid::new_v4());
    sqlx::query("INSERT INTO workflows (id, tenant_id, name, version, definition, status) VALUES ($1, $2, 'test_wf', 1, '{}', 'active')")
        .bind(workflow_id).bind(tenant_id).execute(&db.pool).await.unwrap();

    let run_id = RunId(Uuid::new_v4());
    sqlx::query("INSERT INTO workflow_runs (id, tenant_id, workflow_id, workflow_version, status, worker_id, fence_token, lease_expires_at) VALUES ($1, $2, $3, 1, 'running', 'worker-1', 5, now() + interval '1 minute')")
        .bind(run_id).bind(tenant_id).bind(workflow_id).execute(&db.pool).await.unwrap();

    let event = EventRow {
        id: Uuid::new_v4(),
        run_id,
        tenant_id,
        sequence_number: 1,
        event_type: "WorkflowStarted".to_string(),
        step_id: None,
        attempt: None,
        data: serde_json::json!({}),
        timestamp: Utc::now(),
    };

    // Valid token write
    let result = db.append_event(run_id, FenceToken(5), event).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn test_fenced_write_fails_with_stale_token() {
    let db = setup_db().await;

    let tenant_id = TenantId(Uuid::new_v4());
    sqlx::query("INSERT INTO tenants (id, name, slug) VALUES ($1, 'test', $2)")
        .bind(tenant_id)
        .bind(Uuid::new_v4().to_string())
        .execute(&db.pool)
        .await
        .unwrap();

    let workflow_id = WorkflowId(Uuid::new_v4());
    sqlx::query("INSERT INTO workflows (id, tenant_id, name, version, definition, status) VALUES ($1, $2, 'test_wf', 1, '{}', 'active')")
        .bind(workflow_id).bind(tenant_id).execute(&db.pool).await.unwrap();

    let run_id = RunId(Uuid::new_v4());
    sqlx::query("INSERT INTO workflow_runs (id, tenant_id, workflow_id, workflow_version, status, worker_id, fence_token, lease_expires_at) VALUES ($1, $2, $3, 1, 'running', 'worker-2', 6, now() + interval '1 minute')")
        .bind(run_id).bind(tenant_id).bind(workflow_id).execute(&db.pool).await.unwrap();

    let event = EventRow {
        id: Uuid::new_v4(),
        run_id,
        tenant_id,
        sequence_number: 1,
        event_type: "WorkflowStarted".to_string(),
        step_id: None,
        attempt: None,
        data: serde_json::json!({}),
        timestamp: Utc::now(),
    };

    // Stale token (worker-1 thinks it has token 5)
    let result = db.append_event(run_id, FenceToken(5), event).await;
    assert!(result.is_err());

    // Check error type
    let err = result.unwrap_err();
    assert!(err.to_string().contains("Determinism violation"));
}

#[tokio::test]
async fn test_outbox_stale_claim_deletion_fails() {
    let db = setup_db().await;

    let tenant_id = TenantId(Uuid::new_v4());
    sqlx::query("INSERT INTO tenants (id, name, slug) VALUES ($1, 'test', $2)")
        .bind(tenant_id)
        .bind(Uuid::new_v4().to_string())
        .execute(&db.pool)
        .await
        .unwrap();

    let message_id = Uuid::new_v4();
    let old_claim_token = Uuid::new_v4();
    let current_claim_token = Uuid::new_v4();

    // Message currently owned by Relayer B
    sqlx::query("INSERT INTO outbox_messages (id, tenant_id, topic, payload, claim_token, available_at) VALUES ($1, $2, 'test', '{}', $3, now() + interval '30 seconds')")
        .bind(message_id).bind(tenant_id).bind(current_claim_token).execute(&db.pool).await.unwrap();

    // Relayer A attempts deletion with old claim token
    let deleted = db
        .delete_message(message_id, old_claim_token)
        .await
        .unwrap();
    assert!(!deleted);

    // Verify message still exists
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM outbox_messages WHERE id = $1)")
            .bind(message_id)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert!(exists);
}

#[tokio::test]
async fn test_renew_lease_fails_when_worker_id_does_not_match() {
    let db = setup_db().await;

    let tenant_id = TenantId(Uuid::new_v4());
    sqlx::query("INSERT INTO tenants (id, name, slug) VALUES ($1, 'test', $2)")
        .bind(tenant_id)
        .bind(Uuid::new_v4().to_string())
        .execute(&db.pool)
        .await
        .unwrap();

    let workflow_id = WorkflowId(Uuid::new_v4());
    sqlx::query("INSERT INTO workflows (id, tenant_id, name, version, definition, status) VALUES ($1, $2, 'test_wf', 1, '{}', 'active')")
        .bind(workflow_id).bind(tenant_id).execute(&db.pool).await.unwrap();

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
    db.create_run(run).await.unwrap();

    // 1. Worker-1 acquires lease
    let token1 = db.acquire_lease(run_id, "worker-1").await.unwrap().unwrap();
    assert_eq!(token1.0, 1);

    // 2. Lease is reassigned to worker-2 (keeping fence_token = 1 to test worker_id filtering)
    sqlx::query("UPDATE workflow_runs SET worker_id = 'worker-2' WHERE id = $1")
        .bind(run_id)
        .execute(&db.pool)
        .await
        .unwrap();

    // 3. Worker-1 tries to renew lease: returns false because worker_id does not match
    let renewed = db.renew_lease(run_id, "worker-1", token1).await.unwrap();
    assert!(
        !renewed,
        "Worker-1 renewal must return false when worker_id does not match"
    );
}

#[tokio::test]
async fn test_renew_lease_fails_after_reacquisition_by_another_worker() {
    let db = setup_db().await;

    let tenant_id = TenantId(Uuid::new_v4());
    sqlx::query("INSERT INTO tenants (id, name, slug) VALUES ($1, 'test', $2)")
        .bind(tenant_id)
        .bind(Uuid::new_v4().to_string())
        .execute(&db.pool)
        .await
        .unwrap();

    let workflow_id = WorkflowId(Uuid::new_v4());
    sqlx::query("INSERT INTO workflows (id, tenant_id, name, version, definition, status) VALUES ($1, $2, 'test_wf', 1, '{}', 'active')")
        .bind(workflow_id).bind(tenant_id).execute(&db.pool).await.unwrap();

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
    db.create_run(run).await.unwrap();

    // 1. Worker-1 acquires lease
    let token1 = db.acquire_lease(run_id, "worker-1").await.unwrap().unwrap();
    assert_eq!(token1.0, 1);

    // 2. Force expire lease
    sqlx::query(
        "UPDATE workflow_runs SET lease_expires_at = now() - interval '1 second' WHERE id = $1",
    )
    .bind(run_id)
    .execute(&db.pool)
    .await
    .unwrap();

    // 3. Worker-2 re-acquires the lease
    let token2 = db.acquire_lease(run_id, "worker-2").await.unwrap().unwrap();
    assert_eq!(token2.0, 2);

    // 4. Worker-1 tries to renew lease: must return false because worker-1 no longer owns the lease!
    let renewed = db.renew_lease(run_id, "worker-1", token1).await.unwrap();
    assert!(
        !renewed,
        "Worker-1 renewal must return false when lease was re-acquired by worker-2"
    );

    // Worker-2 successfully renews its own active lease
    let worker2_renewed = db.renew_lease(run_id, "worker-2", token2).await.unwrap();
    assert!(
        worker2_renewed,
        "Worker-2 should successfully renew its active lease"
    );
}
