use crate::ipc::{
    CommandPayload, ExecuteStepPayload, IpcMessage, ResumeWorkflowPayload, StateResultPayload,
    StepResultPayload,
};
use anyhow::{Context, Result};
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tracing::{error, info, warn};

#[derive(thiserror::Error, Debug)]
pub enum SidecarError {
    #[error("IPC operation '{operation}' timed out after {timeout:?}")]
    Timeout {
        operation: &'static str,
        timeout: std::time::Duration,
    },
    #[error("Sidecar process exited unexpectedly (EOF)")]
    ProcessExited,
    #[error("Correlation ID mismatch in {operation}: expected {expected}, got {got}")]
    CorrelationIdMismatch {
        operation: &'static str,
        expected: String,
        got: String,
    },
    #[error("Failed to parse IPC message: {0}")]
    Parse(String),
    #[error("Failed to write to sidecar stdin: {0}")]
    Write(std::io::Error),
    #[error("Failed to read from sidecar stdout: {0}")]
    Read(std::io::Error),
    #[error("Serialization failed: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("Unexpected IPC message in {operation}: expected {expected}, got {got:?}")]
    UnexpectedMessage {
        operation: &'static str,
        expected: &'static str,
        got: Box<IpcMessage>,
    },
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

impl SidecarError {
    pub fn is_timeout(&self) -> bool {
        matches!(self, SidecarError::Timeout { .. })
    }
}

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
    /// Enforces configurable timeout via AXIOM_IPC_RESUME_TIMEOUT_MS (default 10000ms).
    pub async fn send_resume_workflow(
        &mut self,
        payload: ResumeWorkflowPayload,
        db: Arc<axiom_storage::Database>,
        tenant_id: axiom_core::TenantId,
    ) -> Result<CommandPayload, SidecarError> {
        let correlation_id = uuid::Uuid::new_v4().to_string();
        let msg = IpcMessage::ResumeWorkflow {
            correlation_id: correlation_id.clone(),
            payload,
        };
        self.send_msg(&msg).await?;

        let timeout_ms = std::env::var("AXIOM_IPC_RESUME_TIMEOUT_MS")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(10_000);
        let duration = std::time::Duration::from_millis(timeout_ms);

        let loop_fut = async {
            loop {
                let response = self.receive_msg().await?;
                match response {
                    IpcMessage::Command {
                        correlation_id: res_id,
                        payload,
                    } => {
                        if res_id != correlation_id {
                            return Err(SidecarError::CorrelationIdMismatch {
                                operation: "ResumeWorkflow",
                                expected: correlation_id.clone(),
                                got: res_id,
                            });
                        }
                        return Ok(payload);
                    }
                    IpcMessage::StateRequest {
                        correlation_id: req_id,
                        payload: state_req,
                    } => {
                        let result = service_state_request(&db, tenant_id.clone(), state_req).await;
                        let reply = IpcMessage::StateResult {
                            correlation_id: req_id,
                            payload: result,
                        };
                        self.send_msg(&reply).await?;
                    }
                    other => {
                        return Err(SidecarError::UnexpectedMessage {
                            operation: "ResumeWorkflow",
                            expected: "Command or StateRequest",
                            got: Box::new(other),
                        });
                    }
                }
            }
        };

        match tokio::time::timeout(duration, loop_fut).await {
            Ok(res) => res,
            Err(_) => {
                error!(
                    timeout = ?duration,
                    correlation_id = %correlation_id,
                    "IPC resume_workflow timed out. Killing sidecar."
                );
                self.kill().await;
                Err(SidecarError::Timeout {
                    operation: "resume_workflow",
                    timeout: duration,
                })
            }
        }
    }

    /// Send an execute_step message and run the state-request service loop until the
    /// sidecar emits a terminal StepResult.
    /// Enforces configurable timeout via AXIOM_IPC_STEP_TIMEOUT_MS (default 30000ms).
    pub async fn send_execute_step(
        &mut self,
        payload: ExecuteStepPayload,
        db: Arc<axiom_storage::Database>,
        tenant_id: axiom_core::TenantId,
    ) -> Result<StepResultPayload, SidecarError> {
        let correlation_id = uuid::Uuid::new_v4().to_string();
        let msg = IpcMessage::ExecuteStep {
            correlation_id: correlation_id.clone(),
            payload,
        };

        info!(correlation_id = %correlation_id, "Sending IPC execute_step to sidecar");
        self.send_msg(&msg).await?;

        let timeout_ms = std::env::var("AXIOM_IPC_STEP_TIMEOUT_MS")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(30_000);
        let duration = std::time::Duration::from_millis(timeout_ms);

        let loop_fut = async {
            loop {
                let response = self.receive_msg().await?;
                match response {
                    IpcMessage::StepResult {
                        correlation_id: res_id,
                        payload,
                    } => {
                        if res_id != correlation_id {
                            return Err(SidecarError::CorrelationIdMismatch {
                                operation: "ExecuteStep",
                                expected: correlation_id.clone(),
                                got: res_id,
                            });
                        }
                        info!(correlation_id = %correlation_id, "Received StepResult from sidecar");
                        return Ok(payload);
                    }
                    IpcMessage::StateRequest {
                        correlation_id: req_id,
                        payload: state_req,
                    } => {
                        let result = service_state_request(&db, tenant_id.clone(), state_req).await;
                        let reply = IpcMessage::StateResult {
                            correlation_id: req_id,
                            payload: result,
                        };
                        self.send_msg(&reply).await?;
                    }
                    other => {
                        return Err(SidecarError::UnexpectedMessage {
                            operation: "ExecuteStep",
                            expected: "StepResult or StateRequest",
                            got: Box::new(other),
                        });
                    }
                }
            }
        };

        match tokio::time::timeout(duration, loop_fut).await {
            Ok(res) => res,
            Err(_) => {
                error!(
                    timeout = ?duration,
                    correlation_id = %correlation_id,
                    "IPC execute_step timed out. Killing sidecar."
                );
                self.kill().await;
                Err(SidecarError::Timeout {
                    operation: "execute_step",
                    timeout: duration,
                })
            }
        }
    }

    async fn send_msg(&mut self, msg: &IpcMessage) -> Result<(), SidecarError> {
        let mut json = serde_json::to_string(msg)?;
        json.push('\n');
        self.stdin
            .write_all(json.as_bytes())
            .await
            .map_err(SidecarError::Write)?;
        self.stdin.flush().await.map_err(SidecarError::Write)?;
        Ok(())
    }

    async fn receive_msg(&mut self) -> Result<IpcMessage, SidecarError> {
        let mut line = String::new();
        let bytes_read = self
            .stdout
            .read_line(&mut line)
            .await
            .map_err(SidecarError::Read)?;
        if bytes_read == 0 {
            return Err(SidecarError::ProcessExited);
        }
        let msg: IpcMessage = serde_json::from_str(&line)
            .map_err(|e| SidecarError::Parse(format!("{}: {}", e, line)))?;
        Ok(msg)
    }

    pub async fn kill(&mut self) {
        let _ = self.child.kill().await;
        let _ = self.child.wait().await;
    }

    pub fn try_wait(&mut self) -> std::io::Result<Option<std::process::ExitStatus>> {
        self.child.try_wait()
    }

    pub fn is_alive(&mut self) -> bool {
        match self.child.try_wait() {
            Ok(None) => true,
            _ => false,
        }
    }
}

/// Dispatch a StateRequest from the sidecar to PostgreSQL and return the result.
/// Enforces tenant isolation on every operation.
async fn service_state_request(
    db: &Arc<axiom_storage::Database>,
    tenant_id: axiom_core::TenantId,
    req: crate::ipc::StateRequestPayload,
) -> StateResultPayload {
    use crate::ipc::StateRequestPayload;
    use axiom_storage::StateRepository;

    match req {
        StateRequestPayload::Get { run_id, key } => {
            match db.get_state(tenant_id, run_id, &key).await {
                Ok(Some(row)) => StateResultPayload {
                    ok: true,
                    value: Some(row.value),
                    error: None,
                },
                Ok(None) => StateResultPayload {
                    ok: true,
                    value: None,
                    error: None,
                },
                Err(e) => {
                    error!(run_id = %run_id.0, key = %key, error = %e, "State get failed");
                    StateResultPayload {
                        ok: false,
                        value: None,
                        error: Some(e.to_string()),
                    }
                }
            }
        }
        StateRequestPayload::Set { run_id, key, value } => {
            match db.set_state(tenant_id, run_id, &key, value).await {
                Ok(row) => StateResultPayload {
                    ok: true,
                    value: Some(row.value),
                    error: None,
                },
                Err(e) => {
                    error!(run_id = %run_id.0, key = %key, error = %e, "State set failed");
                    StateResultPayload {
                        ok: false,
                        value: None,
                        error: Some(e.to_string()),
                    }
                }
            }
        }
        StateRequestPayload::Delete { run_id, key } => {
            match db.delete_state(tenant_id, run_id, &key).await {
                Ok(()) => StateResultPayload {
                    ok: true,
                    value: None,
                    error: None,
                },
                Err(e) => {
                    error!(run_id = %run_id.0, key = %key, error = %e, "State delete failed");
                    StateResultPayload {
                        ok: false,
                        value: None,
                        error: Some(e.to_string()),
                    }
                }
            }
        }
    }
}
