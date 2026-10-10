use axiom_core::{RunId, SemanticEvent};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum IpcMessage {
    #[serde(rename = "resume_workflow")]
    ResumeWorkflow {
        correlation_id: String,
        payload: ResumeWorkflowPayload,
    },
    #[serde(rename = "execute_step")]
    ExecuteStep {
        correlation_id: String,
        payload: ExecuteStepPayload,
    },
    #[serde(rename = "command")]
    Command {
        correlation_id: String,
        payload: CommandPayload,
    },
    #[serde(rename = "step_result")]
    StepResult {
        correlation_id: String,
        payload: StepResultPayload,
    },
    /// TS sidecar requests a state operation. Rust handles DB and replies with StateResult.
    #[serde(rename = "state_request")]
    StateRequest {
        correlation_id: String,
        payload: StateRequestPayload,
    },
    /// Rust replies with the outcome of a state operation.
    #[serde(rename = "state_result")]
    StateResult {
        correlation_id: String,
        payload: StateResultPayload,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResumeWorkflowPayload {
    pub run_id: RunId,
    pub workflow_name: String,
    pub workflow_version: i32,
    pub input: Value,
    pub history: Vec<SemanticEvent>,
    pub run_correlation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecuteStepPayload {
    pub run_id: RunId,
    pub step_id: String,
    pub attempt: i32,
    pub workflow_name: String,
    pub workflow_version: i32,
    pub input: Value,
    pub history: Vec<SemanticEvent>,
    pub run_correlation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "command_type")]
pub enum CommandPayload {
    ScheduleStep {
        step_id: String,
        #[serde(default)]
        options: Option<Value>,
    },
    ScheduleChildWorkflow {
        workflow_name: String,
        workflow_version: i32,
        #[serde(default)]
        input: Value,
        operation_id: String,
    },
    CompleteWorkflow {
        output: Value,
    },
    FailWorkflow {
        error: IpcError,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct StepResultPayload {
    pub status: String, // "success" | "failure"
    #[serde(default)]
    pub output: Option<Value>,
    #[serde(default)]
    pub error: Option<IpcError>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IpcError {
    pub message: String,
    #[serde(rename = "type")]
    #[serde(default)]
    pub error_type: Option<String>,
    #[serde(default)]
    pub is_determinism_violation: Option<bool>,
    #[serde(default)]
    pub is_retryable: Option<bool>,
}

/// A state operation request from the TS sidecar to the Rust host.
/// State ops are NOT recorded in the semantic event log.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op")]
pub enum StateRequestPayload {
    #[serde(rename = "get")]
    Get {
        run_id: RunId,
        key: String,
    },
    #[serde(rename = "set")]
    Set {
        run_id: RunId,
        key: String,
        value: Value,
    },
    #[serde(rename = "delete")]
    Delete {
        run_id: RunId,
        key: String,
    },
}

/// The reply to a StateRequest.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StateResultPayload {
    /// true if the operation succeeded
    pub ok: bool,
    /// For Get: the current value (null/absent if key not found).
    #[serde(default)]
    pub value: Option<Value>,
    /// Error message if ok == false
    #[serde(default)]
    pub error: Option<String>,
}
