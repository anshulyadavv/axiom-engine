use axiom_core::{AxiomError, error::DatabaseError};

pub fn from_sqlx(e: sqlx::Error) -> AxiomError {
    match e {
        sqlx::Error::Database(db_err) => {
            AxiomError::Database(DatabaseError {
                code: db_err.code().map(|c| c.into_owned()),
                message: db_err.message().to_string(),
                constraint: db_err.constraint().map(|c| c.to_string()),
            })
        }
        _ => AxiomError::Database(DatabaseError {
            code: None,
            message: e.to_string(),
            constraint: None,
        })
    }
}
