use axiom_api::auth::UserRole;
use axiom_api::cache::RedisCache;
use axiom_api::crypto::{
    decrypt_aes_gcm, encrypt_aes_gcm, generate_secure_token, hash_password, hash_token,
    resolve_master_key, verify_password,
};
use axiom_api::telemetry::{EventCategory, OperationalEvent, TelemetryHub};
use chrono::Utc;
use uuid::Uuid;

#[test]
fn test_argon2id_password_hashing_and_verification() {
    let password = "SuperSecretPassword2026!";
    let hash1 = hash_password(password).expect("Hash 1 succeeds");
    let hash2 = hash_password(password).expect("Hash 2 succeeds");

    // Must be valid Argon2id format
    assert!(hash1.starts_with("$argon2id$"), "Hash should use Argon2id");
    assert!(hash2.starts_with("$argon2id$"), "Hash should use Argon2id");

    // Salt must be unique per hash
    assert_ne!(
        hash1, hash2,
        "Two hashes of same password must differ due to unique salts"
    );

    // Verification
    assert!(
        verify_password(password, &hash1).is_ok(),
        "Correct password must verify"
    );
    assert!(
        verify_password(password, &hash2).is_ok(),
        "Correct password must verify"
    );
    assert!(
        verify_password("wrong_password", &hash1).is_err(),
        "Wrong password must be rejected"
    );
}

#[test]
fn test_aes_256_gcm_authenticated_encryption() {
    let master_key = resolve_master_key();
    let secret_payload = b"sk-provider-secret-ai-model-key-xyz123";

    let (ciphertext1, nonce1) =
        encrypt_aes_gcm(secret_payload, &master_key).expect("Encryption 1 succeeds");
    let (ciphertext2, nonce2) =
        encrypt_aes_gcm(secret_payload, &master_key).expect("Encryption 2 succeeds");

    // Unique nonces
    assert_ne!(nonce1, nonce2, "Nonces must be unique per encryption");
    assert_eq!(nonce1.len(), 12, "Nonce must be 96-bit (12 bytes)");

    // Ciphertext cannot match plaintext
    assert_ne!(ciphertext1, secret_payload);
    assert_ne!(ciphertext1, ciphertext2);

    // Decrypt
    let decrypted =
        decrypt_aes_gcm(&ciphertext1, &nonce1, &master_key).expect("Decryption succeeds");
    assert_eq!(decrypted, secret_payload);

    // Corrupted ciphertext must fail authentication
    let mut tampered = ciphertext1.clone();
    tampered[0] ^= 0xFF;
    assert!(
        decrypt_aes_gcm(&tampered, &nonce1, &master_key).is_err(),
        "Tampered ciphertext must fail authentication"
    );

    // Corrupted nonce must fail
    let mut bad_nonce = nonce1.clone();
    bad_nonce[0] ^= 0xFF;
    assert!(
        decrypt_aes_gcm(&ciphertext1, &bad_nonce, &master_key).is_err(),
        "Bad nonce must fail"
    );
}

#[test]
fn test_secure_token_generation() {
    let t1 = generate_secure_token();
    let t2 = generate_secure_token();

    assert_ne!(t1, t2);
    assert_eq!(t1.len(), 64, "32 bytes in hex is 64 chars");
    assert_eq!(t2.len(), 64);

    let h1 = hash_token(&t1);
    let h2 = hash_token(&t1);
    assert_eq!(h1, h2, "SHA-256 hash must be deterministic");
}

#[test]
fn test_user_role_hierarchy() {
    assert!(UserRole::Viewer < UserRole::Operator);
    assert!(UserRole::Operator < UserRole::Admin);
    assert!(UserRole::Viewer < UserRole::Admin);

    assert_eq!(UserRole::from_str("admin"), UserRole::Admin);
    assert_eq!(UserRole::from_str("operator"), UserRole::Operator);
    assert_eq!(UserRole::from_str("viewer"), UserRole::Viewer);
    assert_eq!(UserRole::from_str("unknown"), UserRole::Viewer);
}

#[tokio::test]
async fn test_telemetry_hub_streaming_and_ai_metrics() {
    let hub = TelemetryHub::new(100, 20);
    let mut subscriber = hub.subscribe();

    let tenant_id = Uuid::new_v4();

    // 1. Emit normal workflow event
    hub.emit(OperationalEvent {
        event_id: Uuid::new_v4(),
        timestamp: Utc::now(),
        category: EventCategory::Workflow,
        event_type: "workflow_registered".into(),
        tenant_id,
        workflow_id: None,
        workflow_name: Some("test_flow".into()),
        run_id: None,
        step_id: None,
        worker_id: None,
        message: "Workflow test_flow registered".into(),
        metadata: serde_json::json!({}),
    });

    let received = subscriber.recv().await.expect("Subscriber receives event");
    assert_eq!(received.event_type, "workflow_registered");

    // 2. Emit AI Agent telemetry events
    hub.emit(OperationalEvent {
        event_id: Uuid::new_v4(),
        timestamp: Utc::now(),
        category: EventCategory::AiAgent,
        event_type: "ai_agent_invoked".into(),
        tenant_id,
        workflow_id: None,
        workflow_name: Some("incident_triage_agent".into()),
        run_id: None,
        step_id: None,
        worker_id: None,
        message: "AI Agent invoked for incident inc-01".into(),
        metadata: serde_json::json!({}),
    });

    hub.emit(OperationalEvent {
        event_id: Uuid::new_v4(),
        timestamp: Utc::now(),
        category: EventCategory::AiAgent,
        event_type: "ai_tool_outcome".into(),
        tenant_id,
        workflow_id: None,
        workflow_name: Some("incident_triage_agent".into()),
        run_id: None,
        step_id: Some("check_system_health".into()),
        worker_id: None,
        message: "Tool check_system_health completed".into(),
        metadata: serde_json::json!({ "success": true }),
    });

    hub.emit(OperationalEvent {
        event_id: Uuid::new_v4(),
        timestamp: Utc::now(),
        category: EventCategory::AiAgent,
        event_type: "ai_agent_completed".into(),
        tenant_id,
        workflow_id: None,
        workflow_name: Some("incident_triage_agent".into()),
        run_id: None,
        step_id: None,
        worker_id: None,
        message: "AI Agent triage completed".into(),
        metadata: serde_json::json!({
            "total_tokens": 320,
            "model_latency_ms": 65
        }),
    });

    let ai_stats = hub.get_ai_metrics();
    assert_eq!(ai_stats["invocations"], 1);
    assert_eq!(ai_stats["tool_calls"], 1);
    assert_eq!(ai_stats["tool_failures"], 0);
    assert_eq!(ai_stats["tool_success_rate_pct"], 100.0);
    assert_eq!(ai_stats["total_tokens"], 320);

    // 3. Snapshot retrieval
    let snapshot = hub.get_recent_snapshot(Some(tenant_id), None, None, 10);
    assert_eq!(snapshot.len(), 4);
}

#[tokio::test]
async fn test_redis_cache_graceful_fallback() {
    // Deliberately point to an unreachable port to test graceful bypass fallback
    let unreachable_cache = RedisCache::new(Some("redis://127.0.0.1:59999".to_string())).await;

    // Read should return None without error
    let res: Option<String> = unreachable_cache.get("nonexistent_key").await;
    assert!(res.is_none());

    // Write should not crash
    unreachable_cache.set("test_key", &"test_val", 60).await;

    // Stats should honestly report disconnected
    let stats = unreachable_cache.get_stats().await;
    assert!(
        !stats.is_connected,
        "Should honestly report Redis is disconnected"
    );
    assert!(stats.status_message.contains("unavailable"));
}
