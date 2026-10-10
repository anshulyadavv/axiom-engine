use std::sync::Arc;
use tokio::time::{sleep, Duration};
use tracing::{error, info};
use axiom_storage::{Database, traits::OutboxRepository};
use async_nats::jetstream::Context as JetStream;

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
            let payload_bytes = bytes::Bytes::from(serde_json::to_vec(&msg.payload)?);
            
            // At-least-once delivery: we try to publish to NATS.
            match self.js.publish(msg.topic.clone(), payload_bytes).await {
                Ok(_) => {
                    // 3. On success, delete the outbox message to prevent redelivery
                    if let Some(claim_token) = msg.claim_token {
                        if let Err(e) = self.db.delete_message(msg.id, claim_token).await {
                            error!("Failed to delete outbox message {} after publish: {}", msg.id, e);
                            // This creates a duplicate delivery window! 
                            // If we fail to delete, the outbox relayer will eventually re-claim and re-publish.
                            // The worker consumer is designed to handle this via fencing.
                        } else {
                            info!(msg_id = %msg.id, topic = %msg.topic, "Relayed outbox message to NATS");
                        }
                    }
                }
                Err(e) => {
                    error!("Failed to publish outbox message {} to NATS: {}. Will retry later.", msg.id, e);
                    metrics::counter!("axiom_nats_dispatch_failures_total", "topic" => msg.topic.clone()).increment(1);
                    // Do not delete. The claim will expire (or attempt_count will increment) and it will be retried.
                }
            }
        }

        Ok(())
    }
}
