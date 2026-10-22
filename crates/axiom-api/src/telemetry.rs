use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::Mutex;
use tokio::sync::broadcast;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventCategory {
    Workflow,
    Run,
    Step,
    Worker,
    Cache,
    AiAgent,
    Outbox,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperationalEvent {
    pub event_id: Uuid,
    pub timestamp: DateTime<Utc>,
    pub category: EventCategory,
    pub event_type: String,
    pub tenant_id: Uuid,
    pub workflow_id: Option<Uuid>,
    pub workflow_name: Option<String>,
    pub run_id: Option<Uuid>,
    pub step_id: Option<String>,
    pub worker_id: Option<String>,
    pub message: String,
    pub metadata: serde_json::Value,
}

pub struct TelemetryHub {
    sender: broadcast::Sender<OperationalEvent>,
    recent_events: Mutex<VecDeque<OperationalEvent>>,
    max_history: usize,

    // AI agent cumulative metrics
    ai_invocations: std::sync::atomic::AtomicU64,
    ai_tool_calls: std::sync::atomic::AtomicU64,
    ai_tool_failures: std::sync::atomic::AtomicU64,
    ai_total_tokens: std::sync::atomic::AtomicU64,
    ai_total_latency_ms: std::sync::atomic::AtomicU64,
}

impl TelemetryHub {
    pub fn new(capacity: usize, max_history: usize) -> Self {
        let (sender, _) = broadcast::channel(capacity);
        Self {
            sender,
            recent_events: Mutex::new(VecDeque::with_capacity(max_history)),
            max_history,
            ai_invocations: std::sync::atomic::AtomicU64::new(0),
            ai_tool_calls: std::sync::atomic::AtomicU64::new(0),
            ai_tool_failures: std::sync::atomic::AtomicU64::new(0),
            ai_total_tokens: std::sync::atomic::AtomicU64::new(0),
            ai_total_latency_ms: std::sync::atomic::AtomicU64::new(0),
        }
    }

    /// Broadcast an operational event and store it in the bounded snapshot buffer.
    pub fn emit(&self, event: OperationalEvent) {
        // Record AI metrics if applicable
        if matches!(event.category, EventCategory::AiAgent) {
            match event.event_type.as_str() {
                "ai_agent_invoked" => {
                    self.ai_invocations
                        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                }
                "ai_tool_outcome" => {
                    self.ai_tool_calls
                        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    if event.metadata.get("success").and_then(|v| v.as_bool()) == Some(false) {
                        self.ai_tool_failures
                            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    }
                }
                "ai_agent_completed" => {
                    if let Some(tokens) =
                        event.metadata.get("total_tokens").and_then(|v| v.as_u64())
                    {
                        self.ai_total_tokens
                            .fetch_add(tokens, std::sync::atomic::Ordering::Relaxed);
                    }
                    if let Some(latency) = event
                        .metadata
                        .get("model_latency_ms")
                        .and_then(|v| v.as_u64())
                    {
                        self.ai_total_latency_ms
                            .fetch_add(latency, std::sync::atomic::Ordering::Relaxed);
                    }
                }
                _ => {}
            }
        }

        // Store in bounded buffer
        {
            let mut buffer = self.recent_events.lock().unwrap();
            if buffer.len() >= self.max_history {
                buffer.pop_front();
            }
            buffer.push_back(event.clone());
        }

        // Broadcast to live SSE subscribers (ignore errors if no active receivers)
        let _ = self.sender.send(event);
    }

    /// Subscribe to the live broadcast channel.
    pub fn subscribe(&self) -> broadcast::Receiver<OperationalEvent> {
        self.sender.subscribe()
    }

    /// Get recent snapshot events for a specific tenant and optional filters.
    pub fn get_recent_snapshot(
        &self,
        tenant_id: Option<Uuid>,
        workflow_id: Option<Uuid>,
        run_id: Option<Uuid>,
        limit: usize,
    ) -> Vec<OperationalEvent> {
        let buffer = self.recent_events.lock().unwrap();
        buffer
            .iter()
            .rev()
            .filter(|e| {
                if let Some(tid) = tenant_id {
                    if e.tenant_id != tid && e.tenant_id != Uuid::nil() {
                        return false;
                    }
                }
                if let Some(wid) = workflow_id {
                    if e.workflow_id != Some(wid) {
                        return false;
                    }
                }
                if let Some(rid) = run_id {
                    if e.run_id != Some(rid) {
                        return false;
                    }
                }
                true
            })
            .take(limit)
            .cloned()
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect()
    }

    /// Get cumulative AI telemetry stats.
    pub fn get_ai_metrics(&self) -> serde_json::Value {
        let invocations = self
            .ai_invocations
            .load(std::sync::atomic::Ordering::Relaxed);
        let tool_calls = self
            .ai_tool_calls
            .load(std::sync::atomic::Ordering::Relaxed);
        let tool_failures = self
            .ai_tool_failures
            .load(std::sync::atomic::Ordering::Relaxed);
        let total_tokens = self
            .ai_total_tokens
            .load(std::sync::atomic::Ordering::Relaxed);
        let total_lat = self
            .ai_total_latency_ms
            .load(std::sync::atomic::Ordering::Relaxed);

        let avg_latency_ms = if invocations > 0 {
            Some((total_lat as f64) / (invocations as f64))
        } else {
            None
        };

        let tool_success_rate = if tool_calls > 0 {
            Some(((tool_calls - tool_failures) as f64 / tool_calls as f64) * 100.0)
        } else {
            None
        };

        let active_provider = std::env::var("AI_PROVIDER")
            .unwrap_or_else(|_| "local-deterministic-adapter".to_string());
        let is_test_adapter =
            active_provider == "local-deterministic-adapter" || active_provider.contains("test");

        serde_json::json!({
            "invocations": invocations,
            "tool_calls": tool_calls,
            "tool_failures": tool_failures,
            "tool_success_rate_pct": tool_success_rate,
            "total_tokens": total_tokens,
            "avg_model_latency_ms": avg_latency_ms,
            "active_provider": active_provider,
            "is_test_adapter": is_test_adapter,
        })
    }
}
