# Axiom Engine — Product Specification

🚀 **Status: Alpha**

## Current Capability Status

The following capability matrix documents the implementation status of all engine features based on the active codebase.

| Capability | Status | Code Verification / Citation |
|---|---|---|
| **Workflows-as-Code** | Implemented | `workflow()` helper in `packages/sdk/src/types.ts:45`, verified in `packages/sdk/tests/doc_examples.test.ts:7`. |
| **Durable Step Execution** | Implemented | `ctx.step.run()` in `packages/sdk/src/engine.ts:128`, fenced event storage in `crates/axiom-storage/src/pg/events.rs:60`, verified in `crates/axiom-worker/tests/nats_dispatch.rs:350`. |
| **Deterministic Replay** | Implemented | Sidecar history replay in `packages/sdk/src/engine.ts:91`, recorded time/random replay in `crates/axiom-worker/tests/integration.rs:30`. |
| **Workflow-Local State** | Implemented | `ctx.state.get/set/delete` in `packages/sdk/src/engine.ts:35`, PostgreSQL KV store in `crates/axiom-storage/src/pg/state.rs:10`, verified in `packages/sdk/tests/doc_examples.test.ts:175`. |
| **Child Workflows** | Implemented | `ctx.child.run()` in `packages/sdk/src/engine.ts:167`, verified in `packages/sdk/tests/doc_examples.test.ts:150`. |
| **Workflow Cancellation** | Implemented | API endpoint `crates/axiom-api/src/handlers/runs.rs:90`, cancellation handling in `crates/axiom-storage/src/pg/run.rs:200`. |
| **Multi-Tenancy & Auth** | Implemented | Argon2id auth & API keys in `crates/axiom-api/src/auth.rs:30`, verified in `crates/axiom-api/tests/auth_and_cache_tests.rs:10`. |
| **Worker Lease Fencing** | Implemented | `poll_run` with `FOR UPDATE SKIP LOCKED` and monotonic `fence_token` in `crates/axiom-storage/src/pg/run.rs:250`, verified in `crates/axiom-worker/tests/nats_dispatch.rs:500`. |
| **Developer Console** | Implemented | React dashboard in `packages/dashboard/src/App.tsx`, static asset hosting in `crates/axiom-api/src/server.rs`. |
| **Step Retries & Backoff** | Planned (Phase 2) | Schema fields exist in PostgreSQL (`crates/axiom-storage/src/pg/step.rs:86`), but automatic engine-level retry policies, exponential backoff, and retry scheduling loops are Planned (Phase 2); `retry_flow` demonstrates application-level try/catch in user code. |
| **Durable Timers / Sleep** | Planned (Phase 2) | Schema defined in `migrations/20240101000000_initial_schema.sql:184`, but no runtime queries exist; `ctx.sleep()` throws `"Not implemented in Phase 1"` in `packages/sdk/src/engine.ts:213`. |
| **External Signals** | Planned (Phase 2) | Schema defined in `migrations/20240101000000_initial_schema.sql:202`, but no runtime queries exist; `ctx.waitForSignal()` throws `"Not implemented in Phase 1"` in `packages/sdk/src/engine.ts:218`. |
| **Analytics (ClickHouse)** | Planned (Phase 3) | Documented in `docs/ARCHITECTURE.md:176`; no ClickHouse client code exists in `crates/`. |
| **Coordination (FoundationDB)** | Planned (Phase 4) | Documented in `docs/ARCHITECTURE.md:178`; no FoundationDB client code exists in `crates/`. |

---

## 1. Vision

Axiom Engine is a **self-hostable durable-execution runtime** that allows developers to define long-running asynchronous workflows as normal TypeScript code.

The core promise: **your workflow code runs to completion, even when infrastructure fails.**

Axiom is not a job queue, not a state machine DSL, and not a workflow YAML engine. It is a **runtime** that executes imperative code durably — surviving crashes, restarts, and worker reassignment — by recording the results of each logical step in an append-only event history and replaying that history to reconstruct workflow state.

## 2. Target Users

- **Backend engineers** building business-critical multi-step processes (payments, order fulfillment, provisioning, onboarding, ETL).
- **Platform teams** who need a self-hosted workflow engine that integrates with existing infrastructure.
- **Developers** who want the reliability of a durable execution engine without learning a proprietary DSL.

## 3. Core Capabilities

### 3.1 Workflows-as-Code

Workflows are defined as async TypeScript functions. No YAML, no drag-and-drop UI, no state machine DSL. The developer writes normal code with explicit step boundaries.

### 3.2 Durable Execution

Each `ctx.step.run(...)` call is a **durability boundary**. The runtime records the result of each step. On recovery, completed steps return their recorded results without re-execution. The workflow resumes from the point of failure.

### 3.3 Deterministic Replay

Workflow state is reconstructed by replaying the event history from the beginning. The workflow function executes again, but each step that has a recorded result returns that result immediately. This means workflow code must be deterministic — no `Date.now()`, no `Math.random()`, no uncontrolled nondeterminism inside workflow logic. Deterministic runtime equivalents (`ctx.now()`, `ctx.random()`) are provided.

### 3.4 Timers

> [!NOTE]
> **Status: Planned (Phase 2)**

In Phase 2, `ctx.sleep(duration)` will persist a timer in the operational database and unload the workflow. When the timer fires, the scheduler will rehydrate and replay the workflow to the correct resumption point without keeping an idle worker process alive.
*(In Phase 1, `ctx.sleep()` is a stub that throws `"Not implemented in Phase 1"`).*

### 3.5 Signals

> [!NOTE]
> **Status: Planned (Phase 2)**

In Phase 2, `ctx.waitForSignal(name)` will allow a workflow to pause until an external event arrives via the API. Signals will be durably recorded in the database, allowing the workflow to be unloaded during the wait.
*(In Phase 1, `ctx.waitForSignal()` is a stub that throws `"Not implemented in Phase 1"`).*

### 3.6 Retries

> [!NOTE]
> **Status: Planned (Phase 2)**

In Phase 2, the engine will support configurable retry policies (max attempts, exponential backoff, jitter, and error classification). In Phase 1, automatic engine retries and backoff calculation are not implemented; users can perform application-level try/catch looping. The complete Phase 2 design is documented in [`docs/RESEARCH.md`](RESEARCH.md#7-step-retry-policies-exponential-backoff--jitter-phase-2-design).

### 3.7 Cancellation

Workflows can be cancelled. Cancellation semantics are explicit for each workflow state (queued, running, sleeping, waiting, retrying). Cancellation is idempotent. The runtime does not pretend it can stop an already-executing external side effect.

### 3.8 Child Workflows

A workflow can start child workflows via `ctx.child.run(...)`. Child workflow completion/failure is recorded in the parent's event history, and the parent suspends until the child finishes.

### 3.9 Idempotency

Every step execution carries an operation ID / idempotency key. External APIs that support idempotency can achieve effectively-once behavior. Axiom never claims exactly-once for arbitrary external systems.

### 3.10 Multi-Tenancy

Tenant isolation is enforced from the ground up. Every resource has an explicit ownership boundary. Cross-tenant access is impossible through normal API paths.

### 3.11 Observability

Structured logs, distributed traces, and metrics are first-class. A built-in developer console provides workflow inspection, execution timelines, step detail, and real-time updates.

### 3.12 Self-Hostable

The entire stack runs on customer infrastructure. Docker Compose for local development; Kubernetes-ready for production.

## 4. Non-Goals (Phase 1)

- Graphical workflow builder / drag-and-drop UI.
- Multi-language SDK (Python, Go, Java). TypeScript only for Phase 1.
- Managed cloud offering.
- Distributed saga orchestration as a first-class abstraction (users can build sagas from primitives).
- CQRS / event sourcing as a user-facing pattern (the runtime uses event sourcing internally, but does not expose it as a user-facing abstraction).

## 5. Success Criteria

1. A developer can define, deploy, and run a multi-step workflow from the TypeScript SDK.
2. Workflow execution survives process crash and worker restart without re-executing completed steps.
3. Durable execution is verified across worker restarts.
4. The developer console shows real-time workflow status, execution timeline, and step detail.
5. Failure behavior is documented and tested for all scenarios in the failure model.
6. The system can be deployed locally with `docker-compose up`.

## 6. Competitive Context

Axiom occupies the same conceptual space as:

- **Temporal** — Durable execution, deterministic replay, Workflows-as-Code.
- **Inngest** — Event-driven step functions with durable execution.
- **Restate** — Durable execution with a focus on distributed transactions.
- **Hatchet** — Durable execution with a focus on developer experience.

Axiom differentiates through:

- **Honest failure semantics**: Never claims exactly-once for external effects.
- **Self-hostable from day one**: No managed-only tier.
- **Rust runtime**: Performance and memory safety without GC pauses.
- **Multi-backend persistence**: PostgreSQL (implemented), FoundationDB (planned, Phase 4), Distributed KV (planned, Phase 4), each used for its strengths.
- **Analytics**: ClickHouse (planned, Phase 3) for high-scale analytical queries.
- **Research-backed**: Explicit measurement and comparison of execution strategies.
