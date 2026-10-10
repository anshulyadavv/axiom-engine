use async_trait::async_trait;
use axiom_core::{FenceToken, RunId, Result, AxiomError};
use crate::{Database, models::EventRow, traits::EventRepository};

#[async_trait]
impl EventRepository for Database {
    async fn append_event(&self, run_id: RunId, fence_token: FenceToken, event: EventRow) -> Result<EventRow> {
        let mut tx = self.pool.begin().await.map_err(crate::error::from_sqlx)?;

        // 1. Verify the fence token with a locking read
        let current_token: Option<i64> = sqlx::query_scalar(
            "SELECT fence_token FROM workflow_runs WHERE id = $1 FOR UPDATE"
        )
        .bind(run_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(crate::error::from_sqlx)?;

        match current_token {
            Some(t) if t == fence_token.0 => {
                // Token matches, proceed with append
            }
            Some(_) => {
                return Err(AxiomError::DeterminismViolation(
                    format!("Fence token mismatch for run {}", run_id.0)
                ));
            }
            None => {
                return Err(AxiomError::NotFound(
                    format!("Workflow run {} not found", run_id.0)
                ));
            }
        }

        // 2. Insert the event
        let row = sqlx::query_as::<_, EventRow>(
            r#"
            INSERT INTO events (id, run_id, tenant_id, sequence_number, event_type, step_id, attempt, data, timestamp)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id, run_id, tenant_id, sequence_number, event_type, step_id, attempt, data, timestamp
            "#
        )
        .bind(event.id)
        .bind(event.run_id)
        .bind(event.tenant_id)
        .bind(event.sequence_number)
        .bind(event.event_type)
        .bind(event.step_id)
        .bind(event.attempt)
        .bind(event.data)
        .bind(event.timestamp)
        .fetch_one(&mut *tx)
        .await
        .map_err(crate::error::from_sqlx)?;

        // 3. Clear the lease so the scheduler can pick it up immediately to schedule the next step
        sqlx::query("UPDATE workflow_runs SET lease_expires_at = NULL, worker_id = NULL WHERE id = $1")
            .bind(event.run_id)
            .execute(&mut *tx)
            .await
            .map_err(crate::error::from_sqlx)?;

        tx.commit().await.map_err(crate::error::from_sqlx)?;

        Ok(row)
    }

    async fn get_events(&self, run_id: RunId) -> Result<Vec<EventRow>> {
        let rows = sqlx::query_as::<_, EventRow>(
            r#"
            SELECT id, run_id, tenant_id, sequence_number, event_type, step_id, attempt, data, timestamp
            FROM events
            WHERE run_id = $1
            ORDER BY sequence_number ASC
            "#
        )
        .bind(run_id)
        .fetch_all(&self.pool)
        .await
        .map_err(crate::error::from_sqlx)?;

        Ok(rows)
    }
}
