use crate::ipc::{CommandPayload, ExecuteStepPayload, ResumeWorkflowPayload, StepResultPayload};
use crate::nats_transport::{WorkMessage, SUBJECT_WORK_EXECUTE};
use crate::process::SidecarProcess;
use async_nats::jetstream::Context as JetStream;
use axiom_core::{AxiomError, FenceToken, RunId, RunStatus, SemanticEvent, StepStatus};
use axiom_storage::models::{EventRow, OutboxMessageRow, StepExecutionRow, WorkflowRunRow};
use axiom_storage::{
    traits::{EventRepository, RunRepository, StepRepository, WorkflowRepository},
    Database,
};
use std::sync::Arc;
use tokio::time::{sleep, Duration};
use tracing::{error, info, warn};

pub struct Scheduler {
    pub db: Arc<Database>,
    pub js: JetStream,
    pub worker_id: String,
    pub script_path: String,
}

impl Scheduler {
    pub async fn run(&self) -> anyhow::Result<()> {
        let poll_interval_ms: u64 = std::env::var("AXIOM_SCHEDULER_POLL_MS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(2000);
        let idle_sleep = Duration::from_millis(poll_interval_ms);
        let sleep_always = std::env::var("AXIOM_SCHEDULER_SLEEP_ALWAYS").as_deref() == Ok("1");

        loop {
            match self.poll_and_execute().await {
                Ok(true) => {
                    if sleep_always {
                        sleep(idle_sleep).await;
                    } else {
                        tokio::task::yield_now().await;
                    }
                }
                Ok(false) => {
                    sleep(idle_sleep).await;
                }
                Err(e) => {
                    error!("Scheduler error: {:?}", e);
                    sleep(idle_sleep).await;
                }
            }
        }
    }

    pub async fn poll_and_execute(&self) -> anyhow::Result<bool> {
        // 1. Discover and Acquire Lease (PostgreSQL Authored)
        let Some((run_id, fence_token)) = self
            .db
            .poll_run(&self.worker_id, Duration::from_secs(30))
            .await?
        else {
            return Ok(false); // Nothing to do
        };

        info!(run_id = %run_id.0, fence_token = %fence_token.0, "Acquired lease for run");

        // 2. Obtain Run and History
        let run = self.db.get_run(run_id).await?.unwrap();

        let _span = tracing::info_span!("poll_and_execute",
            run_id = %run_id.0,
            correlation_id = ?run.correlation_id,
            workflow_id = %run.workflow_id.0,
            fence_token = %fence_token.0
        )
        .entered();

        let wf = self
            .db
            .get_workflow(run.workflow_id.clone())
            .await?
            .unwrap();
        let workflow_name = wf.name;

        let event_rows = self.db.get_events(run_id).await?;
        let history: Vec<SemanticEvent> = event_rows
            .into_iter()
            .filter_map(|row| {
                serde_json::from_value::<SemanticEvent>(row.data.clone())
                    .ok()
                    .or_else(|| {
                        let obj = serde_json::json!({
                            "type": row.event_type,
                            "data": row.data
                        });
                        serde_json::from_value::<SemanticEvent>(obj).ok()
                    })
            })
            .collect();

        // 3. Spawn Sidecar (For Control Flow / Resume Workflow)
        let mut sidecar = SidecarProcess::spawn(&self.script_path).await?;

        // 4. Send resume_workflow
        let resume_payload = ResumeWorkflowPayload {
            run_id,
            workflow_name: workflow_name.clone(),
            workflow_version: run.workflow_version,
            input: run.input.clone().unwrap_or(serde_json::Value::Null),
            history: history.clone(),
            run_correlation_id: run.correlation_id.clone(),
        };

        let command = match sidecar
            .send_resume_workflow(resume_payload, self.db.clone(), run.tenant_id.clone())
            .await
        {
            Ok(cmd) => cmd,
            Err(e) => {
                error!("Sidecar failed during resume: {}", e);
                sidecar.kill().await;
                if e.is_timeout() {
                    warn!(
                        run_id = %run_id.0,
                        "IPC resume_workflow timed out. Failing run cleanly."
                    );
                    CommandPayload::FailWorkflow {
                        error: crate::ipc::IpcError {
                            message: format!("IPC resume_workflow timed out: {}", e),
                            error_type: Some("TimeoutError".to_string()),
                            is_determinism_violation: Some(false),
                            is_retryable: Some(false),
                        },
                    }
                } else {
                    return Err(e.into());
                }
            }
        };

        sidecar.kill().await; // Done with sidecar for scheduling phase

        // 5. Validate & Persist Command -> Dispatch to NATS
        match command {
            CommandPayload::ScheduleStep { step_id, options } => {
                info!(run_id = %run_id.0, step_id = %step_id, "TS yielded ScheduleStep");

                let prior_steps = self.db.get_steps_for_run(run_id).await.unwrap_or_default();
                let attempt = prior_steps
                    .iter()
                    .filter(|s| s.step_id == step_id)
                    .map(|s| s.attempt)
                    .max()
                    .unwrap_or(0)
                    + 1;

                let step_row = StepExecutionRow {
                    id: uuid::Uuid::new_v4(),
                    run_id,
                    tenant_id: run.tenant_id,
                    step_id: step_id.clone(),
                    attempt,
                    max_attempts: 3,
                    status: StepStatus::Pending,
                    next_retry_at: None,
                    input: options,
                    output: None,
                    error: None,
                    operation_id: uuid::Uuid::new_v4().to_string(),
                    started_at: None,
                    completed_at: None,
                    duration_ms: None,
                };

                // NATS Dispatch Intent
                let work_msg = WorkMessage {
                    message_id: format!("{}-{}-{}", run_id.0, step_id, attempt),
                    run_id,
                    step_id: step_id.clone(),
                    attempt,
                    workflow_name: workflow_name.clone(),
                    workflow_version: run.workflow_version,
                    fence_token,
                    correlation_id: run.correlation_id.clone(),
                };

                use axiom_storage::models::OutboxMessageRow;
                let outbox_row = OutboxMessageRow {
                    id: uuid::Uuid::new_v4(),
                    tenant_id: run.tenant_id,
                    topic: SUBJECT_WORK_EXECUTE.to_string(),
                    payload: serde_json::to_value(&work_msg).unwrap(),
                    available_at: chrono::Utc::now(),
                    attempt_count: 0,
                    last_error: None,
                    claim_token: None,
                    created_at: chrono::Utc::now(),
                };

                // ATOMIC WRITE: Step Execution Intent + Outbox Dispatch Intent
                if let Err(e) = self
                    .db
                    .upsert_step_and_outbox(run_id, fence_token, step_row, outbox_row)
                    .await
                {
                    error!(run_id = %run_id.0, step_id = %step_id, error = %e, "Atomic outbox write failed for step, aborting dispatch");
                    return Ok(true);
                } else {
                    info!(run_id = %run_id.0, step_id = %step_id, "Durably wrote atomic step execution + outbox intent");
                }
            }
            CommandPayload::ScheduleChildWorkflow {
                workflow_name,
                workflow_version,
                input,
                operation_id,
            } => {
                info!(run_id = %run_id.0, child_name = %workflow_name, child_version = %workflow_version, op_id = %operation_id, "TS yielded ScheduleChildWorkflow");

                // 1. Resolve exact workflow version
                if let Some(workflow) = self
                    .db
                    .get_workflow_by_name(run.tenant_id, &workflow_name, workflow_version)
                    .await
                    .map_err(|e| AxiomError::Internal(e.to_string()))?
                {
                    // 2. Check if child already exists for this operation ID
                    let existing_child = self
                        .db
                        .get_child_run(run.tenant_id, run_id, &operation_id)
                        .await
                        .map_err(|e| AxiomError::Internal(e.to_string()))?;

                    if let Some(child) = existing_child {
                        info!(run_id = %run_id.0, child_id = %child.id.0, "Child workflow already exists, checking status");

                        match child.status {
                            RunStatus::Completed => {
                                // If already terminal, we should append the completion event to parent and dispatch it.
                                // However, in the normal flow, the child's completion transaction already appended it and dispatched.
                                // If we reach here, it's possible a race condition occurred or the TS replay yielded it again?
                                // To be safe, we just park the parent; the outbox message from the child will wake it up,
                                // or if it was already processed, the parent wouldn't have yielded this again.
                                info!(run_id = %run_id.0, "Child is already completed, parking parent to await normal wakeup");
                                let _ = self
                                    .db
                                    .update_run_status(
                                        run_id,
                                        fence_token,
                                        RunStatus::Waiting,
                                        None,
                                        None,
                                    )
                                    .await;
                                let _ = self
                                    .db
                                    .release_lease(run_id, &self.worker_id, fence_token)
                                    .await;
                            }
                            RunStatus::Failed
                            | RunStatus::Cancelled
                            | RunStatus::VersionMismatch => {
                                info!(run_id = %run_id.0, "Child is already failed, parking parent to await normal wakeup");
                                let _ = self
                                    .db
                                    .update_run_status(
                                        run_id,
                                        fence_token,
                                        RunStatus::Waiting,
                                        None,
                                        None,
                                    )
                                    .await;
                                let _ = self
                                    .db
                                    .release_lease(run_id, &self.worker_id, fence_token)
                                    .await;
                            }
                            _ => {
                                // Pending, Running, Waiting, Sleeping...
                                info!(run_id = %run_id.0, "Child is still running, parking parent");
                                let _ = self
                                    .db
                                    .update_run_status(
                                        run_id,
                                        fence_token,
                                        RunStatus::Waiting,
                                        None,
                                        None,
                                    )
                                    .await;
                                let _ = self
                                    .db
                                    .release_lease(run_id, &self.worker_id, fence_token)
                                    .await;
                            }
                        }
                    } else {
                        // 3. Create the child run
                        let child_id = RunId(uuid::Uuid::new_v4());
                        let idempotency_key = Some(format!(
                            "child-{}-{}-{}",
                            run_id.0, operation_id, workflow_name
                        ));

                        let child_run = WorkflowRunRow {
                            id: child_id,
                            tenant_id: run.tenant_id,
                            workflow_id: workflow.id,
                            workflow_version,
                            status: RunStatus::Pending,
                            input: Some(input.clone()),
                            output: None,
                            error: None,
                            idempotency_key,
                            correlation_id: run.correlation_id.clone(),
                            parent_run_id: Some(run_id),
                            parent_operation_id: Some(operation_id.clone()),
                            worker_id: None,
                            fence_token: axiom_core::FenceToken(0),
                            lease_expires_at: None,
                            attempt_count: 0,
                            max_attempts: 1, // Currently children don't retry the whole workflow, could be configurable
                            created_at: chrono::Utc::now(),
                            updated_at: chrono::Utc::now(),
                            started_at: None,
                            completed_at: None,
                        };
                        let work_msg = serde_json::json!({
                            "run_id": child_id.0.to_string(),
                            "tenant_id": run.tenant_id.0.to_string(),
                        });

                        let outbox_row = OutboxMessageRow {
                            id: uuid::Uuid::new_v4(),
                            tenant_id: run.tenant_id,
                            topic: SUBJECT_WORK_EXECUTE.to_string(),
                            payload: work_msg,
                            available_at: chrono::Utc::now(),
                            attempt_count: 0,
                            last_error: None,
                            claim_token: None,
                            created_at: chrono::Utc::now(),
                        };

                        match self.db.create_run_and_outbox(child_run, outbox_row).await {
                            Ok(_) => {
                                info!(run_id = %run_id.0, child_id = %child_id.0, "Durably created child workflow and dispatch intent");
                                // Suspend parent durably
                                let _ = self
                                    .db
                                    .update_run_status(
                                        run_id,
                                        fence_token,
                                        RunStatus::Waiting,
                                        None,
                                        None,
                                    )
                                    .await;
                                let _ = self
                                    .db
                                    .release_lease(run_id, &self.worker_id, fence_token)
                                    .await;
                            }
                            Err(AxiomError::Internal(e))
                                if e.contains("idx_workflow_runs_parent_op") =>
                            {
                                // Race condition caught by unique constraint
                                info!(run_id = %run_id.0, child_name = %workflow_name, "Duplicate child workflow creation caught by DB constraint, fetching existing");
                                // We safely park the parent, the existing child handles wakeup
                                let _ = self
                                    .db
                                    .update_run_status(
                                        run_id,
                                        fence_token,
                                        RunStatus::Waiting,
                                        None,
                                        None,
                                    )
                                    .await;
                                let _ = self
                                    .db
                                    .release_lease(run_id, &self.worker_id, fence_token)
                                    .await;
                            }
                            Err(e) => {
                                error!(run_id = %run_id.0, error = %e, "Failed to create child workflow");
                            }
                        }
                    }
                } else {
                    // Workflow not found. We must fail the current workflow since it's a version mismatch/not found
                    info!(run_id = %run_id.0, "Child workflow version missing, failing parent");
                    let _ = self.db.update_run_status(run_id, fence_token, RunStatus::VersionMismatch, None, Some(serde_json::json!({ "error": format!("Workflow {}@{} not found", workflow_name, workflow_version) }))).await;
                }
            }
            CommandPayload::RecordTimestamp => {
                info!(run_id = %run_id.0, "TS yielded RecordTimestamp");
                let timestamp_ms = chrono::Utc::now().timestamp_millis();
                let evt = SemanticEvent::TimestampRecorded {
                    value: timestamp_ms,
                };
                let evt_row = EventRow {
                    id: uuid::Uuid::new_v4(),
                    run_id,
                    tenant_id: run.tenant_id,
                    sequence_number: history.len() as i64 + 1,
                    event_type: "TimestampRecorded".into(),
                    step_id: None,
                    attempt: None,
                    data: serde_json::to_value(evt).unwrap(),
                    timestamp: chrono::Utc::now(),
                };
                self.db.append_event(run_id, fence_token, evt_row).await?;
                info!(
                    run_id = %run_id.0,
                    timestamp = timestamp_ms,
                    "Recorded TimestampRecorded event, released lease for scheduler re-dispatch"
                );
            }
            CommandPayload::RecordRandom => {
                info!(run_id = %run_id.0, "TS yielded RecordRandom");
                let random_val: f64 = rand::random();
                let evt = SemanticEvent::RandomRecorded { value: random_val };
                let evt_row = EventRow {
                    id: uuid::Uuid::new_v4(),
                    run_id,
                    tenant_id: run.tenant_id,
                    sequence_number: history.len() as i64 + 1,
                    event_type: "RandomRecorded".into(),
                    step_id: None,
                    attempt: None,
                    data: serde_json::to_value(evt).unwrap(),
                    timestamp: chrono::Utc::now(),
                };
                self.db.append_event(run_id, fence_token, evt_row).await?;
                info!(
                    run_id = %run_id.0,
                    random = random_val,
                    "Recorded RandomRecorded event, released lease for scheduler re-dispatch"
                );
            }
            CommandPayload::CompleteWorkflow { output } => {
                info!(run_id = %run_id.0, "TS yielded CompleteWorkflow");
                metrics::counter!("axiom_workflow_runs_completed", "workflow" => workflow_name.clone()).increment(1);
                metrics::gauge!("axiom_active_workflow_runs").decrement(1.0);
                let duration = chrono::Utc::now()
                    .signed_duration_since(run.created_at)
                    .num_milliseconds() as f64
                    / 1000.0;
                metrics::histogram!("axiom_workflow_execution_duration_seconds", "workflow" => workflow_name.clone()).record(duration);
                let evt = SemanticEvent::WorkflowCompleted {
                    output: output.clone(),
                };
                let evt_row = EventRow {
                    id: uuid::Uuid::new_v4(),
                    run_id,
                    tenant_id: run.tenant_id,
                    sequence_number: history.len() as i64 + 1,
                    event_type: "WorkflowCompleted".into(),
                    step_id: None,
                    attempt: None,
                    data: serde_json::to_value(evt).unwrap(),
                    timestamp: chrono::Utc::now(),
                };
                let _ = self.db.append_event(run_id, fence_token, evt_row).await;

                if let Some(parent_id) = run.parent_run_id {
                    let parent_evt = SemanticEvent::ChildWorkflowCompleted {
                        id: run.parent_operation_id.clone().unwrap_or_default(),
                        output: output.clone(),
                    };
                    let parent_evt_row = EventRow {
                        id: uuid::Uuid::new_v4(),
                        run_id: parent_id,
                        tenant_id: run.tenant_id,
                        sequence_number: 0, // Assigned dynamically by Postgres
                        event_type: "ChildWorkflowCompleted".into(),
                        step_id: None,
                        attempt: None,
                        data: serde_json::to_value(parent_evt).unwrap(),
                        timestamp: chrono::Utc::now(),
                    };
                    let parent_work_msg = serde_json::json!({
                        "run_id": parent_id.0.to_string(),
                        "tenant_id": run.tenant_id.0.to_string(),
                    });
                    let parent_outbox_row = OutboxMessageRow {
                        id: uuid::Uuid::new_v4(),
                        tenant_id: run.tenant_id,
                        topic: SUBJECT_WORK_EXECUTE.to_string(),
                        payload: parent_work_msg,
                        available_at: chrono::Utc::now(),
                        attempt_count: 0,
                        last_error: None,
                        claim_token: None,
                        created_at: chrono::Utc::now(),
                    };
                    let _ = self
                        .db
                        .complete_run_with_parent_wakeup(
                            run_id,
                            fence_token,
                            RunStatus::Completed,
                            Some(output),
                            None,
                            parent_id,
                            parent_evt_row,
                            parent_outbox_row,
                        )
                        .await;
                } else {
                    let _ = self
                        .db
                        .update_run_status(
                            run_id,
                            fence_token,
                            RunStatus::Completed,
                            Some(output),
                            None,
                        )
                        .await;
                }
            }
            CommandPayload::FailWorkflow { error } => {
                info!(run_id = %run_id.0, error = ?error, "TS yielded FailWorkflow");
                metrics::counter!("axiom_workflow_runs_failed", "workflow" => workflow_name.clone()).increment(1);
                metrics::gauge!("axiom_active_workflow_runs").decrement(1.0);
                let duration = chrono::Utc::now()
                    .signed_duration_since(run.created_at)
                    .num_milliseconds() as f64
                    / 1000.0;
                metrics::histogram!("axiom_workflow_execution_duration_seconds", "workflow" => workflow_name.clone()).record(duration);
                let error_val = serde_json::to_value(&error).unwrap();
                let is_version_mismatch = error.error_type.as_deref() == Some("VERSION_MISMATCH");

                let evt = SemanticEvent::WorkflowFailed {
                    error: error_val.clone(),
                };
                let evt_row = EventRow {
                    id: uuid::Uuid::new_v4(),
                    run_id,
                    tenant_id: run.tenant_id,
                    sequence_number: history.len() as i64 + 1,
                    event_type: "WorkflowFailed".into(),
                    step_id: None,
                    attempt: None,
                    data: serde_json::to_value(evt).unwrap(),
                    timestamp: chrono::Utc::now(),
                };
                let _ = self.db.append_event(run_id, fence_token, evt_row).await;

                let final_status = if is_version_mismatch {
                    RunStatus::VersionMismatch
                } else {
                    RunStatus::Failed
                };

                if let Some(parent_id) = run.parent_run_id {
                    let parent_evt = SemanticEvent::ChildWorkflowFailed {
                        id: run.parent_operation_id.clone().unwrap_or_default(),
                        error: error_val.clone(),
                    };
                    let parent_evt_row = EventRow {
                        id: uuid::Uuid::new_v4(),
                        run_id: parent_id,
                        tenant_id: run.tenant_id,
                        sequence_number: 0, // Assigned dynamically by Postgres
                        event_type: "ChildWorkflowFailed".into(),
                        step_id: None,
                        attempt: None,
                        data: serde_json::to_value(parent_evt).unwrap(),
                        timestamp: chrono::Utc::now(),
                    };
                    let parent_work_msg = serde_json::json!({
                        "run_id": parent_id.0.to_string(),
                        "tenant_id": run.tenant_id.0.to_string(),
                    });
                    let parent_outbox_row = OutboxMessageRow {
                        id: uuid::Uuid::new_v4(),
                        tenant_id: run.tenant_id,
                        topic: SUBJECT_WORK_EXECUTE.to_string(),
                        payload: parent_work_msg,
                        available_at: chrono::Utc::now(),
                        attempt_count: 0,
                        last_error: None,
                        claim_token: None,
                        created_at: chrono::Utc::now(),
                    };
                    let _ = self
                        .db
                        .complete_run_with_parent_wakeup(
                            run_id,
                            fence_token,
                            final_status,
                            None,
                            Some(error_val),
                            parent_id,
                            parent_evt_row,
                            parent_outbox_row,
                        )
                        .await;
                } else {
                    let _ = self
                        .db
                        .update_run_status(run_id, fence_token, final_status, None, Some(error_val))
                        .await;
                }
            }
        }

        Ok(true)
    }
}
