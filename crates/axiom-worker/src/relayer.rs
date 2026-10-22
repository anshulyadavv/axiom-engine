use async_nats::jetstream::Context as JetStream;
use axiom_storage::{traits::OutboxRepository, Database};
use std::sync::Arc;
use tokio::time::{sleep, Duration};
use tracing::{error, info};

pub struct OutboxRelayer {
    pub db: Arc<Database>,
    pub js: JetStream,
}

impl OutboxRelayer {
    pub async fn run(&self) -> anyhow::Result<()> {
        loop {
            if let Err(e) = self.poll_and_relay().await {
                error!("OutboxRelayer error: {:?}", e);
            }
            sleep(Duration::from_millis(500)).await;
        }
    }

    async fn poll_and_relay(&self) -> anyhow::Result<()> {
        // 1. Claim a batch of outbox messages
        let messages = self.db.claim_messages(50).await?;
        if messages.is_empty() {
            return Ok(());
        }

        // 2. Relay each message to JetStream
        for msg in messages {
            let lag_ms = (chrono::Utc::now() - msg.created_at).num_milliseconds();
            let payload_bytes = bytes::Bytes::from(serde_json::to_vec(&msg.payload)?);

            let message_id = msg
                .payload
                .get("message_id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| msg.id.to_string());

            let mut headers = async_nats::HeaderMap::new();
            headers.insert("Nats-Msg-Id", message_id.as_str());

            // At-least-once delivery: we try to publish to NATS with JetStream deduplication header.
            match self
                .js
                .publish_with_headers(msg.topic.clone(), headers, payload_bytes)
                .await
            {
                Ok(_) => {
                    // 3. On success, delete the outbox message to prevent redelivery
                    if let Some(claim_token) = msg.claim_token {
                        if let Err(e) = self.db.delete_message(msg.id, claim_token).await {
                            error!(
                                "Failed to delete outbox message {} after publish: {}",
                                msg.id, e
                            );
                            // This creates a duplicate delivery window!
                            // If we fail to delete, the outbox relayer will eventually re-claim and re-publish.
                            // The worker consumer is designed to handle this via fencing.
                        } else {
                            info!(msg_id = %msg.id, topic = %msg.topic, lag_ms = %lag_ms, "Relayed outbox message to NATS");
                            metrics::histogram!("axiom_outbox_lag_ms").record(lag_ms as f64);
                        }
                    }
                }
                Err(e) => {
                    error!(
                        "Failed to publish outbox message {} to NATS: {}. Will retry later.",
                        msg.id, e
                    );
                    metrics::counter!("axiom_nats_dispatch_failures_total", "topic" => msg.topic.clone()).increment(1);
                    // Do not delete. The claim will expire (or attempt_count will increment) and it will be retried.
                }
            }
        }

        Ok(())
    }
}
