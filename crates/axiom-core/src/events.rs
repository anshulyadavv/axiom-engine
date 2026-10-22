use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::types::{RunId, TenantId};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum EventType {
    WorkflowStarted,
    WorkflowCompleted,
    WorkflowFailed,
    WorkflowCancelled,
    StepCompleted,
    StepFailed,
    TimerFired,
    SignalReceived,
    SignalTimedOut,
    ChildWorkflowCompleted,
    ChildWorkflowFailed,
    TimestampRecorded,
    RandomRecorded,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub id: Uuid,
    pub run_id: RunId,
    pub tenant_id: TenantId,
    pub sequence_number: i64,
    pub event_type: EventType,
    pub step_id: Option<String>,
    pub attempt: Option<i32>,
    pub data: serde_json::Value,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum SemanticEvent {
    WorkflowStarted {
        input: serde_json::Value,
    },
    WorkflowCompleted {
        output: serde_json::Value,
    },
    WorkflowFailed {
        error: serde_json::Value,
    },
    WorkflowCancelled {
        reason: String,
    },
    StepCompleted {
        id: String,
        output: serde_json::Value,
    },
    StepFailed {
        id: String,
        error: serde_json::Value,
    },
    TimerFired {
        id: String,
    },
    SignalReceived {
        id: String,
        payload: serde_json::Value,
    },
    SignalTimedOut {
        id: String,
    },
    ChildWorkflowCompleted {
        id: String,
        output: serde_json::Value,
    },
    ChildWorkflowFailed {
        id: String,
        error: serde_json::Value,
    },
    TimestampRecorded {
        value: i64,
    },
    RandomRecorded {
        value: f64,
    },
}
