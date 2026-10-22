use redis::aio::ConnectionManager;
use redis::AsyncCommands;
use serde::{de::DeserializeOwned, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tracing::{debug, error, info, warn};

#[derive(Debug, Clone, serde::Serialize)]
pub struct CacheStatsSnapshot {
    pub is_connected: bool,
    pub hits: u64,
    pub misses: u64,
    pub hit_ratio_pct: Option<f64>,
    pub writes: u64,
    pub errors: u64,
    pub avg_read_latency_ms: Option<f64>,
    pub avg_write_latency_ms: Option<f64>,
    pub used_memory_human: Option<String>,
    pub connected_clients: Option<u64>,
    pub evicted_keys: Option<u64>,
    pub total_operations: u64,
    pub status_message: String,
}

pub struct RedisCache {
    client: Option<redis::Client>,
    connection: tokio::sync::RwLock<Option<ConnectionManager>>,
    redis_url: String,

    // Real telemetry counters
    hits: AtomicU64,
    misses: AtomicU64,
    writes: AtomicU64,
    errors: AtomicU64,
    total_read_duration_micros: AtomicU64,
    read_count: AtomicU64,
    total_write_duration_micros: AtomicU64,
    write_count: AtomicU64,
}

impl RedisCache {
    pub async fn new(redis_url: Option<String>) -> Self {
        let url = redis_url.unwrap_or_else(|| {
            std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string())
        });

        let (client, manager) = match redis::Client::open(url.as_str()) {
            Ok(cli) => {
                // Attempt async connection manager with 2s timeout
                match tokio::time::timeout(
                    Duration::from_secs(2),
                    ConnectionManager::new(cli.clone()),
                )
                .await
                {
                    Ok(Ok(mgr)) => {
                        info!("Redis cache connected successfully at {}", url);
                        (Some(cli), Some(mgr))
                    }
                    Ok(Err(e)) => {
                        warn!(
                            "Redis cache connection failed (running in fallback bypass mode): {}",
                            e
                        );
                        (Some(cli), None)
                    }
                    Err(_) => {
                        warn!("Redis cache connection timed out at {} (running in fallback bypass mode)", url);
                        (Some(cli), None)
                    }
                }
            }
            Err(e) => {
                warn!("Invalid REDIS_URL {}: {} (cache disabled)", url, e);
                (None, None)
            }
        };

        Self {
            client,
            connection: tokio::sync::RwLock::new(manager),
            redis_url: url,
            hits: AtomicU64::new(0),
            misses: AtomicU64::new(0),
            writes: AtomicU64::new(0),
            errors: AtomicU64::new(0),
            total_read_duration_micros: AtomicU64::new(0),
            read_count: AtomicU64::new(0),
            total_write_duration_micros: AtomicU64::new(0),
            write_count: AtomicU64::new(0),
        }
    }

    /// Check connection health and re-establish connection if previously dropped.
    pub async fn check_health(&self) -> bool {
        let mut conn_guard = self.connection.write().await;
        if let Some(ref mut conn) = *conn_guard {
            let ping: redis::RedisResult<String> = redis::cmd("PING").query_async(conn).await;
            if ping.is_ok() {
                return true;
            }
        }

        // Try reconnecting
        if let Some(ref cli) = self.client {
            if let Ok(Ok(new_mgr)) = tokio::time::timeout(
                Duration::from_millis(1500),
                ConnectionManager::new(cli.clone()),
            )
            .await
            {
                *conn_guard = Some(new_mgr);
                return true;
            }
        }
        false
    }

    /// Get cached JSON deserializable value. Returns Ok(None) on cache miss or Redis outage.
    pub async fn get<T: DeserializeOwned>(&self, key: &str) -> Option<T> {
        let start = Instant::now();
        let conn_opt = self.connection.read().await;
        let mut conn = match conn_opt.as_ref() {
            Some(c) => c.clone(),
            None => {
                self.misses.fetch_add(1, Ordering::Relaxed);
                return None;
            }
        };
        drop(conn_opt);

        let res: redis::RedisResult<Option<String>> = conn.get(key).await;
        let duration = start.elapsed().as_micros() as u64;
        self.total_read_duration_micros
            .fetch_add(duration, Ordering::Relaxed);
        self.read_count.fetch_add(1, Ordering::Relaxed);

        match res {
            Ok(Some(raw_json)) => match serde_json::from_str::<T>(&raw_json) {
                Ok(val) => {
                    self.hits.fetch_add(1, Ordering::Relaxed);
                    debug!("Cache HIT for key {}", key);
                    Some(val)
                }
                Err(e) => {
                    error!("Cache JSON deserialization error for key {}: {}", key, e);
                    self.errors.fetch_add(1, Ordering::Relaxed);
                    None
                }
            },
            Ok(None) => {
                self.misses.fetch_add(1, Ordering::Relaxed);
                debug!("Cache MISS for key {}", key);
                None
            }
            Err(e) => {
                warn!("Redis read error for key {}: {}", key, e);
                self.errors.fetch_add(1, Ordering::Relaxed);
                self.misses.fetch_add(1, Ordering::Relaxed);
                None
            }
        }
    }

    /// Set cached JSON serializable value with TTL in seconds.
    pub async fn set<T: Serialize>(&self, key: &str, value: &T, ttl_seconds: u64) {
        let start = Instant::now();
        let raw_json = match serde_json::to_string(value) {
            Ok(s) => s,
            Err(e) => {
                error!("Cache JSON serialization error for key {}: {}", key, e);
                self.errors.fetch_add(1, Ordering::Relaxed);
                return;
            }
        };

        let conn_opt = self.connection.read().await;
        let mut conn = match conn_opt.as_ref() {
            Some(c) => c.clone(),
            None => return,
        };
        drop(conn_opt);

        let res: redis::RedisResult<()> = conn.set_ex(key, raw_json, ttl_seconds).await;
        let duration = start.elapsed().as_micros() as u64;
        self.total_write_duration_micros
            .fetch_add(duration, Ordering::Relaxed);
        self.write_count.fetch_add(1, Ordering::Relaxed);

        match res {
            Ok(_) => {
                self.writes.fetch_add(1, Ordering::Relaxed);
                debug!("Cache SET for key {} with ttl {}s", key, ttl_seconds);
            }
            Err(e) => {
                warn!("Redis write error for key {}: {}", key, e);
                self.errors.fetch_add(1, Ordering::Relaxed);
            }
        }
    }

    /// Invalidate a specific key.
    pub async fn delete(&self, key: &str) {
        let conn_opt = self.connection.read().await;
        let mut conn = match conn_opt.as_ref() {
            Some(c) => c.clone(),
            None => return,
        };
        drop(conn_opt);

        let _: redis::RedisResult<()> = conn.del(key).await;
    }

    /// Invalidate keys by pattern (e.g. "workflow:00000000*").
    pub async fn delete_pattern(&self, pattern: &str) {
        let conn_opt = self.connection.read().await;
        let mut conn = match conn_opt.as_ref() {
            Some(c) => c.clone(),
            None => return,
        };
        drop(conn_opt);

        let keys_res: redis::RedisResult<Vec<String>> = conn.keys(pattern).await;
        if let Ok(keys) = keys_res {
            if !keys.is_empty() {
                let _: redis::RedisResult<()> = conn.del(keys).await;
            }
        }
    }

    /// Collect comprehensive real statistics from counters and live Redis INFO.
    pub async fn get_stats(&self) -> CacheStatsSnapshot {
        let hits = self.hits.load(Ordering::Relaxed);
        let misses = self.misses.load(Ordering::Relaxed);
        let writes = self.writes.load(Ordering::Relaxed);
        let errors = self.errors.load(Ordering::Relaxed);
        let total_ops = hits + misses + writes;

        let hit_ratio = if hits + misses > 0 {
            Some(((hits as f64) / ((hits + misses) as f64)) * 100.0)
        } else {
            None
        };

        let read_cnt = self.read_count.load(Ordering::Relaxed);
        let avg_read_lat = if read_cnt > 0 {
            Some(
                (self.total_read_duration_micros.load(Ordering::Relaxed) as f64)
                    / (read_cnt as f64)
                    / 1000.0,
            )
        } else {
            None
        };

        let write_cnt = self.write_count.load(Ordering::Relaxed);
        let avg_write_lat = if write_cnt > 0 {
            Some(
                (self.total_write_duration_micros.load(Ordering::Relaxed) as f64)
                    / (write_cnt as f64)
                    / 1000.0,
            )
        } else {
            None
        };

        let mut is_connected = false;
        let mut used_memory_human = None;
        let mut connected_clients = None;
        let mut evicted_keys = None;

        let conn_opt = self.connection.read().await;
        if let Some(ref conn_mgr) = *conn_opt {
            let mut conn = conn_mgr.clone();
            drop(conn_opt);

            let info_res: redis::RedisResult<String> =
                redis::cmd("INFO").query_async(&mut conn).await;
            if let Ok(info_str) = info_res {
                is_connected = true;
                for line in info_str.lines() {
                    let parts: Vec<&str> = line.split(':').collect();
                    if parts.len() == 2 {
                        let key = parts[0].trim();
                        let val = parts[1].trim();
                        match key {
                            "used_memory_human" => used_memory_human = Some(val.to_string()),
                            "connected_clients" => connected_clients = val.parse().ok(),
                            "evicted_keys" => evicted_keys = val.parse().ok(),
                            _ => {}
                        }
                    }
                }
            }
        }

        let status_message = if is_connected {
            format!("Connected to Redis at {}", self.redis_url)
        } else {
            format!(
                "Redis unavailable at {} (transparent bypass active)",
                self.redis_url
            )
        };

        CacheStatsSnapshot {
            is_connected,
            hits,
            misses,
            hit_ratio_pct: hit_ratio,
            writes,
            errors,
            avg_read_latency_ms: avg_read_lat,
            avg_write_latency_ms: avg_write_lat,
            used_memory_human,
            connected_clients,
            evicted_keys,
            total_operations: total_ops,
            status_message,
        }
    }
}
