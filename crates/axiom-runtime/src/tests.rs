#[cfg(test)]
mod tests {
    use crate::context::ExecutionContext;
    use crate::commands::Command;
    use axiom_core::SemanticEvent;
    use serde_json::json;
    use crate::state_machine::transition_run_state;
    use axiom_core::RunStatus;

    #[test]
    fn test_empty_history_new_workflow() {
        let mut ctx = ExecutionContext::new(vec![]);
        let err = ctx.execute_step("step1", json!({"input": 1})).unwrap_err();
        assert_eq!(err.to_string(), "Internal engine error: YIELD");
        assert_eq!(
            ctx.command,
            Some(Command::ScheduleStep {
                step_id: "step1".to_string(),
                input: json!({"input": 1}),
            })
        );
    }

    #[test]
    fn test_single_completed_step_replay() {
        let history = vec![SemanticEvent::StepCompleted {
            id: "step1".to_string(),
            output: json!({"status": "ok"}),
        }];
        let mut ctx = ExecutionContext::new(history);
        let out = ctx.execute_step("step1", json!({})).unwrap();
        assert_eq!(out, json!({"status": "ok"}));
    }

    #[test]
    fn test_multiple_sequential_steps() {
        let history = vec![
            SemanticEvent::StepCompleted { id: "step1".into(), output: json!(1) },
            SemanticEvent::StepCompleted { id: "step2".into(), output: json!(2) },
        ];
        let mut ctx = ExecutionContext::new(history);
        assert_eq!(ctx.execute_step("step1", json!({})).unwrap(), json!(1));
        assert_eq!(ctx.execute_step("step2", json!({})).unwrap(), json!(2));
    }

    #[test]
    fn test_wrong_event_type() {
        let history = vec![
            SemanticEvent::WorkflowCompleted { output: json!(1) },
        ];
        let mut ctx = ExecutionContext::new(history);
        let err = ctx.execute_step("step1", json!({})).unwrap_err();
        assert!(err.to_string().contains("Determinism violation"));
    }

    #[test]
    fn test_step_failure_propagates_correctly() {
        let history = vec![
            SemanticEvent::StepFailed { id: "step1".into(), error: json!("fatal error") },
        ];
        let mut ctx = ExecutionContext::new(history);
        let err = ctx.execute_step("step1", json!({})).unwrap_err();
        assert_eq!(err.to_string(), "Internal engine error: Step failed: \"fatal error\"");
    }

    #[test]
    fn test_history_exhaustion() {
        let history = vec![
            SemanticEvent::StepCompleted { id: "step1".into(), output: json!(1) },
        ];
        let mut ctx = ExecutionContext::new(history);
        ctx.execute_step("step1", json!({})).unwrap();
        // Now exhausted, requesting step2 yields ScheduleStep
        let err = ctx.execute_step("step2", json!({})).unwrap_err();
        assert_eq!(err.to_string(), "Internal engine error: YIELD");
        assert_eq!(ctx.command, Some(Command::ScheduleStep { step_id: "step2".into(), input: json!({}) }));
    }

    #[test]
    fn test_invalid_state_transition_rejected() {
        let err = transition_run_state(RunStatus::Completed, &Command::CompleteWorkflow { output: json!(1) }).unwrap_err();
        assert!(err.to_string().contains("Invalid state transition"));
    }
}
