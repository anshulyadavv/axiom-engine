use async_trait::async_trait;
use axiom_core::{FenceToken, RunId, Result, AxiomError};
use crate::{Database, models::WorkflowRunRow, traits::RunRepository};

#[async_trait]
impl RunRepository for Database {
    async fn create_run(&self, run: WorkflowRunRow) -> Result<WorkflowRunRow> {
        let row = sqlx::query_as::<_, WorkflowRunRow>(
            r#"
            INSERT INTO workflow_runs (
                id, tenant_id, workflow_id, workflow_version, status, input, output, error, 
                idempotency_key, correlation_id, parent_run_id, parent_operation_id, worker_id, fence_token, 
                lease_expires_at, attempt_count, max_attempts, created_at, updated_at, 
                started_at, completed_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
            RETURNING id, tenant_id, workflow_id, workflow_version, status, input, output, error, 
                      idempotency_key, correlation_id, parent_run_id, parent_operation_id, worker_id, fence_token, 
                      lease_expires_at, attempt_count, max_attempts, created_at, updated_at, 
                      started_at, completed_at
            "#,
        )
        .bind(run.id)
        .bind(run.tenant_id)
        .bind(run.workflow_id)
        .bind(run.workflow_version)
        .bind(run.status)
        .bind(run.input)
        .bind(run.output)
        .bind(run.error)
        .bind(run.idempotency_key)
        .bind(run.correlation_id)
        .bind(run.parent_run_id)
        .bind(run.parent_operation_id)
        .bind(run.worker_id)
        .bind(run.fence_token)
        .bind(run.lease_expires_at)
        .bind(run.attempt_count)
        .bind(run.max_attempts)
        .bind(run.created_at)
        .bind(run.updated_at)
        .bind(run.started_at)
        .bind(run.completed_at)
        .fetch_one(&self.pool)
        .await
        .map_err(crate::error::from_sqlx)?;

        Ok(row)
    }

    async fn create_run_and_outbox(&self, run: WorkflowRunRow, outbox: crate::models::OutboxMessageRow) -> Result<WorkflowRunRow> {
        let mut tx = self.pool.begin().await.map_err(crate::error::from_sqlx)?;

        let row = sqlx::query_as::<_, WorkflowRunRow>(
            r#"
            INSERT INTO workflow_runs (
                id, tenant_id, workflow_id, workflow_version, status, input, output, error, 
                idempotency_key, correlation_id, parent_run_id, parent_operation_id, worker_id, fence_token, 
                lease_expires_at, attempt_count, max_attempts, created_at, updated_at, 
                started_at, completed_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
            RETURNING id, tenant_id, workflow_id, workflow_version, status, input, output, error, 
                      idempotency_key, correlation_id, parent_run_id, parent_operation_id, worker_id, fence_token, 
                      lease_expires_at, attempt_count, max_attempts, created_at, updated_at, 
                      started_at, completed_at
            "#,
        )
        .bind(run.id)
        .bind(run.tenant_id)
        .bind(run.workflow_id)
        .bind(run.workflow_version)
        .bind(run.status)
        .bind(run.input)
        .bind(run.output)
        .bind(run.error)
        .bind(run.idempotency_key)
        .bind(run.correlation_id)
        .bind(run.parent_run_id)
        .bind(run.parent_operation_id)
        .bind(run.worker_id)
        .bind(run.fence_token)
        .bind(run.lease_expires_at)
        .bind(run.attempt_count)
        .bind(run.max_attempts)
        .bind(run.created_at)
        .bind(run.updated_at)
        .bind(run.started_at)
        .bind(run.completed_at)
        .fetch_one(&mut *tx)
        .await
        .map_err(crate::error::from_sqlx)?;

        sqlx::query(
            r#"
            INSERT INTO outbox_messages (
                id, tenant_id, topic, payload, available_at, attempt_count, last_error, claim_token, created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            "#,
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
        Ok(row)
    }

    async fn get_run(&self, id: RunId) -> Result<Option<WorkflowRunRow>> {
        let row = sqlx::query_as::<_, WorkflowRunRow>(
            r#"
            SELECT id, tenant_id, workflow_id, workflow_version, status, input, output, error, 
                   idempotency_key, correlation_id, parent_run_id, parent_operation_id, worker_id, fence_token, 
                   lease_expires_at, attempt_count, max_attempts, created_at, updated_at, 
                   started_at, completed_at
            FROM workflow_runs WHERE id = $1
            "#
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(crate::error::from_sqlx)?;

        Ok(row)
    }

    async fn list_runs(&self, tenant_id: axiom_core::TenantId, limit: i64, offset: i64, status: Option<String>) -> Result<Vec<WorkflowRunRow>> {
        let mut q = "SELECT id, tenant_id, workflow_id, workflow_version, status, input, output, error, \
                    idempotency_key, correlation_id, parent_run_id, parent_operation_id, worker_id, fence_token, \
                    lease_expires_at, attempt_count, max_attempts, created_at, updated_at, \
                    started_at, completed_at \
                    FROM workflow_runs WHERE tenant_id = $1".to_string();
        
        if status.is_some() {
            q.push_str(" AND status = $2 ORDER BY created_at DESC LIMIT $3 OFFSET $4");
        } else {
            q.push_str(" ORDER BY created_at DESC LIMIT $2 OFFSET $3");
        }
        
        let mut query = sqlx::query_as::<_, WorkflowRunRow>(&q).bind(tenant_id);
        
        if let Some(st) = status {
            query = query.bind(st).bind(limit).bind(offset);
        } else {
            query = query.bind(limit).bind(offset);
        }

        let rows = query.fetch_all(&self.pool)
            .await
            .map_err(crate::error::from_sqlx)?;

        Ok(rows)
    }

    async fn get_run_by_idempotency_key(&self, tenant_id: axiom_core::TenantId, idempotency_key: &str) -> Result<Option<WorkflowRunRow>> {
        let row = sqlx::query_as::<_, WorkflowRunRow>(
            r#"
            SELECT id, tenant_id, workflow_id, workflow_version, status, input, output, error, 
                   idempotency_key, correlation_id, parent_run_id, parent_operation_id, worker_id, fence_token, 
                   lease_expires_at, attempt_count, max_attempts, created_at, updated_at, 
                   started_at, completed_at
            FROM workflow_runs WHERE tenant_id = $1 AND idempotency_key = $2
            "#
        )
        .bind(tenant_id)
        .bind(idempotency_key)
        .fetch_optional(&self.pool)
        .await
        .map_err(crate::error::from_sqlx)?;

        Ok(row)
    }

    async fn get_child_run(&self, tenant_id: axiom_core::TenantId, parent_run_id: RunId, parent_operation_id: &str) -> Result<Option<WorkflowRunRow>> {
        let row = sqlx::query_as::<_, WorkflowRunRow>(
            r#"
            SELECT id, tenant_id, workflow_id, workflow_version, status, input, output, error, 
                   idempotency_key, correlation_id, parent_run_id, parent_operation_id, worker_id, fence_token, 
                   lease_expires_at, attempt_count, max_attempts, created_at, updated_at, 
                   started_at, completed_at
            FROM workflow_runs 
            WHERE tenant_id = $1 AND parent_run_id = $2 AND parent_operation_id = $3
            "#
        )
        .bind(tenant_id)
        .bind(parent_run_id)
        .bind(parent_operation_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(crate::error::from_sqlx)?;

        Ok(row)
    }

    async fn get_children_for_run(&self, tenant_id: axiom_core::TenantId, parent_run_id: RunId) -> Result<Vec<WorkflowRunRow>> {
        let rows = sqlx::query_as::<_, WorkflowRunRow>(
            r#"
            SELECT id, tenant_id, workflow_id, workflow_version, status, input, output, error, 
                   idempotency_key, correlation_id, parent_run_id, parent_operation_id, worker_id, fence_token, 
                   lease_expires_at, attempt_count, max_attempts, created_at, updated_at, 
                   started_at, completed_at
            FROM workflow_runs 
            WHERE tenant_id = $1 AND parent_run_id = $2
            ORDER BY created_at ASC
            "#
        )
        .bind(tenant_id)
        .bind(parent_run_id)
        .fetch_all(&self.pool)
        .await
        .map_err(crate::error::from_sqlx)?;

        Ok(rows)
    }

    async fn poll_run(&self, worker_id: &str, _duration: std::time::Duration) -> Result<Option<(RunId, FenceToken)>> {
        let row: Option<(uuid::Uuid, i64)> = sqlx::query_as(
            r#"
            UPDATE workflow_runs
            SET worker_id = $1,
                lease_expires_at = now() + interval '30 seconds',
                fence_token = fence_token + 1,
                updated_at = now()
            WHERE id = (
                SELECT id FROM workflow_runs
                WHERE status IN ('pending', 'running')
                  AND (worker_id IS NULL OR lease_expires_at < now())
                LIMIT 1
                FOR UPDATE SKIP LOCKED
            )
            RETURNING id, fence_token
            "#
        )
        .bind(worker_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(crate::error::from_sqlx)?;

        Ok(row.map(|(id, token)| (RunId(id), FenceToken(token))))
    }

    async fn acquire_lease(&self, id: RunId, worker_id: &str) -> Result<Option<FenceToken>> {
        // We use query_scalar instead of query! to avoid compile time db requirement.
        let token: Option<i64> = sqlx::query_scalar(
            r#"
            UPDATE workflow_runs
            SET worker_id = $1,
                lease_expires_at = now() + interval '30 seconds',
                fence_token = fence_token + 1,
                updated_at = now()
            WHERE id = $2
              AND status IN ('pending', 'running')
              AND (worker_id IS NULL OR lease_expires_at < now())
            RETURNING fence_token
            "#
        )
        .bind(worker_id)
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(crate::error::from_sqlx)?;

        Ok(token.map(FenceToken))
    }

    async fn renew_lease(&self, id: RunId, fence_token: FenceToken) -> Result<bool> {
        let result = sqlx::query(
            r#"
            UPDATE workflow_runs
            SET lease_expires_at = now() + interval '30 seconds',
                updated_at = now()
            WHERE id = $1 AND fence_token = $2
            "#
        )
        .bind(id)
        .bind(fence_token)
        .execute(&self.pool)
        .await
        .map_err(crate::error::from_sqlx)?;

        Ok(result.rows_affected() > 0)
    }

    async fn release_lease(&self, id: RunId, worker_id: &str, fence_token: FenceToken) -> Result<bool> {
        let result = sqlx::query(
            r#"
            UPDATE workflow_runs
            SET worker_id = NULL, 
                lease_expires_at = NULL,
                updated_at = now()
            WHERE id = $1 AND worker_id = $2 AND fence_token = $3
            "#
        )
        .bind(id)
        .bind(worker_id)
        .bind(fence_token)
        .execute(&self.pool)
        .await
        .map_err(crate::error::from_sqlx)?;

        Ok(result.rows_affected() > 0)
    }

    async fn update_run_status(&self, id: RunId, fence_token: FenceToken, status: axiom_core::RunStatus, output: Option<serde_json::Value>, error: Option<serde_json::Value>) -> Result<()> {
        let status_str = match status {
            axiom_core::RunStatus::Pending => "pending",
            axiom_core::RunStatus::Running => "running",
            axiom_core::RunStatus::Sleeping => "sleeping",
            axiom_core::RunStatus::Waiting => "waiting",
            axiom_core::RunStatus::Retrying => "retrying",
            axiom_core::RunStatus::Completed => "completed",
            axiom_core::RunStatus::Failed => "failed",
            axiom_core::RunStatus::Cancelled => "cancelled",
            axiom_core::RunStatus::VersionMismatch => "version_mismatch",
        };

        let result = sqlx::query(
            r#"
            UPDATE workflow_runs
            SET status = $1, output = $2, error = $3, updated_at = now()
            WHERE id = $4 AND fence_token = $5
            "#
        )
        .bind(status_str)
        .bind(output)
        .bind(error)
        .bind(id)
        .bind(fence_token)
        .execute(&self.pool)
        .await
        .map_err(crate::error::from_sqlx)?;

        if result.rows_affected() == 0 {
            return Err(AxiomError::DeterminismViolation(
                format!("Fence token mismatch or run not found when updating status for run {}", id.0)
            ));
        }

        Ok(())
    }

    async fn complete_run_with_parent_wakeup(
        &self, 
        child_id: RunId, 
        child_fence_token: FenceToken, 
        child_status: axiom_core::RunStatus,
        child_output: Option<serde_json::Value>,
        child_error: Option<serde_json::Value>,
        parent_id: RunId,
        parent_event: crate::models::EventRow,
        parent_outbox: crate::models::OutboxMessageRow
    ) -> Result<()> {
        let status_str = match child_status {
            axiom_core::RunStatus::Pending => "pending",
            axiom_core::RunStatus::Running => "running",
            axiom_core::RunStatus::Sleeping => "sleeping",
            axiom_core::RunStatus::Waiting => "waiting",
            axiom_core::RunStatus::Retrying => "retrying",
            axiom_core::RunStatus::Completed => "completed",
            axiom_core::RunStatus::Failed => "failed",
            axiom_core::RunStatus::Cancelled => "cancelled",
            axiom_core::RunStatus::VersionMismatch => "version_mismatch",
        };

        let mut tx = self.pool.begin().await.map_err(crate::error::from_sqlx)?;

        let result = sqlx::query(
            r#"
            UPDATE workflow_runs
            SET status = $1, output = $2, error = $3, updated_at = now()
            WHERE id = $4 AND fence_token = $5
            "#
        )
        .bind(status_str)
        .bind(child_output)
        .bind(child_error)
        .bind(child_id)
        .bind(child_fence_token)
        .execute(&mut *tx)
        .await
        .map_err(crate::error::from_sqlx)?;

        if result.rows_affected() == 0 {
            return Err(AxiomError::DeterminismViolation(
                format!("Fence token mismatch or run not found when updating status for run {}", child_id.0)
            ));
        }

        sqlx::query(
            r#"
            INSERT INTO events (id, run_id, tenant_id, sequence_number, event_type, step_id, attempt, data, timestamp)
            VALUES (
                $1, 
                $2, 
                $3, 
                COALESCE((SELECT MAX(sequence_number) FROM events WHERE run_id = $2), 0) + 1, 
                $4, 
                $5, 
                $6, 
                $7, 
                $8
            )
            "#
        )
        .bind(parent_event.id)
        .bind(parent_event.run_id)
        .bind(parent_event.tenant_id)
        .bind(parent_event.event_type)
        .bind(parent_event.step_id)
        .bind(parent_event.attempt)
        .bind(parent_event.data)
        .bind(parent_event.timestamp)
        .execute(&mut *tx)
        .await
        .map_err(crate::error::from_sqlx)?;

        let parent_result = sqlx::query(
            r#"
            UPDATE workflow_runs
            SET status = 'pending', updated_at = now()
            WHERE id = $1
            "#
        )
        .bind(parent_id)
        .execute(&mut *tx)
        .await
        .map_err(crate::error::from_sqlx)?;
        
        if parent_result.rows_affected() == 0 {
            return Err(AxiomError::NotFound(
                format!("Parent run {} not found", parent_id.0)
            ));
        }

        sqlx::query(
            r#"
            INSERT INTO outbox_messages (
                id, tenant_id, topic, payload, available_at, attempt_count, last_error, claim_token, created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            "#,
        )
        .bind(parent_outbox.id)
        .bind(parent_outbox.tenant_id)
        .bind(parent_outbox.topic)
        .bind(parent_outbox.payload)
        .bind(parent_outbox.available_at)
        .bind(parent_outbox.attempt_count)
        .bind(parent_outbox.last_error)
        .bind(parent_outbox.claim_token)
        .bind(parent_outbox.created_at)
        .execute(&mut *tx)
        .await
        .map_err(crate::error::from_sqlx)?;

        tx.commit().await.map_err(crate::error::from_sqlx)?;

        Ok(())
    }

    async fn cancel_run(&self, id: RunId) -> Result<bool> {
        let mut tx = self.pool.begin().await.map_err(crate::error::from_sqlx)?;

        let row = sqlx::query_as::<_, WorkflowRunRow>(
            r#"
            SELECT id, tenant_id, workflow_id, workflow_version, status, input, output, error, 
                   idempotency_key, correlation_id, parent_run_id, parent_operation_id, worker_id, fence_token, 
                   lease_expires_at, attempt_count, max_attempts, created_at, updated_at, 
                   started_at, completed_at
            FROM workflow_runs WHERE id = $1 AND status NOT IN ('completed', 'failed', 'cancelled')
            FOR UPDATE
            "#
        )
        .bind(id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(crate::error::from_sqlx)?;

        let run = match row {
            Some(r) => r,
            None => return Ok(false), // Already terminal or not found
        };

        sqlx::query(
            r#"
            WITH RECURSIVE descendants AS (
                SELECT id FROM workflow_runs WHERE id = $1
                UNION ALL
                SELECT w.id FROM workflow_runs w INNER JOIN descendants d ON w.parent_run_id = d.id
            )
            UPDATE workflow_runs
            SET status = 'cancelled', updated_at = now()
            WHERE id IN (SELECT id FROM descendants) AND status NOT IN ('completed', 'failed', 'cancelled')
            "#
        )
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(crate::error::from_sqlx)?;

        if let Some(parent_id) = run.parent_run_id {
            let error_val = serde_json::json!({
                "type": "CANCELLED",
                "message": "Child workflow was cancelled",
            });
            let parent_evt = axiom_core::SemanticEvent::ChildWorkflowFailed { 
                id: run.parent_operation_id.clone().unwrap_or_default(), 
                error: error_val.clone() 
            };
            
            sqlx::query(
                r#"
                INSERT INTO events (id, run_id, tenant_id, sequence_number, event_type, step_id, attempt, data, timestamp)
                VALUES (
                    $1, 
                    $2, 
                    $3, 
                    COALESCE((SELECT MAX(sequence_number) FROM events WHERE run_id = $2), 0) + 1, 
                    $4, 
                    $5, 
                    $6, 
                    $7, 
                    $8
                )
                "#
            )
            .bind(uuid::Uuid::new_v4())
            .bind(parent_id)
            .bind(run.tenant_id)
            .bind("ChildWorkflowFailed")
            .bind(None::<String>)
            .bind(None::<i32>)
            .bind(serde_json::to_value(parent_evt).unwrap())
            .bind(chrono::Utc::now())
            .execute(&mut *tx)
            .await
            .map_err(crate::error::from_sqlx)?;

            sqlx::query(
                r#"
                UPDATE workflow_runs
                SET status = 'pending', updated_at = now()
                WHERE id = $1
                "#
            )
            .bind(parent_id)
            .execute(&mut *tx)
            .await
            .map_err(crate::error::from_sqlx)?;
            
            let parent_work_msg = serde_json::json!({
                "run_id": parent_id.0.to_string(),
                "tenant_id": run.tenant_id.0.to_string(),
            });
            sqlx::query(
                r#"
                INSERT INTO outbox_messages (
                    id, tenant_id, topic, payload, available_at, attempt_count, last_error, claim_token, created_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                "#,
            )
            .bind(uuid::Uuid::new_v4())
            .bind(run.tenant_id)
            .bind("axiom.work.execute")
            .bind(serde_json::to_value(&parent_work_msg).unwrap())
            .bind(chrono::Utc::now())
            .bind(0)
            .bind(None::<String>)
            .bind(None::<String>)
            .bind(chrono::Utc::now())
            .execute(&mut *tx)
            .await
            .map_err(crate::error::from_sqlx)?;
        }

        tx.commit().await.map_err(crate::error::from_sqlx)?;

        Ok(true)
    }
}
