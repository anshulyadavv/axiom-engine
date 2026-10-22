# Axiom Engine — TODO

This document tracks deferred tests, future integration plans, and pending technical roadmap items.

## Live NATS Distributed Dispatch Tests

The following tests were previously placeholder tests in `crates/axiom-worker/tests/nats_dispatch.rs` that require a running NATS cluster with JetStream enabled. They have been removed from the standard workspace integration suite (which tests Postgres-only workflows) and will be implemented when dedicated NATS test harness infrastructure is integrated:

1. **`test_b_scheduler_crash_after_transaction_commit`**:
   - **Requirement**: Verify that if the scheduler crashes immediately after committing workflow state and outbox row to Postgres, the outbox row remains durable and is picked up by the relayer once restarted.
   - **Infrastructure Needed**: Live NATS JetStream server + worker process crash/restart harness.

2. **`test_c_outbox_relayer_eventually_publishes`**:
   - **Requirement**: Verify that `OutboxRelayer` reads pending messages from `outbox_messages`, publishes them to NATS JetStream, and deletes the row upon ACK.
   - **Infrastructure Needed**: Live NATS server, ephemeral JetStream stream `AXIOM_WORK`, and subscriber verification.

3. **`test_f_duplicate_workmessage_delivery`**:
   - **Requirement**: Verify that duplicate `WorkMessage` deliveries received by the NATS consumer are safely ignored or idempotently processed via fence token and `step_executions` checks without corrupting event history.
   - **Infrastructure Needed**: Live NATS JetStream server configured with message redelivery / duplicate publishing.

4. **`test_g_ack_only_after_durable_postgres_success`**:
   - **Requirement**: Verify that `msg.ack().await` happens strictly after PostgreSQL `append_event` or step transaction commits successfully, ensuring at-least-once processing across worker crashes.
   - **Infrastructure Needed**: Live NATS JetStream message acknowledgment inspection.

5. **`test_h_stale_fence_rejection`**:
   - **Requirement**: Verify that a worker receiving a `WorkMessage` with a stale `fence_token` rejects execution and drops the message without side effects.
   - **Infrastructure Needed**: Multi-worker cluster harness with NATS dispatch.

6. **`test_i_nats_unavailable`**:
   - **Requirement**: Verify that the system survives transient NATS outages, buffering state transitions in the Postgres transactional outbox and resuming delivery once NATS reconnects.
   - **Infrastructure Needed**: Network partition simulation / container stop/start for NATS.

7. **`test_j_notification_failure_does_not_affect_state`**:
   - **Requirement**: Verify that failure to publish ephemeral NATS broadcast notifications does not roll back or corrupt the durable Postgres commit.
   - **Infrastructure Needed**: Mock/faulty NATS publisher connection alongside PostgreSQL.
