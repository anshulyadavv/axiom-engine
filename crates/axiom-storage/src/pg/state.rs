use crate::{models::RunStateRow, traits::StateRepository, Database};
use async_trait::async_trait;
use axiom_core::{Result, RunId, TenantId};

#[async_trait]
impl StateRepository for Database {
    async fn get_state(
        &self,
        tenant_id: TenantId,
        run_id: RunId,
        key: &str,
    ) -> Result<Option<RunStateRow>> {
        let row = sqlx::query_as::<_, RunStateRow>(
            r#"
            SELECT id, tenant_id, run_id, key, value, schema_version, created_at, updated_at
            FROM workflow_run_state
            WHERE tenant_id = $1 AND run_id = $2 AND key = $3
            "#,
        )
        .bind(tenant_id)
        .bind(run_id)
        .bind(key)
        .fetch_optional(&self.pool)
        .await
        .map_err(crate::error::from_sqlx)?;

        Ok(row)
    }

    async fn set_state(
        &self,
        tenant_id: TenantId,
        run_id: RunId,
        key: &str,
        value: serde_json::Value,
    ) -> Result<RunStateRow> {
        let row = sqlx::query_as::<_, RunStateRow>(
            r#"
            INSERT INTO workflow_run_state (id, tenant_id, run_id, key, value, schema_version, created_at, updated_at)
            VALUES (gen_random_uuid(), $1, $2, $3, $4, 1, NOW(), NOW())
            ON CONFLICT ON CONSTRAINT uq_workflow_run_state
            DO UPDATE SET
                value = EXCLUDED.value,
                updated_at = NOW()
            RETURNING id, tenant_id, run_id, key, value, schema_version, created_at, updated_at
            "#
        )
        .bind(tenant_id)
        .bind(run_id)
        .bind(key)
        .bind(value)
        .fetch_one(&self.pool)
        .await
        .map_err(crate::error::from_sqlx)?;

        Ok(row)
    }

    async fn delete_state(&self, tenant_id: TenantId, run_id: RunId, key: &str) -> Result<()> {
        // Idempotent: DELETE WHERE ... does not fail if no rows matched.
        sqlx::query(
            r#"
            DELETE FROM workflow_run_state
            WHERE tenant_id = $1 AND run_id = $2 AND key = $3
            "#,
        )
        .bind(tenant_id)
        .bind(run_id)
        .bind(key)
        .execute(&self.pool)
        .await
        .map_err(crate::error::from_sqlx)?;

        Ok(())
    }
}
