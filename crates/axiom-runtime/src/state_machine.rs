use crate::commands::Command;
use axiom_core::{AxiomError, RunStatus};

pub fn transition_run_state(current_state: RunStatus, command: &Command) -> Result<RunStatus, AxiomError> {
    match (current_state, command) {
        (RunStatus::Pending, Command::ScheduleStep { .. }) |
        (RunStatus::Running, Command::ScheduleStep { .. }) => {
            Ok(RunStatus::Running)
        }
        (RunStatus::Pending, Command::CompleteWorkflow { .. }) |
        (RunStatus::Running, Command::CompleteWorkflow { .. }) => {
            Ok(RunStatus::Completed)
        }
        (RunStatus::Pending, Command::FailWorkflow { .. }) |
        (RunStatus::Running, Command::FailWorkflow { .. }) => {
            Ok(RunStatus::Failed)
        }
        (state, cmd) => Err(AxiomError::Internal(format!(
            "Invalid state transition from {:?} via {:?}",
            state, cmd
        ))),
    }
}
