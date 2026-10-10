use async_trait::async_trait;
use axiom_core::{TenantId, Result};
use crate::{Database, models::WorkerRow, traits::WorkerRepository};

#[async_trait]
impl WorkerRepository for Database {
    async fn list_workers(&self, tenant_id: TenantId) -> Result<Vec<WorkerRow>> {
        let rows = sqlx::query_as::<_, WorkerRow>(
            r#"
            SELECT id, tenant_id, status, last_heartbeat, metadata, registered_at
            FROM workers 
            WHERE tenant_id = $1 OR tenant_id IS NULL
            ORDER BY last_heartbeat DESC
            LIMIT 100
            "#
        )
        .bind(tenant_id)
        .fetch_all(&self.pool)
        .await
        .map_err(crate::error::from_sqlx)?;

        Ok(rows)
    }
}
