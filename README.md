# Axiom Engine

**Production-grade, self-hostable durable-execution runtime for Workflows-as-Code.**

Axiom allows developers to define long-running asynchronous workflows as normal
TypeScript code — with guarantees of durability across process crashes, machine
failures, network partitions, and infrastructure restarts.

```typescript
import { workflow } from "@axiom-engine/sdk";

export const orderWorkflow = workflow(
  "order-processing",
  async (ctx, input) => {
    const order = await ctx.step.run(
      "fetch-order",
      () => orders.get(input.orderId)
    );

    const payment = await ctx.step.run(
      "charge-payment",
      () => payments.charge(order.total),
      { idempotencyKey: `charge-${ctx.runId}-${order.id}` }
    );

    await ctx.sleep("24h");

    await ctx.step.run(
      "send-confirmation",
      () => email.send(order.email)
    );

    return { orderId: order.id, paymentId: payment.id };
  }
);
```

## What Makes Axiom Different

- **Durable execution**: Completed steps are never re-executed. Workflow state
  survives crashes, restarts, and worker reassignment.
- **Deterministic replay**: Workflow state is reconstructed from append-only
  event history — not mutable checkpoints.
- **Honest failure semantics**: Axiom never claims exactly-once behavior for
  arbitrary external side effects. It provides idempotency keys and explicit
  failure boundaries so you can reason about what happens when things go wrong.
- **Self-hostable**: Run the entire stack on your own infrastructure.
- **Production-grade observability**: Structured tracing, metrics, and a
  purpose-built developer console.

## Architecture

```
TypeScript SDK → Rust API Gateway → Workflow Runtime → Durable History (PostgreSQL)
                                  → Scheduler → NATS → Workers
                                  → FoundationDB (coordination, optional)
                                  → ClickHouse (analytics, optional)
```

## Status

🚀 **Alpha** — Core Runtime, API, Worker, and Dashboard are implemented and functional.

See [docs/](docs/) for specifications and [plans/MASTER_PLAN.md](plans/MASTER_PLAN.md)
for the implementation roadmap.

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

## Documentation

| Document | Description |
|----------|-------------|
| [PRODUCT.md](docs/PRODUCT.md) | Product vision and requirements |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture |
| [EXECUTION_SEMANTICS.md](docs/EXECUTION_SEMANTICS.md) | Durable execution and replay model |
| [DATA_MODEL.md](docs/DATA_MODEL.md) | Data schemas and storage design |
| [FAILURE_MODEL.md](docs/FAILURE_MODEL.md) | Failure taxonomy and recovery |
| [SECURITY.md](docs/SECURITY.md) | Security architecture |
| [API_SPEC.md](docs/API_SPEC.md) | REST API specification |
| [UI_SPEC.md](docs/UI_SPEC.md) | Dashboard and UX specification |
| [MASTER_PLAN.md](plans/MASTER_PLAN.md) | Phased implementation plan |

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Core Runtime | Rust, Tokio, Axum |
| Developer SDK | TypeScript, Node.js |
| Primary Storage | PostgreSQL |
| Coordination | FoundationDB (optional, Phase 4) |
| Workflow-Local State | Distributed KV (Phase 4) |
| Messaging | NATS |
| Analytics | ClickHouse |
| Frontend | TypeScript, React |
| Infrastructure | Docker, Docker Compose |

## License

[MIT](LICENSE)
