# Axiom Engine — Architecture

## 1. System Overview

Axiom Engine is a durable execution runtime composed of cooperating services connected through NATS messaging and backed by PostgreSQL as the primary durable store. Workflows are authored in TypeScript and executed via a supervised Node.js sidecar, with state and execution progress durably journaled into PostgreSQL.

### Current System Topology (As Implemented)

```
                          ┌──────────────────────────┐
                          │      TypeScript SDK      │ (Client / Workflow Authoring)
                          └─────────────┬────────────┘
                                        │ HTTPS
                                        ▼
                          ┌──────────────────────────┐
                          │     Rust API Gateway     │
                          │       (axiom-api)        │
                          └─────────────┬────────────┘
                                        │ SQL (axiom-storage)
                                        ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │                          PostgreSQL Database                           │
  │  ┌───────────────────────────────┐   ┌───────────────────────────────┐ │
  │  │         workflow_runs         │   │        outbox_messages        │ │
  │  │   (poll_run / lease fencing)  │   │     (transactional relay)     │ │
  │  └───────────────────────────────┘   └───────────────────────────────┘ │
  │  ┌───────────────────────────────┐   ┌───────────────────────────────┐ │
  │  │        events (history)       │   │        step_executions        │ │
  │  └───────────────────────────────┘   └───────────────────────────────┘ │
  └───────────────────▲──────────────────────────────────────▲─────────────┘
                      │                                      │
                      │ SQL (poll_run / leases / state)      │ SQL
                      ▼                                      ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │                       Rust Worker (axiom-worker)                       │
  │  ┌───────────────────────────────┐   ┌───────────────────────────────┐ │
  │  │       Scheduler Module        │   │        Outbox Relayer         │ │
  │  │   (poll_run loop in worker)   │   │     (publishes to NATS)       │ │
  │  └───────────────┬───────────────┘   └───────────────┬───────────────┘ │
  │                  │                                   │                 │
  │                  │ NATS work                         ▼                 │
  │                  │ dispatch             ┌─────────────────────────┐    │
  │                  └─────────────────────►│      NATS Broker        │    │
  │                                         │    (JetStream Work)     │    │
  │                                         └────────────┬────────────┘    │
  │  ┌───────────────────────────────┐                   │                 │
  │  │        Consumer Module        │◄──────────────────┘                 │
  │  │  (pulls step / replay tasks)  │                                     │
  │  └───────────────┬───────────────┘                                     │
  │                  │ IPC (JSON over stdio)                               │
  │                  ▼                                                     │
  │  ┌──────────────────────────────────────────────────────────────────┐  │
  │  │ Node.js Sidecar Process                                          │  │
  │  │  - User Workflow Functions (authored via @axiom/sdk)             │  │
  │  │  - TS Replay Execution Engine (packages/sdk/src/engine.ts)       │  │
  │  └──────────────────────────────────────────────────────────────────┘  │
  └────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Component Responsibilities (Current Implementation)

The repository workspace consists of six active Rust crates in `crates/` and TypeScript packages in `packages/`:

### 2.1 TypeScript SDK (`packages/sdk`)

**Responsibility**: Developer-facing authoring API, client library, and the **in-sidecar replay execution engine**.

- **Workflow Authoring API**: Defines `workflow()`, `ctx.step.run()`, `ctx.state`, `ctx.now()`, `ctx.random()`, and `ctx.sleep()`.
- **In-Sidecar Replay Engine (`packages/sdk/src/engine.ts`)**: Unlike early conceptual designs where the SDK had no execution logic, the replay engine (`WorkflowEngine` and `ContextImpl`) currently lives inside `packages/sdk/src/engine.ts`. When invoked by the Rust worker over IPC (`resume_workflow`), the sidecar replays the historical `SemanticEvent` stream against the workflow function, detects non-determinism, and yields commands (`ScheduleStep`, `ScheduleChildWorkflow`, `RecordTimestamp`, `RecordRandom`, `CompleteWorkflow`, or `FailWorkflow`) back to the Rust host.
- **Client Library (`packages/sdk/src/client.ts`)**: Provides typed HTTPS client methods (`AxiomClient`) for creating runs, sending signals, and inspecting workflow state.

### 2.2 Rust API Gateway (`crates/axiom-api`)

**Responsibility**: HTTP REST entry point for all external interactions.

- Axum-based HTTP server.
- Tenant authentication (Argon2id password hashing, scoped Bearer API keys).
- In-memory caching layer with Redis fallback support.
- Routes run submission, cancellation, worker inspection, and event querying to PostgreSQL via `axiom-storage`.
- Serves the dashboard static build assets.
- Exposes Prometheus telemetry metrics and structured logs.

### 2.3 Worker Runtime (`crates/axiom-worker`)

**Responsibility**: Core orchestration daemon managing polling, messaging, outbox publishing, and sidecar supervision.

- **Embedded Scheduler (`crates/axiom-worker/src/scheduler.rs`)**: Runs an asynchronous loop polling eligible runs directly from PostgreSQL via `RunRepository::poll_run` (using `FOR UPDATE SKIP LOCKED`). When a run is claimed, it reads semantic event history and dispatches execution tasks to NATS or runs inline step evaluations.
- **Outbox Relayer (`crates/axiom-worker/src/relayer.rs`)**: Polls `outbox_messages` from PostgreSQL via `FOR UPDATE SKIP LOCKED` and publishes them reliably to NATS JetStream, guaranteeing at-least-once message dispatch without dual-write hazards.
- **Consumer (`crates/axiom-worker/src/consumer.rs`)**: Pulls work messages from NATS work queues, maintains periodic lease renewals (`renew_lease`), deduplicates redundant deliveries, and enforces step attempt bounds.
- **Sidecar Supervisor (`crates/axiom-worker/src/process.rs`)**: Spawns and manages the Node.js TypeScript sidecar child process. Enforces strict IPC timeouts (`AXIOM_IPC_RESUME_TIMEOUT_MS`, `AXIOM_IPC_STEP_TIMEOUT_MS`), kills hung processes, and mediates state queries (`state_request` / `state_result`).

### 2.4 Durable Storage (`crates/axiom-storage`)

**Responsibility**: PostgreSQL persistence layer and transaction management using `sqlx`.

- Defines storage repository traits (`RunRepository`, `EventRepository`, `StepRepository`, `OutboxRepository`, `StateRepository`, `AuditRepository`, `WorkerRepository`).
- Manages embedded database migrations (`crates/axiom-storage/migrations`).
- Enforces atomic state transitions and monotonic lease fencing tokens (`fence_token`).
- Implements the Transactional Outbox pattern.

### 2.5 Core Types & Domain Model (`crates/axiom-core`)

**Responsibility**: Common domain models, identifiers, and error definitions shared across all crates.

- Strong domain types: `RunId`, `FenceToken`, `RunStatus`, `StepStatus`, `TenantId`, `WorkflowId`.
- Semantic event definitions: `SemanticEvent` (`WorkflowStarted`, `StepCompleted`, `StepFailed`, `TimestampRecorded`, `RandomRecorded`, `ChildWorkflowCompleted`, etc.).
- Centralized error taxonomy: `AxiomError`.

### 2.6 CLI (`crates/axiom-cli`)

**Responsibility**: Command-line interface for operators and developers.

- Commands for listing workflows, starting runs, inspecting event histories, and monitoring workers.

### 2.7 Dashboard (`packages/dashboard`)

**Responsibility**: Developer web console built in React, TypeScript, and Vite.

- Visualizes workflow runs, step attempt timelines, event DAGs, system metrics, and operational documentation.

---

### 2.8 How Multiple Workers Coordinate Today

Multiple worker instances coordinate directly through PostgreSQL without requiring a separate centralized scheduler leader or distributed lock manager:

1. **Queue-less polling via `poll_run`**: Every worker runs an asynchronous loop calling `RunRepository::poll_run`.
2. **`FOR UPDATE SKIP LOCKED` concurrency**: `poll_run` executes an atomic PostgreSQL query:
   ```sql
   UPDATE workflow_runs
   SET worker_id = $1,
       lease_expires_at = now() + interval '30 seconds',
       fence_token = fence_token + 1,
       updated_at = now()
   WHERE id = (
       SELECT id FROM workflow_runs
       WHERE status IN ('pending', 'running')
         AND (worker_id IS NULL OR lease_expires_at < now())
       LIMIT 1
       FOR UPDATE SKIP LOCKED
   )
   RETURNING id, fence_token
   ```
   This guarantees that concurrent workers claim distinct runs without lock contention or duplicate execution.
3. **Monotonic fencing & lease heartbeats**: The claiming query atomically assigns the worker's unique ID, sets a 30-second lease window (`lease_expires_at`), and increments the monotonic `fence_token`. While processing, the worker periodically renews the lease via `renew_lease(run_id, worker_id, fence_token)`. If renewal affects 0 rows (e.g., another worker acquired the run after an expiration), the worker immediately aborts and kills the sidecar.

---

### 2.9 Note on `crates/axiom-runtime` (Unused Prototype)

The `crates/axiom-runtime` crate contains an early, pure-Rust implementation of a deterministic replay cursor (`ReplayCursor`) and execution state machine (`WorkflowStateMachine`). When the system adopted the TypeScript sidecar model to execute user-authored TypeScript workflows natively, the replay logic was implemented directly inside the TypeScript SDK (`packages/sdk/src/engine.ts`). The Rust worker (`crates/axiom-worker`) queries the `events` table via `axiom-storage` and forwards raw semantic event arrays directly to the Node.js sidecar over IPC, where `WorkflowEngine` replays the history to determine the next action. Consequently, `axiom-runtime`'s replay and execution modules are completely bypassed by the worker and remain in the workspace as an unintegrated standalone prototype.

---

## 3. Planned Architecture (Future Phases)

The following components and architectural evolutions represent the intended long-term architecture design:

### 3.1 Dedicated Scheduler Service & Advisory Locks

- **Standalone Scheduler Service**: The scheduler loop currently runs as a background task inside `axiom-worker` (`crates/axiom-worker/src/scheduler.rs`). In multi-node deployments, it will run as an independent dedicated scheduler service.
- **Leader Election via PostgreSQL Advisory Locks**: To run multiple scheduler instances for high availability without double-polling or timer races, schedulers will participate in leader election using PostgreSQL application-level advisory locks (`pg_try_advisory_lock` / `pg_advisory_unlock` on a predefined 64-bit cluster lock ID). Only the active leader will poll due timers and dispatch work messages; standby instances will stand ready for immediate failover if the leader's connection drops.

### 3.2 Modular Messaging Architecture

- NATS JetStream and Core NATS pub/sub abstractions, subject naming conventions, connection pooling, and message serialization currently live inside `crates/axiom-worker`. In future phases, messaging abstractions can be decoupled into a shared internal module if additional services require direct pub/sub access.

### 3.3 Telemetry & Observability Pipeline

- Structured tracing configurations, Prometheus metrics collectors (currently configured in `crates/axiom-api` and `crates/axiom-worker`), and the planned ClickHouse event streaming pipeline will be unified into a dedicated telemetry and analytics pipeline.

### 3.4 Advanced Backends (Phase 3 / Phase 4)

- **ClickHouse (Phase 3)**: High-throughput analytical queries over execution histories without impacting PostgreSQL OLTP performance.
- **FoundationDB (Phase 4)**: Low-latency distributed transactions for high-scale coordination primitives, replacing PostgreSQL leases at extreme throughput.

---

## 4. Communication Patterns

### 4.1 Synchronous (Request/Response)

- **SDK → API Gateway**: HTTPS REST calls for run creation, cancellation, and queries.
- **API Gateway → Storage**: Direct SQL queries using connection pools (`sqlx::PgPool`).
- **Dashboard → API Gateway**: HTTPS REST + WebSocket/SSE for real-time telemetry.
- **Worker → Sidecar**: JSON IPC over stdin/stdout for workflow resumption and step execution.

### 4.2 Asynchronous (Pub/Sub via NATS & Transactional Outbox)

All database transactions that need to dispatch messages write to the **Transactional Outbox** (`outbox_messages`) in PostgreSQL. The outbox relayer polls these messages via `FOR UPDATE SKIP LOCKED` and publishes them to NATS JetStream:

- `axiom.workflow.execute`: Triggers workflow resumption or execution.
- `axiom.step.execute`: Dispatches an individual step execution to worker pools.
- `axiom.timer.fire`: Timer expiration notification (Phase 2).
- `axiom.signal.received`: External signal delivery (Phase 2).
- `axiom.workflow.cancel`: Cancellation request.

### 4.3 Delivery Semantics

| Subject | Delivery | Idempotency |
|---------|----------|-------------|
| `axiom.workflow.execute` | At-least-once | Deduplicated by `run_id` |
| `axiom.step.execute` | At-least-once | Deduplicated by `step_id` + `attempt` |
| `axiom.timer.fire` | At-least-once | Deduplicated by timer ID |
| `axiom.signal.received` | At-least-once | Deduplicated by signal ID |
| `axiom.workflow.cancel` | At-least-once | Idempotent by design |

**No subject claims exactly-once delivery.** All consumers are idempotent.

---

## 5. Storage Assignment

| Data | Backend | Rationale |
|------|---------|-----------|
| Workflow definitions | PostgreSQL | Relational, queryable, transactional |
| Workflow runs | PostgreSQL | Relational, consistent, ACID transactions |
| Event history | PostgreSQL | Ordered, durable, transactional appends |
| Timer state | PostgreSQL | Queryable (poll for due timers) |
| Signal state | PostgreSQL | Queryable, joinable with workflow state |
| Outbox messages | PostgreSQL | Transactional atomic write alongside core state changes |
| API keys, tenants, RBAC | PostgreSQL | Relational, transactional |
| Workflow ownership/leases | PostgreSQL | Atomic UPDATE with monotonic fence token |
| Worker leases/heartbeats | PostgreSQL | Centralized active-worker tracking |
| High-scale coordination | FoundationDB (Phase 4)| Deferred: Low-latency distributed transactions |
| Analytics events | ClickHouse (Phase 3)| Deferred: Optimized for time-series and high write volume |

---

## 6. Worker Execution Model

Workers execute user-defined step functions and workflows via a long-running Node.js sidecar process:

1. **Process Management**: The Rust worker spawns `node` pointing to the compiled worker bundle.
2. **IPC Channel**: Communication takes place over stdin/stdout using line-delimited JSON messages.
3. **Timeouts**: The worker enforces configurable timeouts (`AXIOM_IPC_RESUME_TIMEOUT_MS` default 10s; `AXIOM_IPC_STEP_TIMEOUT_MS` default 30s) on sidecar exchanges.
4. **Failure Recovery**: If a sidecar times out, crashes, or violates determinism, the Rust worker kills and reaps the child process, recording a failed step attempt or failing the workflow run durably.

---

## 7. Deployment Topology

### 7.1 Local Development (Current)

```
docker-compose.yml / Local Processes
├── axiom-api        (Rust, port 8000)
├── axiom-worker     (Rust + Node.js sidecar, hosts scheduler & relayer modules)
├── postgres         (PostgreSQL 16, port 5432)
├── nats             (NATS JetStream, port 4222)
└── dashboard        (Vite dev server or static build)
```

### 7.2 Multi-Node Cluster Topology (Planned)

```
Load Balancer
├── axiom-api (N instances, stateless)
├── axiom-worker (N instances, lease-based work consumption)
├── scheduler service (1-2 instances, leader election via PG advisory locks)
├── postgres (primary + read replica)
├── nats (JetStream cluster)
└── dashboard (CDN / static assets)
```

---

## 8. Architectural Risks & Mitigations

### 8.1 TypeScript Execution in Rust Runtime
- **Risk**: IPC latency, process crashes, and resource exhaustion.
- **Mitigation**: Strict JSON protocol, subprocess supervision with SIGKILL on timeout, bounded memory, and clean process reaping.

### 8.2 Replay Correctness
- **Risk**: Non-deterministic execution or diverging event histories causing data corruption.
- **Mitigation**: Sidecar history validation, strict detection of unknown events, deterministic time (`ctx.now()`) and random (`ctx.random()`) primitives recorded in history.

### 8.3 Concurrency & Split-Brain Execution
- **Risk**: Stale workers continuing to execute steps after lease expiration.
- **Mitigation**: Monotonic fencing tokens (`fence_token`), mandatory worker ownership verification on lease renewal, immediate halt on renewal failure, and conditional SQL writes enforcing fence tokens.

---

## 9. Resolved Architectural Decisions

| # | Decision | Options | Resolution |
|---|----------|---------|------------|
| AD-1 | FoundationDB in Phase 1? | Include / Defer | Defer; PG-only coordination first |
| AD-2 | Worker execution model | Sidecar / Embedded V8 / HTTP protocol | Sidecar with protocol designed for future HTTP |
| AD-3 | Workflow-local state | SQLite / Dist KV | **Dist KV**; direct durable PostgreSQL KV in Phase 1 |
| AD-4 | ClickHouse in Phase 1? | Include / Defer | Defer; structured logs first |
| AD-5 | Workflow definition storage | Registered in PG / Discovered from code | Registered via SDK, stored in PG |
| AD-6 | Scheduler leader election | FoundationDB / PG advisory locks / NATS | **Implemented today**: Distributed `poll_run` with `FOR UPDATE SKIP LOCKED`. **Planned**: PG advisory locks for dedicated scheduler service. |
| AD-7 | Dashboard serving | Separate Vite dev server / Embedded in API | Embedded static in API for prod; Vite dev for development |
| AD-8 | Workflow versioning strategy | Explicit version field / Content hash / Both | Explicit version + compatibility check |
| AD-9 | Authentication model for Phase 1 | API keys only / JWT / Both | API keys + Argon2id admin authentication |
| AD-10 | NATS JetStream vs Core NATS | JetStream (durable) / Core (fire-and-forget) | JetStream for work dispatch; Core for notifications |
