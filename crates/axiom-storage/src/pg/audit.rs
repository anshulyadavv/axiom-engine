use crate::traits::AuditRepository;
use crate::Database;
use async_trait::async_trait;
use axiom_core::Result;

#[async_trait]
impl AuditRepository for Database {
    async fn append_audit_log(&self, log: crate::models::AuditLogRow) -> Result<()> {
        let _ = sqlx::query(
            r#"
            INSERT INTO audit_logs (id, tenant_id, action, resource_type, resource_id, correlation_id, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            "#
        )
        .bind(&log.id)
        .bind(&log.tenant_id.0)
        .bind(&log.action)
        .bind(&log.resource_type)
        .bind(&log.resource_id)
        .bind(&log.correlation_id)
        .bind(&log.created_at)
        .execute(&self.pool)
        .await
        .map_err(crate::error::from_sqlx)?;

        Ok(())
    }
}
