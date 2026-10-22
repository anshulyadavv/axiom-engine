use crate::traits::AuthRepository;
use crate::Database;
use async_trait::async_trait;
use axiom_core::{Result, TenantId};

#[async_trait]
impl AuthRepository for Database {
    async fn get_tenant_by_api_key_hash(&self, key_hash: &str) -> Result<Option<TenantId>> {
        use sqlx::Row;
        let row = sqlx::query(
            r#"
            SELECT tenant_id 
            FROM tenant_api_keys 
            WHERE key_hash = $1 AND is_active = true
            "#,
        )
        .bind(key_hash)
        .fetch_optional(&self.pool)
        .await
        .map_err(crate::error::from_sqlx)?;

        Ok(row.map(|r| {
            let id: uuid::Uuid = r.get("tenant_id");
            TenantId(id)
        }))
    }

    async fn create_api_key(
        &self,
        key: crate::models::ApiKeyRow,
    ) -> Result<crate::models::ApiKeyRow> {
        let _ = sqlx::query(
            r#"
            INSERT INTO tenant_api_keys (key_id, tenant_id, key_hash, description, is_active, created_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            "#
        )
        .bind(&key.key_id)
        .bind(&key.tenant_id.0)
        .bind(&key.key_hash)
        .bind(&key.description)
        .bind(key.is_active)
        .bind(key.created_at)
        .execute(&self.pool)
        .await
        .map_err(crate::error::from_sqlx)?;
        Ok(key)
    }

    async fn list_api_keys(&self, tenant_id: TenantId) -> Result<Vec<crate::models::ApiKeyRow>> {
        use sqlx::Row;
        let rows = sqlx::query(
            r#"
            SELECT key_id, tenant_id, key_hash, description, is_active, created_at, revoked_at
            FROM tenant_api_keys
            WHERE tenant_id = $1
            ORDER BY created_at DESC
            "#,
        )
        .bind(&tenant_id.0)
        .fetch_all(&self.pool)
        .await
        .map_err(crate::error::from_sqlx)?;

        let mut res = Vec::new();
        for r in rows {
            res.push(crate::models::ApiKeyRow {
                key_id: r.get("key_id"),
                tenant_id: TenantId(r.get("tenant_id")),
                key_hash: r.get("key_hash"),
                description: r.get("description"),
                is_active: r.get("is_active"),
                created_at: r.get("created_at"),
                revoked_at: r.get("revoked_at"),
            });
        }
        Ok(res)
    }

    async fn revoke_api_key(&self, tenant_id: TenantId, key_id: &str) -> Result<bool> {
        let result = sqlx::query(
            r#"
            UPDATE tenant_api_keys
            SET is_active = false, revoked_at = NOW()
            WHERE tenant_id = $1 AND key_id = $2 AND is_active = true
            "#,
        )
        .bind(&tenant_id.0)
        .bind(key_id)
        .execute(&self.pool)
        .await
        .map_err(crate::error::from_sqlx)?;

        Ok(result.rows_affected() > 0)
    }
}
