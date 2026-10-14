use axum::{
    extract::{Query, State},
    response::sse::{Event, KeepAlive, Sse},
    Json,
};
use futures::stream::{self, Stream, StreamExt};
use serde::Deserialize;
use std::convert::Infallible;
use std::time::Duration;
use tokio_stream::wrappers::BroadcastStream;
use uuid::Uuid;
use crate::{
    server::AppState,
    auth::AuthenticatedUser,
    telemetry::OperationalEvent,
    handlers::workflows::ApiData,
    error::ApiError,
};

#[derive(Deserialize)]
pub struct EventFilterQuery {
    pub category: Option<String>,
    pub workflow_id: Option<Uuid>,
    pub run_id: Option<Uuid>,
    pub limit: Option<usize>,
}

pub async fn recent_events(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Query(query): Query<EventFilterQuery>,
) -> Result<Json<ApiData<Vec<OperationalEvent>>>, ApiError> {
    let limit = query.limit.unwrap_or(50).min(200);
    let events = state.telemetry.get_recent_snapshot(
        Some(user.tenant_id.0),
        query.workflow_id,
        query.run_id,
        limit,
    );
    Ok(Json(ApiData { data: events }))
}

pub async fn event_stream(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Query(query): Query<EventFilterQuery>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let tenant_id = user.tenant_id.0;
    let category_filter = query.category.clone();
    let workflow_filter = query.workflow_id;
    let run_filter = query.run_id;

    // 1. Snapshot of recent events
    let snapshot = state.telemetry.get_recent_snapshot(
        Some(tenant_id),
        workflow_filter,
        run_filter,
        25,
    );

    let snapshot_stream = stream::iter(snapshot).map(|ev| {
        let json_str = serde_json::to_string(&ev).unwrap_or_default();
        Ok(Event::default()
            .event("snapshot")
            .id(ev.event_id.to_string())
            .data(json_str))
    });

    // 2. Broadcast stream wrapped with BroadcastStream
    let broadcast_rx = state.telemetry.subscribe();
    let broadcast_stream = BroadcastStream::new(broadcast_rx).filter_map(move |item| {
        let cat_opt = category_filter.clone();
        async move {
            match item {
                Ok(ev) => {
                    if ev.tenant_id != tenant_id && ev.tenant_id != Uuid::nil() {
                        return None;
                    }
                    if let Some(ref cat) = cat_opt {
                        let ev_cat_str = serde_json::to_string(&ev.category).unwrap_or_default().replace('"', "");
                        if !ev_cat_str.eq_ignore_ascii_case(cat) {
                            return None;
                        }
                    }
                    if let Some(wf) = workflow_filter {
                        if ev.workflow_id != Some(wf) {
                            return None;
                        }
                    }
                    if let Some(rn) = run_filter {
                        if ev.run_id != Some(rn) {
                            return None;
                        }
                    }
                    let json_str = serde_json::to_string(&ev).unwrap_or_default();
                    Some(Ok(Event::default()
                        .event("event")
                        .id(ev.event_id.to_string())
                        .data(json_str)))
                }
                Err(tokio_stream::wrappers::errors::BroadcastStreamRecvError::Lagged(skipped)) => {
                    tracing::warn!("SSE subscriber lagged by {} events", skipped);
                    let warning_json = serde_json::json!({
                        "warning": "lagged",
                        "skipped_count": skipped
                    }).to_string();
                    Some(Ok(Event::default().event("warning").data(warning_json)))
                }
            }
        }
    });

    let full_stream = snapshot_stream.chain(broadcast_stream);

    Sse::new(full_stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive"),
    )
}
