# Getting Started with Axiom Engine

## Prerequisites
- Rust 1.75+
- Node.js 20+
- pnpm
- Docker and docker-compose
- PostgreSQL 15+ (can use Docker)
- NATS 2.10+ (can use Docker)

## Local Setup
1. Clone the repository.
2. Install dependencies:
   ```sh
   pnpm install
   ```
3. Build the dashboard and SDK:
   ```sh
   pnpm run build
   ```

## Environment Configuration
The core backend uses PostgreSQL and NATS. Start them locally via Docker:
```sh
docker compose -f infra/docker/docker-compose.yml up -d
```

## Database Migrations
Export the local database URL and run sqlx migrations:
```sh
$env:DATABASE_URL="postgres://axiom:password@localhost:5432/axiom_engine"
cargo sqlx migrate run --source crates/axiom-storage/migrations
```

## Starting Services
Start the API:
```sh
cargo run --bin axiom-api
```

Start the Worker:
```sh
cargo run --bin axiom-worker
```

Start the Dashboard (Development):
```sh
cd packages/dashboard && pnpm run dev
```

## Registering and Running a Sample Workflow
Create a tenant API key via the dashboard at `http://localhost:3000` (or `http://localhost:5173` for dev dashboard) in the Settings tab.

Use the `axiom-cli` or `curl` to register and trigger a run:
```bash
# Wait for the worker and API to be running
curl -X POST http://localhost:3000/v1/workflows/test_workflow/runs \
    -H "Authorization: Bearer <YOUR_API_KEY>" \
    -H "Content-Type: application/json" \
    -d '{}'
```
