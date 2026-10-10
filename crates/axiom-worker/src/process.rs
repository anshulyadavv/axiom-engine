use crate::ipc::{CommandPayload, ExecuteStepPayload, IpcMessage, ResumeWorkflowPayload, StepResultPayload, StateResultPayload};
use anyhow::{Context, Result};
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tracing::{error, info, warn};

pub struct SidecarProcess {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl SidecarProcess {
    pub async fn spawn(script_path: &str) -> Result<Self> {
        let mut child = Command::new("node")
            .arg(script_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .context("Failed to spawn TS sidecar process")?;

        let stdin = child.stdin.take().expect("Failed to open stdin");
        let stdout = BufReader::new(child.stdout.take().expect("Failed to open stdout"));

        info!("Spawned TS sidecar (PID: {:?})", child.id());

        Ok(Self {
            child,
            stdin,
            stdout,
        })
    }

    /// Send a resume_workflow message and run the state-request service loop until the
    /// sidecar emits a terminal Command (e.g. ScheduleStep, CompleteWorkflow, FailWorkflow).
    pub async fn send_resume_workflow(
        &mut self,
        payload: ResumeWorkflowPayload,
        db: Arc<axiom_storage::Database>,
        tenant_id: axiom_core::TenantId,
    ) -> Result<CommandPayload> {
        let correlation_id = uuid::Uuid::new_v4().to_string();
        let msg = IpcMessage::ResumeWorkflow {
            correlation_id: correlation_id.clone(),
            payload,
        };
        self.send_msg(&msg).await?;

        // Service loop: handle any number of StateRequest round-trips before terminal response.
        loop {
            let response = self.receive_msg().await?;
            match response {
                IpcMessage::Command { correlation_id: res_id, payload } => {
                    if res_id != correlation_id {
                        anyhow::bail!("Correlation ID mismatch in ResumeWorkflow");
                    }
                    return Ok(payload);
                }
                IpcMessage::StateRequest { correlation_id: req_id, payload: state_req } => {
                    let result = service_state_request(&db, tenant_id.clone(), state_req).await;
                    let reply = IpcMessage::StateResult {
                        correlation_id: req_id,
                        payload: result,
                    };
                    self.send_msg(&reply).await?;
                }
                other => anyhow::bail!("Expected Command or StateRequest, got {:?}", other),
            }
        }
    }

    /// Send an execute_step message and run the state-request service loop until the
    /// sidecar emits a terminal StepResult.
    pub async fn send_execute_step(
        &mut self,
        payload: ExecuteStepPayload,
        db: Arc<axiom_storage::Database>,
        tenant_id: axiom_core::TenantId,
    ) -> Result<StepResultPayload> {
        let correlation_id = uuid::Uuid::new_v4().to_string();
        let msg = IpcMessage::ExecuteStep {
            correlation_id: correlation_id.clone(),
            payload,
        };

        info!(correlation_id = %correlation_id, "Sending IPC execute_step to sidecar");
        self.send_msg(&msg).await?;

        // Service loop: handle any number of StateRequest round-trips before terminal response.
        loop {
            let response = self.receive_msg().await?;
            match response {
                IpcMessage::StepResult { correlation_id: res_id, payload } => {
                    if res_id != correlation_id {
                        anyhow::bail!("Correlation ID mismatch in ExecuteStep");
                    }
                    info!(correlation_id = %correlation_id, "Received StepResult from sidecar");
                    return Ok(payload);
                }
                IpcMessage::StateRequest { correlation_id: req_id, payload: state_req } => {
                    let result = service_state_request(&db, tenant_id.clone(), state_req).await;
                    let reply = IpcMessage::StateResult {
                        correlation_id: req_id,
                        payload: result,
                    };
                    self.send_msg(&reply).await?;
                }
                other => anyhow::bail!("Expected StepResult or StateRequest, got {:?}", other),
            }
        }
    }

    async fn send_msg(&mut self, msg: &IpcMessage) -> Result<()> {
        let mut json = serde_json::to_string(msg).context("Serialization failed")?;
        json.push('\n');
        self.stdin.write_all(json.as_bytes()).await.context("Failed to write to sidecar stdin")?;
        self.stdin.flush().await?;
        Ok(())
    }

    async fn receive_msg(&mut self) -> Result<IpcMessage> {
        let mut line = String::new();
        let bytes_read = self.stdout.read_line(&mut line).await.context("Failed to read from sidecar stdout")?;
        if bytes_read == 0 {
            anyhow::bail!("Sidecar process exited unexpectedly (EOF)");
        }
        let msg: IpcMessage = serde_json::from_str(&line).context(format!("Failed to parse IPC message: {}", line))?;
        Ok(msg)
    }

    pub async fn kill(&mut self) {
        let _ = self.child.kill().await;
    }
}

/// Dispatch a StateRequest from the sidecar to PostgreSQL and return the result.
/// Enforces tenant isolation on every operation.
async fn service_state_request(
    db: &Arc<axiom_storage::Database>,
    tenant_id: axiom_core::TenantId,
    req: crate::ipc::StateRequestPayload,
) -> StateResultPayload {
    use axiom_storage::StateRepository;
    use crate::ipc::StateRequestPayload;

    match req {
        StateRequestPayload::Get { run_id, key } => {
            match db.get_state(tenant_id, run_id, &key).await {
                Ok(Some(row)) => StateResultPayload { ok: true, value: Some(row.value), error: None },
                Ok(None) => StateResultPayload { ok: true, value: None, error: None },
                Err(e) => {
                    error!(run_id = %run_id.0, key = %key, error = %e, "State get failed");
                    StateResultPayload { ok: false, value: None, error: Some(e.to_string()) }
                }
            }
        }
        StateRequestPayload::Set { run_id, key, value } => {
            match db.set_state(tenant_id, run_id, &key, value).await {
                Ok(row) => StateResultPayload { ok: true, value: Some(row.value), error: None },
                Err(e) => {
                    error!(run_id = %run_id.0, key = %key, error = %e, "State set failed");
                    StateResultPayload { ok: false, value: None, error: Some(e.to_string()) }
                }
            }
        }
        StateRequestPayload::Delete { run_id, key } => {
            match db.delete_state(tenant_id, run_id, &key).await {
                Ok(()) => StateResultPayload { ok: true, value: None, error: None },
                Err(e) => {
                    error!(run_id = %run_id.0, key = %key, error = %e, "State delete failed");
                    StateResultPayload { ok: false, value: None, error: Some(e.to_string()) }
                }
            }
        }
    }
}
