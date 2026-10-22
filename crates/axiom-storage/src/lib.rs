pub mod db;
pub mod error;
pub mod models;
pub mod pg;
pub mod traits;

pub use db::Database;
pub use traits::{
    EventRepository, OutboxRepository, RunRepository, StateRepository, StepRepository,
    WorkflowRepository,
};

pub fn lease_ttl_ms() -> i64 {
    std::env::var("AXIOM_LEASE_TTL_MS")
        .ok()
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(30_000)
}
