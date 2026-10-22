use axiom_core::Result;
use sqlx::postgres::{PgPool, PgPoolOptions};

#[derive(Clone)]
pub struct Database {
    pub pool: PgPool,
}

impl Database {
    pub async fn connect(url: &str) -> Result<Self> {
        let pool = PgPoolOptions::new()
            .max_connections(50)
            .connect(url)
            .await
            .map_err(crate::error::from_sqlx)?;

        Ok(Self { pool })
    }

    pub async fn run_migrations(&self) -> Result<()> {
        sqlx::migrate!("./migrations")
            .run(&self.pool)
            .await
            .map_err(|e| axiom_core::AxiomError::Internal(e.to_string()))?;
        Ok(())
    }
}
