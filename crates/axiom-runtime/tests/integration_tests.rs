use axiom_core::{AxiomError, FenceToken, RunId, RunStatus};
use axiom_runtime::{context::ExecutionContext, ExecutionEngine, Workflow};
use axiom_storage::traits::EventRepository;
use axiom_storage::{models::*, Database};
use serde_json::{json, Value};
use std::sync::Arc;
use uuid::Uuid;

struct TestWorkflow;

impl Workflow for TestWorkflow {
    fn execute(&self, ctx: &mut ExecutionContext, _input: Value) -> Result<Value, AxiomError> {
        let r1 = ctx.execute_step("step1", json!({"input": 1}))?;
        let r2 = ctx.execute_step("step2", json!({"input": 2}))?;
        Ok(json!({"res1": r1, "res2": r2}))
    }
}

async fn setup_db() -> Database {
    let url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL environment variable must be set to run database tests");
    let db = Database::connect(&url)
        .await
        .expect("Failed to connect to DB");
    db.run_migrations().await.expect("Failed to run migrations");
    db
}

#[tokio::test]
async fn test_persistence_workflow_execution() {
    let db = setup_db().await;
    let engine = ExecutionEngine::new(Arc::new(db.clone()));

    // Create DB run
    let tenant_id = axiom_core::TenantId(Uuid::new_v4());
    sqlx::query("INSERT INTO tenants (id, name, slug) VALUES ($1, 'test', $2)")
        .bind(tenant_id)
        .bind(Uuid::new_v4().to_string())
        .execute(&db.pool)
        .await
        .unwrap();
    let workflow_id = axiom_core::WorkflowId(Uuid::new_v4());
    sqlx::query("INSERT INTO workflows (id, tenant_id, name, version, definition, status) VALUES ($1, $2, 'test_wf', 1, '{}', 'active')")
        .bind(workflow_id).bind(tenant_id).execute(&db.pool).await.unwrap();
    let run_id = RunId(Uuid::new_v4());
    sqlx::query("INSERT INTO workflow_runs (id, tenant_id, workflow_id, workflow_version, status, worker_id, fence_token, lease_expires_at) VALUES ($1, $2, $3, 1, 'running', 'worker-1', 5, now() + interval '1 minute')")
        .bind(run_id).bind(tenant_id).bind(workflow_id).execute(&db.pool).await.unwrap();

    let wf = TestWorkflow;

    // 1st Execution -> should yield ScheduleStep(step1)
    let cmd1 = engine
        .drive_workflow(run_id, FenceToken(5), &wf)
        .await
        .unwrap();
    if let axiom_runtime::Command::ScheduleStep { step_id, .. } = cmd1 {
        assert_eq!(step_id, "step1");
    } else {
        panic!("Expected ScheduleStep");
    }

    // Pretend step1 completed
    let evt = axiom_core::SemanticEvent::StepCompleted {
        id: "step1".into(),
        output: json!(10),
    };
    db.append_event(
        run_id,
        FenceToken(5),
        EventRow {
            id: Uuid::new_v4(),
            run_id,
            tenant_id,
            sequence_number: 1,
            event_type: "StepCompleted".into(),
            step_id: None,
            attempt: None,
            data: serde_json::to_value(evt).unwrap(),
            timestamp: chrono::Utc::now(),
        },
    )
    .await
    .unwrap();

    // 2nd Execution -> should yield ScheduleStep(step2)
    let cmd2 = engine
        .drive_workflow(run_id, FenceToken(5), &wf)
        .await
        .unwrap();
    if let axiom_runtime::Command::ScheduleStep { step_id, .. } = cmd2 {
        assert_eq!(step_id, "step2");
    } else {
        panic!("Expected ScheduleStep");
    }

    // Pretend step2 completed
    let evt2 = axiom_core::SemanticEvent::StepCompleted {
        id: "step2".into(),
        output: json!(20),
    };
    db.append_event(
        run_id,
        FenceToken(5),
        EventRow {
            id: Uuid::new_v4(),
            run_id,
            tenant_id,
            sequence_number: 2,
            event_type: "StepCompleted".into(),
            step_id: None,
            attempt: None,
            data: serde_json::to_value(evt2).unwrap(),
            timestamp: chrono::Utc::now(),
        },
    )
    .await
    .unwrap();

    // 3rd Execution -> should yield CompleteWorkflow
    let cmd3 = engine
        .drive_workflow(run_id, FenceToken(5), &wf)
        .await
        .unwrap();
    if let axiom_runtime::Command::CompleteWorkflow { output } = cmd3 {
        assert_eq!(output, json!({"res1": 10, "res2": 20}));
    } else {
        panic!("Expected CompleteWorkflow");
    }
}
