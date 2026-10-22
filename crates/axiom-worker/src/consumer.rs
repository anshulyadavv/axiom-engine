use crate::ipc::ExecuteStepPayload;
use crate::nats_transport::WorkMessage;
use crate::process::SidecarProcess;
use async_nats::jetstream::{consumer::PullConsumer, Context as JetStream};
use axiom_core::{FenceToken, SemanticEvent};
use axiom_storage::models::EventRow;
use axiom_storage::{
    traits::{EventRepository, RunRepository},
    Database,
};
use futures::StreamExt;
use std::sync::Arc;
use tracing::{error, info, warn};

pub struct WorkerConsumer {
    pub db: Arc<Database>,
    pub js: JetStream,
    pub script_path: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StepProcessResult {
    Completed,
    DropRunNotFound,
    DropStaleFence,
    DropDuplicate,
    AbortedLeaseLost,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkDecision {
    Execute,
    DropRunNotFound,
    DropStaleFence {
        current: FenceToken,
        got: FenceToken,
    },
    DropDuplicate,
}

pub async fn evaluate_work_decision(
    db: &Database,
    work: &WorkMessage,
) -> anyhow::Result<WorkDecision> {
    use axiom_storage::traits::{RunRepository, StepRepository};

    let run_opt = db.get_run(work.run_id).await?;
    let Some(run) = run_opt else {
        return Ok(WorkDecision::DropRunNotFound);
    };

    if run.fence_token != work.fence_token {
        return Ok(WorkDecision::DropStaleFence {
            current: run.fence_token,
            got: work.fence_token,
        });
    }

    let step_execution = db
        .get_step_execution(work.run_id, &work.step_id, work.attempt)
        .await?;
    if let Some(step) = step_execution {
        use axiom_core::StepStatus;
        if step.status == StepStatus::Completed || step.status == StepStatus::Failed {
            return Ok(WorkDecision::DropDuplicate);
        }
    }

    // Also check if this step was completed by any attempt
    let steps = db.get_steps_for_run(work.run_id).await.unwrap_or_default();
    if steps
        .iter()
        .any(|s| s.step_id == work.step_id && s.status == axiom_core::StepStatus::Completed)
    {
        return Ok(WorkDecision::DropDuplicate);
    }

    Ok(WorkDecision::Execute)
}

pub fn is_chaos_enabled() -> bool {
    std::env::var("AXIOM_CHAOS_ENABLED").as_deref() == Ok("1")
}

impl WorkerConsumer {
    pub async fn run(&self) -> anyhow::Result<()> {
        if is_chaos_enabled() {
            tracing::warn!(
                "⚠️  CHAOS INJECTION IS ENABLED! (AXIOM_CHAOS_ENABLED=1) Fault injection active in worker consumer."
            );
        }

        let stream = self
            .js
            .get_stream("AXIOM_WORK")
            .await
            .map_err(|e| anyhow::anyhow!(e))?;
        let consumer_config = async_nats::jetstream::consumer::pull::Config {
            durable_name: Some("axiom_workers".to_string()),
            ..Default::default()
        };
        let consumer: PullConsumer = match stream.create_consumer(consumer_config.clone()).await {
            Ok(c) => c,
            Err(_) => stream
                .get_consumer("axiom_workers")
                .await
                .map_err(|e| anyhow::anyhow!(e))?,
        };

        let mut messages = consumer.messages().await.map_err(|e| anyhow::anyhow!(e))?;

        while let Some(msg_result) = messages.next().await {
            match msg_result {
                Ok(msg) => {
                    let work_msg: WorkMessage = match serde_json::from_slice(&msg.payload) {
                        Ok(w) => w,
                        Err(e) => {
                            error!(
                                "Malformed NATS work message on {}: {}. Dropping poison message.",
                                msg.subject, e
                            );
                            let _ = msg.ack().await;
                            continue;
                        }
                    };
                    info!(run_id = %work_msg.run_id.0, step_id = %work_msg.step_id, attempt = %work_msg.attempt, "Received work for step");

                    match self.process_message_with_chaos(&work_msg).await {
                        Ok(true) => {
                            // 8. ACK NATS message only after durable outcome is safely handled
                            let _ = msg.ack().await;
                        }
                        Ok(false) => {
                            // Dropped due to chaos drop rate; do not ACK so NATS redelivers or drops
                        }
                        Err(e) => {
                            error!(run_id = %work_msg.run_id.0, step_id = %work_msg.step_id, error = %e, "Failed to process work. Will NACK/redeliver.");
                            // It will automatically redeliver based on the consumer's ack-wait policy
                        }
                    }
                }
                Err(e) => error!("Error pulling message: {}", e),
            }
        }

        Ok(())
    }

    pub async fn process_work(&self, work: &WorkMessage) -> anyhow::Result<()> {
        process_work_internal(self.db.clone(), &self.script_path, work).await?;
        Ok(())
    }

    pub async fn process_message_with_chaos(&self, work: &WorkMessage) -> anyhow::Result<bool> {
        process_message_with_chaos_internal(self.db.clone(), &self.script_path, work).await
    }
}

pub async fn process_message_with_chaos_internal(
    db: Arc<Database>,
    script_path: &str,
    work: &WorkMessage,
) -> anyhow::Result<bool> {
    let mut duplicate = false;

    // --- CHAOS FAULT INJECTION (Gated behind AXIOM_CHAOS_ENABLED=1) ---
    if is_chaos_enabled() {
        if let Ok(drop_rate) = std::env::var("AXIOM_CHAOS_NATS_DROP_RATE") {
            if let Ok(rate) = drop_rate.parse::<f64>() {
                let valid_rate = rate.clamp(0.0, 1.0);
                if rand::random_bool(valid_rate) {
                    warn!("CHAOS: Dropping NATS message to simulate network loss");
                    return Ok(false);
                }
            }
        }

        if let Ok(latency) = std::env::var("AXIOM_CHAOS_LATENCY_MS") {
            if let Ok(ms) = latency.parse::<u64>() {
                info!("CHAOS: Injecting {}ms latency into consumer", ms);
                tokio::time::sleep(std::time::Duration::from_millis(ms)).await;
            }
        }

        if let Ok(dup_rate) = std::env::var("AXIOM_CHAOS_NATS_DUPLICATE_RATE") {
            if let Ok(rate) = dup_rate.parse::<f64>() {
                let valid_rate = rate.clamp(0.0, 1.0);
                if rand::random_bool(valid_rate) {
                    duplicate = true;
                    warn!("CHAOS: Duplicating NATS message to simulate at-least-once redelivery");
                }
            }
        }
    }
    // ------------------------------------------------------------------

    // 1. Primary execution
    process_work_internal(db.clone(), script_path, work).await?;

    // 2. Duplicate execution back to back if triggered by chaos injection
    if duplicate {
        warn!("CHAOS: Processing duplicate delivery for message back to back");
        process_work_internal(db.clone(), script_path, work).await?;
    }

    Ok(true)
}

pub async fn process_work_internal(
    db: Arc<Database>,
    script_path: &str,
    work: &WorkMessage,
) -> anyhow::Result<StepProcessResult> {
    let _span = tracing::info_span!("process_work",
        run_id = %work.run_id.0,
        step_id = %work.step_id,
        attempt = %work.attempt,
        correlation_id = ?work.correlation_id,
        fence_token = %work.fence_token.0
    )
    .entered();

    match evaluate_work_decision(&db, work).await? {
        WorkDecision::DropRunNotFound => {
            warn!(run_id = %work.run_id.0, "Run not found, dropping message");
            return Ok(StepProcessResult::DropRunNotFound);
        }
        WorkDecision::DropStaleFence { current, got } => {
            warn!(run_id = %work.run_id.0, expected = %current.0, got = %got.0, "Stale fence token. Rejecting work.");
            metrics::counter!("axiom_fencing_failures_total", "workflow" => work.workflow_name.clone()).increment(1);
            return Ok(StepProcessResult::DropStaleFence);
        }
        WorkDecision::DropDuplicate => {
            info!(run_id = %work.run_id.0, step_id = %work.step_id, attempt = %work.attempt, "Duplicate delivery detected. Step attempt is already terminal. Ignoring.");
            return Ok(StepProcessResult::DropDuplicate);
        }
        WorkDecision::Execute => {}
    }

    let run = db.get_run(work.run_id).await?.unwrap();

    let event_rows = db.get_events(work.run_id).await?;
    let history: Vec<SemanticEvent> = event_rows
        .into_iter()
        .filter_map(|row| {
            serde_json::from_value::<SemanticEvent>(row.data.clone()).ok().or_else(|| {
                let obj = serde_json::json!({
                    "type": row.event_type,
                    "data": row.data
                });
                serde_json::from_value::<SemanticEvent>(obj).ok()
            })
        })
        .collect();

    // 4. Send complete context to TS sidecar
    let mut sidecar = SidecarProcess::spawn(script_path).await?;
    let payload = ExecuteStepPayload {
        run_id: work.run_id,
        step_id: work.step_id.clone(),
        attempt: work.attempt,
        workflow_name: work.workflow_name.clone(),
        workflow_version: work.workflow_version,
        input: run.input.clone().unwrap_or_default(),
        history: history.clone(),
        run_correlation_id: work.correlation_id.clone(),
    };

    let db_clone = db.clone();
    let run_id = work.run_id;
    let fence_token = work.fence_token;
    let owning_worker_id = run.worker_id.clone().unwrap_or_default();
    let (cancel_tx, mut cancel_rx) = tokio::sync::oneshot::channel::<()>();

    let renew_task = tokio::spawn(async move {
        loop {
            let renew_interval_ms = (axiom_storage::lease_ttl_ms() / 2).max(100);
            tokio::time::sleep(tokio::time::Duration::from_millis(renew_interval_ms as u64)).await;
            use axiom_storage::traits::RunRepository;
            match db_clone
                .renew_lease(run_id, &owning_worker_id, fence_token)
                .await
            {
                Ok(true) => {
                    tracing::debug!(
                        run_id = %run_id.0,
                        worker_id = %owning_worker_id,
                        fence_token = %fence_token.0,
                        "Lease renewed successfully"
                    );
                }
                Ok(false) => {
                    // Lease lost or stolen: 0 rows affected
                    let _ = cancel_tx.send(());
                    break;
                }
                Err(e) => {
                    tracing::warn!(
                        run_id = %run_id.0,
                        error = %e,
                        "Failed to renew lease during step execution"
                    );
                }
            }
        }
    });

    let start_time = tokio::time::Instant::now();
    // 5. Receive Result or Abort if Lease Renewal Lost
    let sidecar_result = tokio::select! {
        res = sidecar.send_execute_step(payload, db.clone(), run.tenant_id) => {
            renew_task.abort();
            Some(res)
        }
        _ = &mut cancel_rx => {
            renew_task.abort();
            sidecar.kill().await;
            warn!(
                run_id = %work.run_id.0,
                fence_token = %work.fence_token.0,
                "Lease renewal returned 0 rows (lease lost or stolen). Aborting in-flight step."
            );
            metrics::counter!("axiom_fencing_failures_total", "workflow" => work.workflow_name.clone())
                .increment(1);
            return Ok(StepProcessResult::AbortedLeaseLost);
        }
    };

    let step_result = match sidecar_result.expect("Must have result if not cancelled") {
        Ok(res) => res,
        Err(e) if e.is_timeout() => {
            warn!(
                run_id = %work.run_id.0,
                step_id = %work.step_id,
                error = %e,
                "IPC execute_step timed out. Recording failed step attempt."
            );
            crate::ipc::StepResultPayload {
                status: "failure".to_string(),
                output: None,
                error: Some(crate::ipc::IpcError {
                    message: format!("{}", e),
                    error_type: Some("TimeoutError".to_string()),
                    is_determinism_violation: Some(false),
                    is_retryable: Some(true),
                }),
            }
        }
        Err(e) => return Err(e.into()),
    };

    let elapsed = start_time.elapsed().as_secs_f64();

    metrics::counter!("axiom_step_executions_total", "workflow" => work.workflow_name.clone())
        .increment(1);
    metrics::histogram!("axiom_step_execution_duration_seconds", "workflow" => work.workflow_name.clone()).record(elapsed);

    sidecar.kill().await;

    // 6. Validate result & 7. Persist fenced durable state
    if step_result.status == "success" {
        let evt = SemanticEvent::StepCompleted {
            id: work.step_id.clone(),
            output: step_result.output.unwrap_or_default(),
        };
        let evt_row = EventRow {
            id: uuid::Uuid::new_v4(),
            run_id: work.run_id,
            tenant_id: run.tenant_id,
            sequence_number: history.len() as i64 + 1,
            event_type: "StepCompleted".into(),
            step_id: Some(work.step_id.clone()),
            attempt: Some(work.attempt),
            data: serde_json::to_value(evt).unwrap(),
            timestamp: chrono::Utc::now(),
        };

        // Fenced write enforces idempotency and blocks stale workers dynamically in PG
        info!(run_id = %work.run_id.0, step_id = %work.step_id, "About to append StepCompleted event to DB");
        db.append_event(work.run_id, work.fence_token, evt_row)
            .await?;
        info!(run_id = %work.run_id.0, step_id = %work.step_id, "Durably persisted StepCompleted");
    } else {
        metrics::counter!("axiom_step_failures_total", "workflow" => work.workflow_name.clone())
            .increment(1);
        let evt = SemanticEvent::StepFailed {
            id: work.step_id.clone(),
            error: serde_json::Value::String(
                step_result.error.map(|e| e.message).unwrap_or_default(),
            ),
        };
        let evt_row = EventRow {
            id: uuid::Uuid::new_v4(),
            run_id: work.run_id,
            tenant_id: run.tenant_id,
            sequence_number: history.len() as i64 + 1,
            event_type: "StepFailed".into(),
            step_id: Some(work.step_id.clone()),
            attempt: Some(work.attempt),
            data: serde_json::to_value(evt).unwrap(),
            timestamp: chrono::Utc::now(),
        };
        db.append_event(work.run_id, work.fence_token, evt_row)
            .await?;
        info!(run_id = %work.run_id.0, step_id = %work.step_id, "Durably persisted StepFailed");
    }

    Ok(StepProcessResult::Completed)
}
