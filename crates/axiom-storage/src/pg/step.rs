use crate::{models::StepExecutionRow, traits::StepRepository, Database};
use async_trait::async_trait;
use axiom_core::{AxiomError, FenceToken, Result, RunId};

#[async_trait]
impl StepRepository for Database {
    async fn get_step_execution(
        &self,
        run_id: RunId,
        step_id: &str,
        attempt: i32,
    ) -> Result<Option<StepExecutionRow>> {
        let row = sqlx::query_as::<_, StepExecutionRow>(
            r#"
            SELECT id, run_id, tenant_id, step_id, attempt, max_attempts, status, next_retry_at, 
                   input, output, error, operation_id, started_at, completed_at, duration_ms
            FROM step_executions 
            WHERE run_id = $1 AND step_id = $2 AND attempt = $3
            "#,
        )
        .bind(run_id)
        .bind(step_id)
        .bind(attempt)
        .fetch_optional(&self.pool)
        .await
        .map_err(crate::error::from_sqlx)?;

        Ok(row)
    }

    async fn get_steps_for_run(&self, run_id: RunId) -> Result<Vec<StepExecutionRow>> {
        let rows = sqlx::query_as::<_, StepExecutionRow>(
            r#"
            SELECT id, run_id, tenant_id, step_id, attempt, max_attempts, status, next_retry_at, 
                   input, output, error, operation_id, started_at, completed_at, duration_ms
            FROM step_executions 
            WHERE run_id = $1
            ORDER BY started_at ASC NULLS LAST
            "#,
        )
        .bind(run_id)
        .fetch_all(&self.pool)
        .await
        .map_err(crate::error::from_sqlx)?;

        Ok(rows)
    }

    async fn upsert_step_execution(
        &self,
        run_id: RunId,
        fence_token: FenceToken,
        step: StepExecutionRow,
    ) -> Result<StepExecutionRow> {
        let mut tx = self.pool.begin().await.map_err(crate::error::from_sqlx)?;

        // 1. Verify the fence token with a locking read
        let current_token: Option<i64> =
            sqlx::query_scalar("SELECT fence_token FROM workflow_runs WHERE id = $1 FOR UPDATE")
                .bind(run_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(crate::error::from_sqlx)?;

        match current_token {
            Some(t) if t == fence_token.0 => {
                // Token matches, proceed
            }
            Some(_) => {
                return Err(AxiomError::DeterminismViolation(format!(
                    "Fence token mismatch for run {}",
                    run_id.0
                )));
            }
            None => {
                return Err(AxiomError::NotFound(format!(
                    "Workflow run {} not found",
                    run_id.0
                )));
            }
        }

        // 2. Upsert the step execution
        let row = sqlx::query_as::<_, StepExecutionRow>(
            r#"
            INSERT INTO step_executions (
                id, run_id, tenant_id, step_id, attempt, max_attempts, status, next_retry_at, 
                input, output, error, operation_id, started_at, completed_at, duration_ms
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            ON CONFLICT (run_id, step_id, attempt) DO UPDATE SET
                status = EXCLUDED.status,
                next_retry_at = EXCLUDED.next_retry_at,
                output = EXCLUDED.output,
                error = EXCLUDED.error,
                started_at = EXCLUDED.started_at,
                completed_at = EXCLUDED.completed_at,
                duration_ms = EXCLUDED.duration_ms
            RETURNING id, run_id, tenant_id, step_id, attempt, max_attempts, status, next_retry_at, 
                      input, output, error, operation_id, started_at, completed_at, duration_ms
            "#,
        )
        .bind(step.id)
        .bind(step.run_id)
        .bind(step.tenant_id)
        .bind(step.step_id)
        .bind(step.attempt)
        .bind(step.max_attempts)
        .bind(step.status)
        .bind(step.next_retry_at)
        .bind(step.input)
        .bind(step.output)
        .bind(step.error)
        .bind(step.operation_id)
        .bind(step.started_at)
        .bind(step.completed_at)
        .bind(step.duration_ms)
        .fetch_one(&mut *tx)
        .await
        .map_err(crate::error::from_sqlx)?;

        tx.commit().await.map_err(crate::error::from_sqlx)?;

        Ok(row)
    }

    async fn upsert_step_and_outbox(
        &self,
        run_id: RunId,
        fence_token: FenceToken,
        step: StepExecutionRow,
        outbox: crate::models::OutboxMessageRow,
    ) -> Result<()> {
        let mut tx = self.pool.begin().await.map_err(crate::error::from_sqlx)?;

        let current_token: Option<i64> =
            sqlx::query_scalar("SELECT fence_token FROM workflow_runs WHERE id = $1 FOR UPDATE")
                .bind(run_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(crate::error::from_sqlx)?;

        match current_token {
            Some(t) if t == fence_token.0 => {}
            Some(_) => {
                return Err(AxiomError::DeterminismViolation(format!(
                    "Fence token mismatch for run {}",
                    run_id.0
                )));
            }
            None => {
                return Err(AxiomError::NotFound(format!(
                    "Workflow run {} not found",
                    run_id.0
                )));
            }
        }

        sqlx::query(
            r#"
            INSERT INTO step_executions (
                id, run_id, tenant_id, step_id, attempt, max_attempts, status, next_retry_at, 
                input, output, error, operation_id, started_at, completed_at, duration_ms
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            ON CONFLICT (run_id, step_id, attempt) DO UPDATE SET
                status = EXCLUDED.status,
                next_retry_at = EXCLUDED.next_retry_at,
                output = EXCLUDED.output,
                error = EXCLUDED.error,
                started_at = EXCLUDED.started_at,
                completed_at = EXCLUDED.completed_at,
                duration_ms = EXCLUDED.duration_ms
            "#,
        )
        .bind(step.id)
        .bind(step.run_id)
        .bind(step.tenant_id)
        .bind(step.step_id)
        .bind(step.attempt)
        .bind(step.max_attempts)
        .bind(step.status)
        .bind(step.next_retry_at)
        .bind(step.input)
        .bind(step.output)
        .bind(step.error)
        .bind(step.operation_id)
        .bind(step.started_at)
        .bind(step.completed_at)
        .bind(step.duration_ms)
        .execute(&mut *tx)
        .await
        .map_err(crate::error::from_sqlx)?;

        sqlx::query(
            r#"
            INSERT INTO outbox_messages (id, tenant_id, topic, payload, available_at, attempt_count, last_error, claim_token, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            "#
        )
        .bind(outbox.id)
        .bind(outbox.tenant_id)
        .bind(outbox.topic)
        .bind(outbox.payload)
        .bind(outbox.available_at)
        .bind(outbox.attempt_count)
        .bind(outbox.last_error)
        .bind(outbox.claim_token)
        .bind(outbox.created_at)
        .execute(&mut *tx)
        .await
        .map_err(crate::error::from_sqlx)?;

        tx.commit().await.map_err(crate::error::from_sqlx)?;

        Ok(())
    }
}
