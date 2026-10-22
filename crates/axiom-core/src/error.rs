use serde::{Deserialize, Serialize};
use thiserror::Error;

pub type Result<T> = std::result::Result<T, AxiomError>;

#[derive(Debug, Clone)]
pub struct DatabaseError {
    pub code: Option<String>,
    pub message: String,
    pub constraint: Option<String>,
}

impl std::fmt::Display for DatabaseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "DB Error [{:?}]: {} (constraint: {:?})",
            self.code, self.message, self.constraint
        )
    }
}

#[derive(Error, Debug)]
pub enum AxiomError {
    #[error("Database error: {0}")]
    Database(DatabaseError),

    #[error("Resource not found: {0}")]
    NotFound(String),

    #[error("Determinism violation: {0}")]
    DeterminismViolation(String),

    #[error("Lease lost or expired for run {0}")]
    LeaseLost(String),

    #[error("Serialization error: {0}")]
    Serialization(String),

    #[error("Internal engine error: {0}")]
    Internal(String),
}
