# ADR 0002: Semantic Event History vs. Operational State

## Context
The initial event history design mixed semantic events required for deterministic replay (e.g., `StepCompleted`) with operational state tracking (e.g., `StepScheduled`, `ActivityRetryScheduled`). This complicates the replay algorithm, as the TypeScript control flow does not care about transient operational state (like how many times a step retried before succeeding).

## Decision
We separate the durable state into two distinct concepts:
1. **Semantic Event History**: An append-only log of outcomes required for deterministic replay (e.g., `WorkflowStarted`, `StepCompleted`, `TimerFired`). This is the only data sent to the TypeScript sidecar.
2. **Operational State**: Mutable state tracked by the Rust runtime to manage execution (e.g., pending steps, retry counts, active leases).

## Consequences
- The TypeScript SDK's replay algorithm becomes much simpler.
- Retries are handled transparently by the Rust runtime; the workflow code only sees the final success or terminal failure.
- Smaller payloads sent over IPC to the sidecar.
