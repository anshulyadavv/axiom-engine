use crate::{models::OutboxMessageRow, traits::OutboxRepository, Database};
use async_trait::async_trait;
use axiom_core::{AxiomError, Result};

#[async_trait]
impl OutboxRepository for Database {
    async fn create_outbox_message(&self, message: OutboxMessageRow) -> Result<OutboxMessageRow> {
        let row = sqlx::query_as::<_, OutboxMessageRow>(
            r#"
            INSERT INTO outbox_messages (id, tenant_id, topic, payload, available_at, attempt_count, last_error, claim_token, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id, tenant_id, topic, payload, available_at, attempt_count, last_error, claim_token, created_at
            "#
        )
        .bind(message.id)
        .bind(message.tenant_id)
        .bind(message.topic)
        .bind(message.payload)
        .bind(message.available_at)
        .bind(message.attempt_count)
        .bind(message.last_error)
        .bind(message.claim_token)
        .bind(message.created_at)
        .fetch_one(&self.pool)
        .await
        .map_err(crate::error::from_sqlx)?;

        Ok(row)
    }

    async fn claim_messages(&self, batch_size: i64) -> Result<Vec<OutboxMessageRow>> {
        let rows = sqlx::query_as::<_, OutboxMessageRow>(
            r#"
            UPDATE outbox_messages
            SET available_at = now() + interval '30 seconds',
                attempt_count = attempt_count + 1,
                claim_token = gen_random_uuid()
            WHERE id IN (
                SELECT id FROM outbox_messages 
                WHERE available_at <= now() 
                ORDER BY created_at ASC 
                LIMIT $1 
                FOR UPDATE SKIP LOCKED
            )
            RETURNING id, tenant_id, topic, payload, available_at, attempt_count, last_error, claim_token, created_at
            "#
        )
        .bind(batch_size)
        .fetch_all(&self.pool)
        .await
        .map_err(crate::error::from_sqlx)?;

        Ok(rows)
    }

    async fn delete_message(&self, id: uuid::Uuid, claim_token: uuid::Uuid) -> Result<bool> {
        let result = sqlx::query(
            r#"
            DELETE FROM outbox_messages WHERE id = $1 AND claim_token = $2
            "#,
        )
        .bind(id)
        .bind(claim_token)
        .execute(&self.pool)
        .await
        .map_err(crate::error::from_sqlx)?;

        Ok(result.rows_affected() > 0)
    }
}
