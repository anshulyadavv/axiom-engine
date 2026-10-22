# ADR 0001: Explicit TypeScript Execution Boundary

## Context
The initial architecture casually stated that the Rust runtime "executes workflow functions." This blurred the line between orchestration (durable state management) and control flow (user-defined workflow logic).

## Decision
TypeScript owns the workflow control flow. The Rust runtime acts strictly as the durable orchestrator.
- The Rust runtime manages the event history, database transactions, timers, and operational state.
- When a workflow must advance, Rust sends the current event history to the TypeScript sidecar.
- The TypeScript sidecar replays the history, executes the workflow function up to the next blocking operation, and returns a `Command` (e.g., `ScheduleStep`, `Sleep`) to Rust.

## Consequences
- Clean separation of concerns.
- Rust is language-agnostic regarding the workflow control flow.
- The TypeScript sidecar is completely stateless between executions.
