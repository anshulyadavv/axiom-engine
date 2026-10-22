use crate::commands::Command;
use crate::replay::ReplayCursor;
use axiom_core::{AxiomError, SemanticEvent};
use serde_json::Value;

pub struct ExecutionContext {
    pub cursor: ReplayCursor,
    pub command: Option<Command>,
}

impl ExecutionContext {
    pub fn new(history: Vec<SemanticEvent>) -> Self {
        Self {
            cursor: ReplayCursor::new(history),
            command: None,
        }
    }

    /// Consumes a step result from history, or generates a command if history is exhausted.
    pub fn execute_step(&mut self, step_id: &str, input: Value) -> Result<Value, AxiomError> {
        match self.cursor.peek_event() {
            Some(SemanticEvent::StepCompleted { id, output }) if id == step_id => {
                let out = output.clone();
                self.cursor.consume_event();
                Ok(out)
            }
            Some(SemanticEvent::StepFailed { id, error }) if id == step_id => {
                let err = error.clone();
                self.cursor.consume_event();
                Err(AxiomError::Internal(format!("Step failed: {}", err))) // Would be mapped to a workflow-level error
            }
            Some(evt) => Err(AxiomError::DeterminismViolation(format!(
                "Expected StepCompleted for {}, found {:?}",
                step_id, evt
            ))),
            None => {
                if self.command.is_none() {
                    self.command = Some(Command::ScheduleStep {
                        step_id: step_id.to_string(),
                        input,
                    });
                }
                // Yield execution via a special control flow error
                Err(AxiomError::Internal("YIELD".to_string()))
            }
        }
    }

    pub fn complete_workflow(&mut self, output: Value) -> Result<(), AxiomError> {
        if !self.cursor.is_exhausted() {
            return Err(AxiomError::DeterminismViolation(
                "Workflow completed but history is not exhausted".to_string(),
            ));
        }
        if self.command.is_none() {
            self.command = Some(Command::CompleteWorkflow { output });
        }
        Ok(())
    }
}
