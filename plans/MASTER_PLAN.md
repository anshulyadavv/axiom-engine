# Axiom Engine — Master Implementation Plan

> **Status Source of Truth**: [README Capability Status](../README.md#capability-status)

---

## Roadmap & Phase Status

Axiom Engine uses a unified four-phase roadmap. Every capability is tracked against active repository code and test suites.

---

## Phase 1: Core Runtime (Alpha)
**Status**: Implemented / Tested

### 1.1 Workflows-as-Code
- [x] TypeScript workflow definition helper (`workflow()`)
  - **Status**: Implemented & Tested
  - **Code Citation**: [`packages/sdk/src/types.ts:45`](../packages/sdk/src/types.ts)
  - **Test Citation**: [`packages/sdk/tests/doc_examples.test.ts:7`](../packages/sdk/tests/doc_examples.test.ts)

### 1.2 Durable Step Execution
- [x] Transactional step execution boundary (`ctx.step.run()`)
  - **Status**: Implemented & Tested
  - **Code Citation**: [`packages/sdk/src/engine.ts:128`](../packages/sdk/src/engine.ts)
  - **Storage Citation**: [`crates/axiom-storage/src/pg/events.rs:60`](../crates/axiom-storage/src/pg/events.rs)
  - **Test Citation**: [`crates/axiom-worker/tests/crash_recovery.rs:18`](../crates/axiom-worker/tests/crash_recovery.rs), [`crates/axiom-worker/tests/nats_dispatch.rs:350`](../crates/axiom-worker/tests/nats_dispatch.rs)

### 1.3 Deterministic Replay
- [x] Event history replay through TypeScript sidecar engine
  - **Status**: Implemented & Tested
  - **Code Citation**: [`packages/sdk/src/engine.ts:91`](../packages/sdk/src/engine.ts)
  - **Test Citation**: [`packages/sdk/tests/engine.test.ts:30`](../packages/sdk/tests/engine.test.ts), [`crates/axiom-worker/tests/integration.rs:30`](../crates/axiom-worker/tests/integration.rs)

### 1.4 Worker Lease Fencing & Crash Recovery
- [x] Atomic PostgreSQL run claiming with `FOR UPDATE SKIP LOCKED` and monotonic `fence_token`
  - **Status**: Implemented & Tested
  - **Code Citation**: [`crates/axiom-storage/src/pg/run.rs:250`](../crates/axiom-storage/src/pg/run.rs)
  - **Test Citation**: Automated crash recovery with step non-reexecution proof in [`crates/axiom-worker/tests/crash_recovery.rs`](../crates/axiom-worker/tests/crash_recovery.rs)

### 1.5 Transactional Outbox Relay
- [x] Atomic DB writes paired with background outbox relay to NATS JetStream
  - **Status**: Implemented & Tested
  - **Code Citation**: [`crates/axiom-worker/src/relayer.rs:50`](../crates/axiom-worker/src/relayer.rs)
  - **Storage Citation**: [`crates/axiom-storage/src/pg/outbox.rs:15`](../crates/axiom-storage/src/pg/outbox.rs)
  - **Test Citation**: [`crates/axiom-worker/tests/nats_dispatch.rs:100`](../crates/axiom-worker/tests/nats_dispatch.rs)

### 1.6 Workflow-Local Durable State
- [x] Key-value persistence scoped to workflow runs (`ctx.state.get/set/delete`)
  - **Status**: Implemented & Tested
  - **Code Citation**: [`packages/sdk/src/engine.ts:35`](../packages/sdk/src/engine.ts)
  - **Storage Citation**: [`crates/axiom-storage/src/pg/state.rs:10`](../crates/axiom-storage/src/pg/state.rs)
  - **Test Citation**: [`packages/sdk/tests/doc_examples.test.ts:175`](../packages/sdk/tests/doc_examples.test.ts)

### 1.7 Child Workflows
- [x] Child workflow dispatch and parent suspension/resumption (`ctx.child.run()`)
  - **Status**: Implemented & Tested
  - **Code Citation**: [`packages/sdk/src/engine.ts:167`](../packages/sdk/src/engine.ts)
  - **Storage Citation**: [`crates/axiom-storage/src/pg/run.rs:200`](../crates/axiom-storage/src/pg/run.rs)
  - **Test Citation**: [`packages/sdk/tests/doc_examples.test.ts:150`](../packages/sdk/tests/doc_examples.test.ts)

### 1.8 Run Management API & CLI
- [x] REST API endpoints and command-line tool for run inspection and cancellation
  - **Status**: Implemented & Tested
  - **Code Citation**: [`crates/axiom-api/src/handlers/runs.rs:90`](../crates/axiom-api/src/handlers/runs.rs), [`crates/axiom-cli/src/main.rs:100`](../crates/axiom-cli/src/main.rs)
  - **Test Citation**: [`crates/axiom-storage/tests/integration_tests.rs:100`](../crates/axiom-storage/tests/integration_tests.rs)

---

## Phase 2: Timers, Signals, Retries & Failure Handling
**Status**: Planned

### 2.1 Durable Timers (`ctx.sleep`)
- [ ] Durable timer table polling, workflow unload, and timer firing resumption
  - **Status**: Planned
  - **Current State**: PostgreSQL schema defined in `crates/axiom-storage/migrations/20240101000000_initial_schema.sql:184`; runtime queries not yet implemented. SDK stub throws in `packages/sdk/src/engine.ts:213`.

### 2.2 External Signals (`ctx.waitForSignal`)
- [ ] Inbound signal submission API and workflow resumption
  - **Status**: Planned
  - **Current State**: PostgreSQL schema defined in `crates/axiom-storage/migrations/20240101000000_initial_schema.sql:202`; runtime queries not yet implemented. SDK stub throws in `packages/sdk/src/engine.ts:218`.

### 2.3 Automatic Step Retries & Exponential Backoff
- [ ] Engine-level retry policies, jitter, and automated scheduler retry loops
  - **Status**: Planned
  - **Current State**: Storage columns `attempt` and `max_attempts` exist in `crates/axiom-storage/src/pg/step.rs:86`; automatic backoff and retry scheduling are hardcoded/unimplemented in `crates/axiom-worker/src/scheduler.rs:132`. Specification documented in `docs/RESEARCH.md#7-step-retry-policies-exponential-backoff--jitter-phase-2-design`.

### 2.4 Cancellation Propagation
- [ ] Signal active step sidecars and child workflows upon parent run cancellation
  - **Status**: Planned
  - **Current State**: `cancel_run` updates run record status in PostgreSQL (`crates/axiom-storage/src/pg/run.rs:375`), but active step sidecars and descendant child processes are not signaled.

---

## Phase 3: High-Scale Analytics (ClickHouse)
**Status**: Planned

### 3.1 ClickHouse Analytical Store
- [ ] Analytical event streaming pipeline for high-throughput query aggregation
  - **Status**: Planned
  - **Current State**: Architecture documented in `docs/ARCHITECTURE.md#34-advanced-backends-phase-3--phase-4`; no ClickHouse client code exists in `crates/`.

---

## Phase 4: High-Throughput Coordination (FoundationDB)
**Status**: Planned

### 4.1 FoundationDB Coordination Layer
- [ ] Distributed transaction coordinator replacing PostgreSQL leases at extreme scale
  - **Status**: Planned
  - **Current State**: Architecture documented in `docs/ARCHITECTURE.md#34-advanced-backends-phase-3--phase-4`; no FoundationDB client code exists in `crates/`.
