use crate::ipc::ExecuteStepPayload;
use crate::process::SidecarProcess;
use crate::nats_transport::{WorkMessage, SUBJECT_WORK_EXECUTE};
use axiom_core::{FenceToken, RunId, SemanticEvent};
use axiom_storage::models::EventRow;
use axiom_storage::{traits::{EventRepository, RunRepository}, Database};
use async_nats::jetstream::{Context as JetStream, consumer::PullConsumer};
use futures::StreamExt;
use std::sync::Arc;
use tokio::time::{sleep, Duration};
use tracing::{error, info, warn};

pub struct WorkerConsumer {
    pub db: Arc<Database>,
    pub js: JetStream,
    pub script_path: String,
}

impl WorkerConsumer {
    pub async fn run(&self) -> anyhow::Result<()> {
        let stream = self.js.get_stream("AXIOM_WORK").await.map_err(|e| anyhow::anyhow!(e))?;
        let consumer_config = async_nats::jetstream::consumer::pull::Config {
            durable_name: Some("axiom_workers".to_string()),
            ..Default::default()
        };
        let consumer: PullConsumer = match stream.create_consumer(consumer_config.clone()).await {
            Ok(c) => c,
            Err(_) => stream.get_consumer("axiom_workers").await.map_err(|e| anyhow::anyhow!(e))?,
        };
        
        let mut messages = consumer.messages().await.map_err(|e| anyhow::anyhow!(e))?;
        
        while let Some(msg_result) = messages.next().await {
            match msg_result {
                Ok(msg) => {
                    let work_msg: WorkMessage = match serde_json::from_slice(&msg.payload) {
                        Ok(w) => w,
                        Err(e) => {
                            error!("Malformed NATS work message on {}: {}. Dropping poison message.", msg.subject, e);
                            let _ = msg.ack().await;
                            continue;
                        }
                    };
                    info!(run_id = %work_msg.run_id.0, step_id = %work_msg.step_id, attempt = %work_msg.attempt, "Received work for step");

                    // --- CHAOS FAULT INJECTION (Developer Only) ---
                    if let Ok(drop_rate) = std::env::var("AXIOM_CHAOS_NATS_DROP_RATE") {
                        if let Ok(rate) = drop_rate.parse::<f64>() {
                            let valid_rate = rate.clamp(0.0, 1.0);
                            if rand::random_bool(valid_rate) {
                                warn!("CHAOS: Dropping NATS message to simulate network loss");
                                continue;
                            }
                        }
                    }

                    if let Ok(latency) = std::env::var("AXIOM_CHAOS_LATENCY_MS") {
                        if let Ok(ms) = latency.parse::<u64>() {
                            info!("CHAOS: Injecting {}ms latency into consumer", ms);
                            tokio::time::sleep(std::time::Duration::from_millis(ms)).await;
                        }
                    }
                    // ----------------------------------------------

                    match self.process_work(&work_msg).await {
                        Ok(()) => {
                            // 8. ACK NATS message only after durable outcome is safely handled
                            let _ = msg.ack().await;
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

    async fn process_work(&self, work: &WorkMessage) -> anyhow::Result<()> {
        let _span = tracing::info_span!("process_work", 
            run_id = %work.run_id.0, 
            step_id = %work.step_id, 
            attempt = %work.attempt, 
            correlation_id = ?work.correlation_id,
            fence_token = %work.fence_token.0
        ).entered();

        // 2. Load authoritative state from PostgreSQL
        let run_opt = self.db.get_run(work.run_id).await?;
        let Some(run) = run_opt else {
            warn!(run_id = %work.run_id.0, "Run not found, dropping message");
            return Ok(());
        };

        // 3. Validate durable ownership / fencing
        let current_fence = run.fence_token;
        if current_fence != work.fence_token {
            warn!(run_id = %work.run_id.0, expected = %current_fence.0, got = %work.fence_token.0, "Stale fence token. Rejecting work.");
            metrics::counter!("axiom_fencing_failures_total", "workflow" => work.workflow_name.clone()).increment(1);
            // This is a normal distributed systems scenario. We drop the message because it's stale.
            return Ok(());
        }

        // 3.5 Idempotency Guard
        use axiom_storage::traits::StepRepository;
        let step_execution = self.db.get_step_execution(work.run_id, &work.step_id, work.attempt).await?;
        if let Some(step) = step_execution {
            use axiom_core::StepStatus;
            if step.status == StepStatus::Completed || step.status == StepStatus::Failed {
                info!(run_id = %work.run_id.0, step_id = %work.step_id, attempt = %work.attempt, "Duplicate delivery detected. Step attempt is already terminal. Ignoring.");
                return Ok(());
            }
        }

        let event_rows = self.db.get_events(work.run_id).await?;
        let history: Vec<SemanticEvent> = event_rows.into_iter()
            .map(|row| serde_json::from_value(row.data).unwrap())
            .collect();

        // 4. Send complete context to TS sidecar
        let mut sidecar = SidecarProcess::spawn(&self.script_path).await?;
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

        let db_clone = self.db.clone();
        let run_id = work.run_id;
        let fence_token = work.fence_token;
        let renew_task = tokio::spawn(async move {
            loop {
                tokio::time::sleep(tokio::time::Duration::from_secs(15)).await;
                use axiom_storage::traits::RunRepository;
                if let Err(e) = db_clone.renew_lease(run_id, fence_token).await {
                    tracing::warn!(run_id = %run_id.0, error = %e, "Failed to renew lease during step execution");
                    // We don't abort the step execution immediately, we just warn.
                    // If the token became stale, the step will naturally fail to commit at the end.
                }
            }
        });

        let start_time = tokio::time::Instant::now();
        // 5. Receive Result
        let step_result = sidecar.send_execute_step(payload, self.db.clone(), run.tenant_id).await?;
        renew_task.abort();
        let elapsed = start_time.elapsed().as_secs_f64();
        
        metrics::counter!("axiom_step_executions_total", "workflow" => work.workflow_name.clone()).increment(1);
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
                step_id: None,
                attempt: None,
                data: serde_json::to_value(evt).unwrap(),
                timestamp: chrono::Utc::now(),
            };
            
            // Fenced write enforces idempotency and blocks stale workers dynamically in PG
            info!(run_id = %work.run_id.0, step_id = %work.step_id, "About to append StepCompleted event to DB");
            self.db.append_event(work.run_id, work.fence_token, evt_row).await?;
            info!(run_id = %work.run_id.0, step_id = %work.step_id, "Durably persisted StepCompleted");
        } else {
            metrics::counter!("axiom_step_failures_total", "workflow" => work.workflow_name.clone()).increment(1);
            let evt = SemanticEvent::StepFailed {
                id: work.step_id.clone(),
                error: serde_json::Value::String(step_result.error.map(|e| e.message).unwrap_or_default()),
            };
            let evt_row = EventRow {
                id: uuid::Uuid::new_v4(),
                run_id: work.run_id,
                tenant_id: run.tenant_id,
                sequence_number: history.len() as i64 + 1,
                event_type: "StepFailed".into(),
                step_id: None,
                attempt: None,
                data: serde_json::to_value(evt).unwrap(),
                timestamp: chrono::Utc::now(),
            };
            self.db.append_event(work.run_id, work.fence_token, evt_row).await?;
            info!(run_id = %work.run_id.0, step_id = %work.step_id, "Durably persisted StepFailed");
        }

        Ok(())
    }
}
