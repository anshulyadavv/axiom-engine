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

    async fn register_worker(&self, id: &str, tenant_id: Option<TenantId>, metadata: serde_json::Value) -> Result<()> {
        sqlx::query(
            r#"
            INSERT INTO workers (id, tenant_id, status, last_heartbeat, metadata, registered_at)
            VALUES ($1, $2, 'active', now(), $3, now())
            ON CONFLICT (id) DO UPDATE
            SET status = 'active', last_heartbeat = now(), metadata = $3
            "#
        )
        .bind(id)
        .bind(tenant_id)
        .bind(metadata)
        .execute(&self.pool)
        .await
        .map_err(crate::error::from_sqlx)?;

        Ok(())
    }

    async fn heartbeat_worker(&self, id: &str) -> Result<()> {
        sqlx::query(
            r#"
            UPDATE workers
            SET last_heartbeat = now(), status = 'active'
            WHERE id = $1
            "#
        )
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(crate::error::from_sqlx)?;

        Ok(())
    }
}
