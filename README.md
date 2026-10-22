# Axiom Engine

**Self-hostable durable-execution runtime for Workflows-as-Code.**

Axiom allows developers to define long-running asynchronous workflows as normal
TypeScript code — with durability across process crashes, machine failures,
and worker restarts.

```typescript
import { workflow } from "@axiom/sdk";

export const orderWorkflow = workflow(
  "order-processing",
  1,
  async (ctx, input: { orderId: string; total: number; email: string }) => {
    const order = await ctx.step.run(
      "fetch-order",
      async () => ({ id: input.orderId, total: input.total, email: input.email })
    );

    const payment = await ctx.step.run(
      "charge-payment",
      async () => ({ transactionId: "txn_123", status: "succeeded" }),
      { idempotencyKey: `charge-${order.id}` }
    );

    await ctx.state.set("order-status", "payment-verified");

    await ctx.step.run(
      "send-confirmation",
      async () => ({ sent: true, recipient: order.email })
    );

    return { orderId: order.id, paymentId: payment.transactionId };
  }
);
```

## Status

🚀 **Alpha** — Core durable-execution runtime is implemented and functional.

### Scope: Implemented vs Not Implemented

- **Implemented**:
  - Workflows-as-Code in TypeScript (`workflow()` definition helper in `packages/sdk/src/types.ts`)
  - Durable step execution (`ctx.step.run()`) with transactional event history recording
  - Deterministic replay from append-only PostgreSQL event log
  - Worker lease fencing (`poll_run` with `FOR UPDATE SKIP LOCKED` and monotonic `fence_token`)
  - Crash recovery across worker restarts without re-executing completed steps (`crates/axiom-worker/tests/crash_recovery.rs`)
  - Transactional outbox relay to NATS JetStream for reliable worker dispatch
  - Workflow-local durable state (`ctx.state.get/set/delete`)
  - Child workflows (`ctx.child.run()`) with parent suspension and resumption
  - Run management API (create, inspect, cancel) and CLI (`axiom-cli`)

- **Not Implemented**:
  - **Timers** (`ctx.sleep`): Planned (Phase 2). Schema exists; runtime polling and worker rehydration are not implemented (SDK stub throws).
  - **Signals** (`ctx.waitForSignal`): Planned (Phase 2). Schema exists; inbound delivery API and workflow wake-up are not implemented (SDK stub throws).
  - **Retries & Backoff**: Planned (Phase 2). Schema fields exist; automatic backoff calculation and scheduler retry loops are not implemented.
  - **Cancellation Propagation**: Planned (Phase 2). Storage status transitions to `Cancelled`, but cancellation is not propagated to running sidecars or child workflows.
  - **FoundationDB**: Planned (Phase 4). High-throughput coordination layer is not implemented (PostgreSQL handles all leases).
  - **ClickHouse**: Planned (Phase 3). High-scale analytical query store is not implemented (PostgreSQL and structured logs handle queries).

### Capability Status

The following matrix documents the implementation status of all engine capabilities based on the active codebase:

| Capability | Status | Code Verification / Citation |
|---|---|---|
| **Workflows-as-Code** | Implemented | `workflow()` helper in `packages/sdk/src/types.ts:45`, verified in `packages/sdk/tests/doc_examples.test.ts:7`. |
| **Durable Step Execution** | Implemented | `ctx.step.run()` in `packages/sdk/src/engine.ts:128`, fenced event storage in `crates/axiom-storage/src/pg/events.rs:60`, verified in `crates/axiom-worker/tests/nats_dispatch.rs:350`. |
| **Deterministic Replay** | Implemented | Sidecar history replay in `packages/sdk/src/engine.ts:91`, recorded time/random replay in `crates/axiom-worker/tests/integration.rs:30`. |
| **Worker Lease Fencing & Crash Recovery** | Implemented | `poll_run` with `FOR UPDATE SKIP LOCKED` and monotonic `fence_token` in `crates/axiom-storage/src/pg/run.rs:250`, verified in `crates/axiom-worker/tests/crash_recovery.rs:18`. |
| **Workflow-Local State** | Implemented | `ctx.state.get/set/delete` in `packages/sdk/src/engine.ts:35`, PostgreSQL KV store in `crates/axiom-storage/src/pg/state.rs:10`, verified in `packages/sdk/tests/doc_examples.test.ts:175`. |
| **Child Workflows** | Implemented | `ctx.child.run()` in `packages/sdk/src/engine.ts:167`, verified in `packages/sdk/tests/doc_examples.test.ts:150`. |
| **Workflow Cancellation** | Implemented | API endpoint `crates/axiom-api/src/handlers/runs.rs:90`, cancellation handling in `crates/axiom-storage/src/pg/run.rs:200`. |
| **Cancellation Propagation** | Planned (Phase 2) | Run cancellation updates DB status to `Cancelled`; signaling executing sidecars and cascading to active child runs is Planned (Phase 2). |
| **Step Retries & Backoff** | Planned (Phase 2) | Schema fields exist in PostgreSQL (`crates/axiom-storage/src/pg/step.rs:86`), but automatic engine-level retry policies, exponential backoff, and retry scheduling loops are Planned (Phase 2); `retry_flow` demonstrates application-level try/catch in user code. |
| **Durable Timers / Sleep** | Planned (Phase 2) | Schema defined in `crates/axiom-storage/migrations/20240101000000_initial_schema.sql:184`, but no runtime queries exist; `ctx.sleep()` throws `"Not implemented in Phase 1"` in `packages/sdk/src/engine.ts:213`. |
| **External Signals** | Planned (Phase 2) | Schema defined in `crates/axiom-storage/migrations/20240101000000_initial_schema.sql:202`, but no runtime queries exist; `ctx.waitForSignal()` throws `"Not implemented in Phase 1"` in `packages/sdk/src/engine.ts:218`. |
| **Analytics (ClickHouse)** | Planned (Phase 3) | Documented in `docs/ARCHITECTURE.md:176`; no ClickHouse client code exists in `crates/`. |
| **Coordination (FoundationDB)** | Planned (Phase 4) | Documented in `docs/ARCHITECTURE.md:178`; no FoundationDB client code exists in `crates/`. |

See [docs/](docs/) for specifications and [plans/MASTER_PLAN.md](plans/MASTER_PLAN.md) for the implementation roadmap.

## What Makes Axiom Different

- **Durable execution**: Completed steps are never re-executed. Workflow state
  survives crashes, restarts, and worker reassignment.
- **Deterministic replay**: Workflow state is reconstructed from append-only
  event history — not mutable checkpoints.
- **Honest failure semantics**: Axiom never claims exactly-once behavior for
  arbitrary external side effects. It provides idempotency keys and explicit
  failure boundaries so you can reason about what happens when things go wrong.
- **Self-hostable**: Run the entire stack on your own infrastructure.
- **Observability**: Structured tracing, metrics, and a purpose-built developer console.

## Architecture

```
TypeScript SDK → Rust API Gateway → Worker Runtime → Durable History (PostgreSQL)
                                  → Embedded Scheduler → NATS → Workers
                                  → FoundationDB (coordination, planned Phase 4)
                                  → ClickHouse (analytics, planned Phase 3)
```

## Command Line Interface (CLI)

Axiom Engine provides a CLI for managing workflows and runs. 

### Installation

Build the CLI from source:
```bash
cargo build --release -p axiom-cli
```

### Configuration

Set the required environment variables:
- `AXIOM_API_URL`: The URL to your Axiom API Gateway (default: `http://localhost:8000`)
- `AXIOM_API_KEY`: Your authenticated Tenant API Key (required)

### Commands

**List workflows:**
```bash
axiom workflow list [--name <optional-filter>]
```

**Run a workflow:**
*Note: A strict workflow version binding is required.*
```bash
axiom workflow run <workflow-name> --version <version-number> [--input '{"key": "value"}']
```

**Inspect a workflow:**
```bash
axiom workflow inspect <workflow-name>
```

**Inspect a run:**
```bash
axiom run inspect <run-id>
```

**Cancel a run:**
```bash
axiom run cancel <run-id>
```

**Machine-readable output (JSON):**
Pass the `--json` flag to output pure JSON data suitable for jq or scripts:
```bash
axiom --json run inspect <run-id>
```

## Out of Core Scope / Experimental

The following auxiliary features are provided for developer evaluation, experimentation, and operations, but are secondary to the core durable-execution engine:

- **Authentication & Multi-Tenancy**: Tenant-scoped API keys (`crates/axiom-api/src/auth.rs`), Argon2id password hashing, and role hierarchies (`Admin`, `Operator`, `Viewer`). Core durable execution does not depend on auth in single-tenant or local deployments.
- **Redis Operational Cache**: Optional caching layer (`crates/axiom-api/src/cache.rs`) for telemetry acceleration with fail-soft bypass to PostgreSQL when Redis is unavailable.
- **AI Incident Triage**: Prototype agent workflow (`incident_triage_agent` in `packages/sdk/src/app.ts`) demonstrating multi-step operational diagnosis and structured remediation reports.
- **Developer Console**: React-based dashboard (`packages/dashboard/`) for inspecting workflows, runs, execution graphs, and real-time SSE telemetry feeds.

## Documentation

| Document | Description |
|----------|-------------|
| [PRODUCT.md](docs/PRODUCT.md) | Product vision, capabilities, and status matrix |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture |
| [EXECUTION_SEMANTICS.md](docs/EXECUTION_SEMANTICS.md) | Durable execution and replay model |
| [DATA_MODEL.md](docs/DATA_MODEL.md) | Data schemas and storage design |
| [FAILURE_MODEL.md](docs/FAILURE_MODEL.md) | Failure taxonomy and recovery |
| [SECURITY.md](docs/SECURITY.md) | Security architecture |
| [API_SPEC.md](docs/API_SPEC.md) | REST API specification |
| [RESEARCH.md](docs/RESEARCH.md) | Empirical performance benchmarks and architectural measurements |
| [MASTER_PLAN.md](plans/MASTER_PLAN.md) | Phased implementation plan |

## Benchmarks

Empirical measurements are documented in [docs/RESEARCH.md](docs/RESEARCH.md):
- **Run-creation requests accepted per second (API only)**: `100.02 req/sec` median across 3 trials with rate limiter disabled (`AXIOM_RATE_LIMIT_DISABLED=1`, min: 80.26, max: 103.23 req/sec, 0 errors at concurrency 20, 1,000 requests). With the default limiter (1,000/min per tenant, token bucket with burst), throughput is `34.60 req/sec` median (min: 15.28, max: 70.16 req/sec; 429 errors: min 0, median 616, max 808) because the default limiter throttles sustained load above ~16.7 req/s (measures REST API request acceptance only and does not measure workflow execution or completion).
- **End-to-end workflow completion throughput**: `0.38 completed runs/sec` median across 5 trials (min: 0.34, max: 0.45 runs/sec; single worker, 2000 ms scheduler idle poll interval, 3-step sequential workflow; measures wall-clock duration until all runs reach `Completed`).

## Technology Stack

| Layer | Technology | Status |
|-------|-----------|--------|
| Core Runtime | Rust, Tokio, Axum | Implemented |
| Developer SDK | TypeScript, Node.js | Implemented |
| Primary Storage | PostgreSQL | Implemented |
| Coordination | FoundationDB | **Planned (Phase 4)** |
| Workflow-Local State | PostgreSQL KV (Dist KV planned) | Implemented (Phase 1) |
| Messaging | NATS JetStream | Implemented |
| Analytics | ClickHouse | **Planned (Phase 3)** |
| Frontend (Dashboard) | TypeScript, React | Implemented (Auxiliary) |
| Infrastructure | Docker, Docker Compose | Implemented |

## License

[MIT](LICENSE)
