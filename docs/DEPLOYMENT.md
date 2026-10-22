# Deployment Guide

Axiom Engine can be deployed in lightweight containerized environments or large-scale Kubernetes clusters.

## Local Docker Deployment
Use the provided `docker-compose.yml` for testing dependencies. You can build the application images using the Dockerfiles in `infra/docker/`.

```bash
docker build -t axiom-engine-api -f infra/docker/Dockerfile.api .
docker build -t axiom-engine-worker -f infra/docker/Dockerfile.worker .
docker build -t axiom-engine-dashboard -f infra/docker/Dockerfile.dashboard .
```

## Kubernetes Deployment
Axiom Engine is designed for Kubernetes orchestration. Example manifests are available in `infra/k8s/`.

### Secret Configuration
Create a Kubernetes Secret (or use external secret managers like AWS Secrets Manager / Vault) to inject `DATABASE_URL` and `NATS_URL`:
```yaml
apiVersion: v1
kind: Secret
metadata:
  name: axiom-secrets
stringData:
  database-url: "postgres://user:pass@host:5432/db"
  nats-url: "nats://host:4222"
```

### Environment Variables
- `DATABASE_URL`: Standard Postgres connection string.
- `NATS_URL`: JetStream-enabled NATS endpoint.
- `RUST_LOG`: Configures logging output (e.g. `info,axiom_worker=debug`).
- `SIDECAR_PATH`: Path to the compiled TS sidecar executable/script (Worker only).
- `PORT`: HTTP port for the API (default 3000).

### External PostgreSQL/NATS Requirements
- **PostgreSQL**: Version 15+ is recommended. Must be highly available for production setups (e.g., RDS, Cloud SQL). Axiom relies heavily on PostgreSQL transactional guarantees and UNIQUE constraints for fencing.
- **NATS**: Must have JetStream enabled. Used strictly as a wake-up/queue layer. At-least-once delivery is sufficient.

## Dashboard Security Limitation
**Warning:** The Dashboard currently stores API keys in plaintext within the browser's `localStorage`. This is acceptable for restricted VPN environments but susceptible to XSS if exposed publicly. In a public production deployment, it is strongly recommended to host the dashboard behind an explicit authentication proxy (e.g. OAuth2 Proxy or Cloudflare Access) or modify it to use HttpOnly cookies.

## Upgrades and Migrations
Database schema changes are managed via `sqlx`. Run migrations out-of-band using the CLI before rolling out new image versions of the API/Worker.
