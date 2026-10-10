use async_trait::async_trait;
use axiom_core::{TenantId, WorkflowId, Result, AxiomError};
use crate::{Database, models::WorkflowRow, traits::WorkflowRepository};

#[async_trait]
impl WorkflowRepository for Database {
    async fn create_workflow(&self, workflow: WorkflowRow) -> Result<WorkflowRow> {
        let row = sqlx::query_as::<_, WorkflowRow>(
            r#"
            INSERT INTO workflows (id, tenant_id, name, version, description, definition, status, retry_policy, timeout, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING id, tenant_id, name, version, description, definition, status, retry_policy, timeout, created_at, updated_at
            "#,
        )
        .bind(workflow.id)
        .bind(workflow.tenant_id)
        .bind(workflow.name)
        .bind(workflow.version)
        .bind(workflow.description)
        .bind(workflow.definition)
        .bind(workflow.status)
        .bind(workflow.retry_policy)
        .bind(workflow.timeout)
        .bind(workflow.created_at)
        .bind(workflow.updated_at)
        .fetch_one(&self.pool)
        .await
        .map_err(crate::error::from_sqlx)?;

        Ok(row)
    }

    async fn get_workflow(&self, id: WorkflowId) -> Result<Option<WorkflowRow>> {
        let row = sqlx::query_as::<_, WorkflowRow>(
            "SELECT id, tenant_id, name, version, description, definition, status, retry_policy, timeout, created_at, updated_at FROM workflows WHERE id = $1"
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(crate::error::from_sqlx)?;

        Ok(row)
    }

    async fn get_workflow_by_name(&self, tenant_id: TenantId, name: &str, version: i32) -> Result<Option<WorkflowRow>> {
        let row = sqlx::query_as::<_, WorkflowRow>(
            "SELECT id, tenant_id, name, version, description, definition, status, retry_policy, timeout, created_at, updated_at FROM workflows WHERE tenant_id = $1 AND name = $2 AND version = $3"
        )
        .bind(tenant_id)
        .bind(name)
        .bind(version)
        .fetch_optional(&self.pool)
        .await
        .map_err(crate::error::from_sqlx)?;

        Ok(row)
    }

    async fn list_workflows(&self, tenant_id: TenantId, limit: i64, offset: i64, name: Option<String>) -> Result<Vec<WorkflowRow>> {
        let rows = if let Some(n) = name {
            sqlx::query_as::<_, WorkflowRow>(
                "SELECT id, tenant_id, name, version, description, definition, status, retry_policy, timeout, created_at, updated_at FROM workflows WHERE tenant_id = $1 AND name = $2 ORDER BY created_at DESC LIMIT $3 OFFSET $4"
            )
            .bind(tenant_id)
            .bind(n)
            .bind(limit)
            .bind(offset)
            .fetch_all(&self.pool)
            .await
            .map_err(crate::error::from_sqlx)?
        } else {
            sqlx::query_as::<_, WorkflowRow>(
                "SELECT id, tenant_id, name, version, description, definition, status, retry_policy, timeout, created_at, updated_at FROM workflows WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3"
            )
            .bind(tenant_id)
            .bind(limit)
            .bind(offset)
            .fetch_all(&self.pool)
            .await
            .map_err(crate::error::from_sqlx)?
        };

        Ok(rows)
    }

    async fn get_workflow_stats(&self, tenant_id: TenantId, workflow_id: WorkflowId) -> Result<axiom_core::ExecutionAnalytics> {
        use sqlx::Row;
        
        let row = sqlx::query(
            r#"
            SELECT 
                COUNT(*) as total_runs,
                COUNT(*) FILTER (WHERE status IN ('pending', 'running', 'sleeping', 'waiting', 'retrying')) as active_runs,
                COUNT(*) FILTER (WHERE status = 'completed') as completed_runs,
                COUNT(*) FILTER (WHERE status IN ('completed', 'failed', 'cancelled')) as terminal_runs,
                COALESCE(CAST(AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000) FILTER (WHERE status = 'completed') AS BIGINT), 0) as avg_duration_ms,
                COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000) FILTER (WHERE status = 'completed'), 0) as p95_duration_ms
            FROM workflow_runs 
            WHERE tenant_id = $1 AND workflow_id = $2
            "#
        )
        .bind(tenant_id.0)
        .bind(workflow_id.0)
        .fetch_one(&self.pool)
        .await
        .map_err(crate::error::from_sqlx)?;

        let total_runs: i64 = row.get("total_runs");
        let active_runs: i64 = row.get("active_runs");
        let completed_runs: i64 = row.get("completed_runs");
        let terminal_runs: i64 = row.get("terminal_runs");
        let avg_duration_ms: i64 = row.get("avg_duration_ms");
        let p95_duration_ms: f64 = row.get("p95_duration_ms");

        let success_rate = if terminal_runs > 0 {
            completed_runs as f64 / terminal_runs as f64
        } else {
            0.0
        };

        Ok(axiom_core::ExecutionAnalytics {
            total_runs,
            active_runs,
            success_rate,
            avg_duration_ms,
            p95_duration_ms: p95_duration_ms as i64,
        })
    }
}
