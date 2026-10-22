use crate::{commands::Command, context::ExecutionContext, state_machine::transition_run_state};
use axiom_core::{AxiomError, FenceToken, RunId, SemanticEvent, StepStatus};
use axiom_storage::{
    models::{EventRow, StepExecutionRow},
    traits::{EventRepository, RunRepository, StepRepository},
    Database,
};
use chrono::Utc;
use serde_json::Value;
use std::sync::Arc;
use uuid::Uuid;

pub trait Workflow: Send + Sync {
    fn execute(&self, ctx: &mut ExecutionContext, input: Value) -> Result<Value, AxiomError>;
}

pub struct ExecutionEngine {
    pub db: Arc<Database>,
}

impl ExecutionEngine {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    pub async fn drive_workflow<W: Workflow>(
        &self,
        run_id: RunId,
        fence_token: FenceToken,
        workflow: &W,
    ) -> Result<Command, AxiomError> {
        // 1. Load Run
        let run = self
            .db
            .get_run(run_id)
            .await?
            .ok_or_else(|| AxiomError::NotFound(format!("Run {}", run_id.0)))?;

        // 2. Load Semantic History
        let event_rows = self.db.get_events(run_id).await?;
        let history: Vec<SemanticEvent> = event_rows
            .into_iter()
            .map(|row| serde_json::from_value(row.data).expect("Corrupt event data in DB"))
            .collect();

        // 3. Replay & Execute
        let mut ctx = ExecutionContext::new(history.clone());
        let input = run.input.unwrap_or(Value::Null);

        let command = match workflow.execute(&mut ctx, input) {
            Ok(output) => {
                ctx.complete_workflow(output)?;
                ctx.command.unwrap()
            }
            Err(e) if e.to_string() == "Internal engine error: YIELD" => ctx
                .command
                .ok_or_else(|| AxiomError::Internal("YIELD without command".into()))?,
            Err(AxiomError::DeterminismViolation(msg)) => Command::FailWorkflow {
                error: Value::String(msg),
            },
            Err(e) => Command::FailWorkflow {
                error: Value::String(e.to_string()),
            },
        };

        // 4. Validate State Transition
        let next_state = transition_run_state(run.status.clone(), &command)?;

        // 5. Persist State
        match &command {
            Command::ScheduleStep { step_id, input } => {
                let step_row = StepExecutionRow {
                    id: Uuid::new_v4(),
                    run_id,
                    tenant_id: run.tenant_id,
                    step_id: step_id.clone(),
                    attempt: 1,
                    max_attempts: 3, // default
                    status: StepStatus::Pending,
                    next_retry_at: None,
                    input: Some(input.clone()),
                    output: None,
                    error: None,
                    operation_id: Uuid::new_v4().to_string(),
                    started_at: None,
                    completed_at: None,
                    duration_ms: None,
                };
                self.db
                    .upsert_step_execution(run_id, fence_token, step_row)
                    .await?;
            }
            Command::CompleteWorkflow { output } => {
                let event = SemanticEvent::WorkflowCompleted {
                    output: output.clone(),
                };
                let evt_row = EventRow {
                    id: Uuid::new_v4(),
                    run_id,
                    tenant_id: run.tenant_id,
                    sequence_number: history.len() as i64 + 1,
                    event_type: "WorkflowCompleted".into(),
                    step_id: None,
                    attempt: None,
                    data: serde_json::to_value(event).unwrap(),
                    timestamp: Utc::now(),
                };
                self.db.append_event(run_id, fence_token, evt_row).await?;
            }
            Command::FailWorkflow { error } => {
                let event = SemanticEvent::WorkflowFailed {
                    error: error.clone(),
                };
                let evt_row = EventRow {
                    id: Uuid::new_v4(),
                    run_id,
                    tenant_id: run.tenant_id,
                    sequence_number: history.len() as i64 + 1,
                    event_type: "WorkflowFailed".into(),
                    step_id: None,
                    attempt: None,
                    data: serde_json::to_value(event).unwrap(),
                    timestamp: Utc::now(),
                };
                self.db.append_event(run_id, fence_token, evt_row).await?;
            }
        }

        // Ideally here we update workflow_runs.status = next_state where fence_token = ...
        // We'll need to extend RunRepository with update_run.

        Ok(command)
    }
}
