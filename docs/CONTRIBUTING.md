# Contributing Guide

## Repository Structure
- `/crates`: Core Rust workspace (API, Storage, Core models, Worker, CLI)
- `/packages`: Node/TypeScript workspace (SDK, Dashboard)
- `/infra`: Deployment files (Docker, Kubernetes)
- `/docs`: Architecture and specifications
- `/plans`: Implementation checklists and roadmaps

## Build Commands
Run Rust checks:
```sh
cargo check --workspace
cargo build --release
```

Run TypeScript builds:
```sh
pnpm install
pnpm run build
```

## Coding Conventions
- **Rust**: Use standard `cargo fmt` and `clippy`. Explicitly trace/log distributed events. Prefer strong static typing for Database queries via `sqlx`.
- **TypeScript**: Use strict mode. Do not introduce large UI libraries without prior architectural approval.

## Migration Conventions
If adding columns or tables:
1. Write raw SQL migrations in `crates/axiom-storage/migrations`.
2. Do not break backwards compatibility. We require zero-downtime rolling deploys. Avoid dropping columns until subsequent major versions.

## How to Update Documentation
Always ensure `docs/` stays up-to-date with any structural or semantic changes. Do not document planned features as if they are completed. If something is a future goal, add it to `docs/RESEARCH.md`.

## Manual Validation Workflow
Axiom Engine uses a manual validation strategy for chaos and concurrency testing. See `MANUAL_TEST_PLAN.md`. Use `scripts/chaos.ps1` to test your changes under adversarial conditions locally before requesting a review.
