use axum::{extract::{State, Query}, Json};
use serde::{Deserialize, Serialize};
use crate::{server::AppState, error::ApiError, auth::AuthenticatedTenant, handlers::workflows::ApiData};
use uuid::Uuid;

#[derive(Deserialize)]
pub struct SearchQuery {
    pub q: String,
}

#[derive(Serialize)]
#[serde(tag = "type")]
pub enum SearchResult {
    Workflow { id: Uuid, name: String, version: i32 },
    Run { id: Uuid, workflow_name: String, status: String },
    Step { run_id: Uuid, step_id: String, attempt: i32 },
}

pub async fn search_all(
    AuthenticatedTenant(tenant_id): AuthenticatedTenant,
    State(state): State<AppState>,
    Query(query): Query<SearchQuery>,
) -> Result<Json<ApiData<Vec<SearchResult>>>, ApiError> {
    let q = query.q.trim();
    if q.is_empty() {
        return Ok(Json(ApiData { data: vec![] }));
    }

    let mut results = vec![];

    // Try parsing as UUID first
    if let Ok(id) = Uuid::parse_str(q) {
        // Search workflows by ID
        if let Ok(Some(row)) = sqlx::query!("SELECT id, name, version FROM workflows WHERE id = $1 AND tenant_id = $2", id, tenant_id.0)
            .fetch_optional(&state.db.pool).await 
        {
            results.push(SearchResult::Workflow { id: row.id, name: row.name, version: row.version });
        }
        
        // Search runs by ID (this also covers child_run_ids)
        if let Ok(Some(row)) = sqlx::query!(
            "SELECT r.id, w.name as workflow_name, r.status 
             FROM workflow_runs r
             JOIN workflows w ON r.workflow_id = w.id
             WHERE r.id = $1 AND r.tenant_id = $2", 
            id, tenant_id.0
        ).fetch_optional(&state.db.pool).await
        {
            results.push(SearchResult::Run { id: row.id, workflow_name: row.workflow_name, status: row.status.to_string() });
        }
    }

    let pattern = format!("%{}%", q);
    
    // Search workflows by name (ilike)
    if let Ok(rows) = sqlx::query!("SELECT id, name, version FROM workflows WHERE tenant_id = $1 AND name ILIKE $2 LIMIT 5", tenant_id.0, pattern)
        .fetch_all(&state.db.pool).await
    {
        for row in rows {
            results.push(SearchResult::Workflow { id: row.id, name: row.name, version: row.version });
        }
    }

    // Search step executions by step_id (ilike)
    if let Ok(rows) = sqlx::query!(
        "SELECT s.run_id, s.step_id, s.attempt 
         FROM step_executions s
         JOIN workflow_runs r ON s.run_id = r.id
         WHERE r.tenant_id = $1 AND s.step_id ILIKE $2 LIMIT 5",
        tenant_id.0, pattern
    ).fetch_all(&state.db.pool).await {
        for row in rows {
            results.push(SearchResult::Step { run_id: row.run_id, step_id: row.step_id, attempt: row.attempt });
        }
    }

    Ok(Json(ApiData { data: results }))
}
