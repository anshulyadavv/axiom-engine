use serde::{Deserialize, Serialize};
use axiom_core::{RunId, FenceToken};

// =========================================================================
// NATS SUBJECT CONFIGURATION
// =========================================================================

/// NATS stream configuration constant
pub const STREAM_NAME: &str = "AXIOM_WORK";

/// Subject for dispatching step execution work
/// Publisher: Rust Scheduler (after PostgreSQL lease acquisition)
/// Consumer: Rust Worker (via JetStream)
/// Semantics: At-least-once delivery. Durable identity via fence_token in Postgres.
pub const SUBJECT_WORK_EXECUTE: &str = "axiom.step.execute";

/// Subject for notifying clients of workflow completion
/// Publisher: Rust Worker (after semantic event is durably committed)
/// Consumer: External API clients / wait loops (Core NATS)
/// Semantics: Best-effort delivery. Core NATS, non-authoritative.
pub const SUBJECT_NOTIFY_COMPLETION: &str = "axiom.notifications.workflow_completed";

// =========================================================================
// MESSAGE ENVELOPES
// =========================================================================

/// Dispatched to JetStream when a worker has acquired a lease for a step.
/// This acts as a routing slip, not the authoritative state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkMessage {
    pub message_id: String, // idempotency key for JetStream deduplication
    pub run_id: RunId,
    pub step_id: String,
    pub attempt: i32,
    pub workflow_name: String,
    pub workflow_version: i32,
    pub fence_token: FenceToken, // Crucial for late-rejection of stale work
    pub correlation_id: Option<String>,
}
