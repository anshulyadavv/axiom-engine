use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Command {
    ScheduleStep { step_id: String, input: Value },
    CompleteWorkflow { output: Value },
    FailWorkflow { error: Value },
}
