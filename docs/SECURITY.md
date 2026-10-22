# Axiom Engine — Security Architecture

## 1. Threat Model

Axiom is self-hosted infrastructure software that manages business-critical
workflow execution. The threat model assumes:

- **External attackers** may attempt to access the API from the public internet
  or a compromised network.
- **Malicious tenants** may attempt to access other tenants' data.
- **Malicious workflow code** may attempt to escape its execution sandbox.
- **Compromised workers** may attempt to interfere with other workflows.
- **Internal operators** should have auditable, least-privilege access.

## 2. Authentication

### 2.1 API Key Authentication (Phase 1)

All API access requires a valid API key.

**Key Format**: `axm_<environment>_<random_bytes_base62>`

Example: `axm_live_k7Hj3mNpQrStUvWx...`

**Key Storage**:
- Keys are hashed with Argon2id before storage.
- Only the first 8 characters (prefix) are stored in plaintext for lookup.
- The full key is shown exactly once at creation time.
- Keys cannot be retrieved after creation; they can only be rotated.

**Key Lookup Flow**:
1. Extract prefix from presented key.
2. Query `api_keys` table by prefix (indexed).
3. Verify full key hash with Argon2id.
4. Check key status (active, not expired).
5. Load associated tenant and permissions.

**Key Rotation**:
- Create new key → update integrations → revoke old key.
- Revoked keys immediately stop working.
- No grace period (explicit revocation is intentional).

### 2.2 JWT Authentication (Deferred)

JWT-based authentication for the dashboard and user-facing flows will be
added after Phase 1. This requires:
- Identity provider integration (or built-in auth).
- Token issuance and refresh.
- Session management.

## 3. Authorization

### 3.1 Tenant Isolation

Every API request is scoped to a tenant. The tenant is determined by the
authenticated API key, never by a client-supplied header or parameter.

**Invariant**: A tenant's API key can never access another tenant's resources.

This is enforced at the storage layer: every query includes a `tenant_id`
filter derived from the authenticated context, not from the request body.

### 3.2 Permission Model (Phase 1)

Phase 1 uses a simple permission model:

| Permission | Description |
|-----------|-------------|
| `workflow:read` | List and inspect workflows |
| `workflow:write` | Create and update workflow definitions |
| `run:read` | List and inspect runs |
| `run:write` | Start runs |
| `run:cancel` | Cancel runs |
| `signal:write` | Send signals |
| `admin` | Full access including key management |

API keys are assigned a set of permissions at creation.

### 3.3 RBAC (Deferred)

Role-Based Access Control with named roles, role hierarchy, and user
assignment is deferred to post-Phase 1.

## 4. Input Validation

### 4.1 Request Validation

All incoming requests are validated:
- JSON schema validation for request bodies.
- UUID format validation for IDs.
- String length limits.
- Numeric range validation.
- Enum validation for status fields.

Invalid requests receive `400 Bad Request` with a structured error response.

### 4.2 SQL Injection Prevention

- All database queries use parameterized queries (via sqlx).
- No string concatenation for SQL construction.
- This is enforced by using sqlx's compile-time query checking where possible.

### 4.3 Workflow Input Validation

User-supplied workflow inputs are:
- Size-limited (configurable, default 1MB).
- Validated as valid JSON.
- Stored as-is (JSONB).

The workflow function is responsible for semantic validation of its input.

## 5. Rate Limiting

### 5.1 API Rate Limits

| Endpoint Pattern | Default Limit |
|-----------------|--------------|
| `POST /v1/workflows` | 100/min per tenant |
| `POST /v1/workflows/:id/runs` | 1000/min per tenant |
| `POST /v1/runs/:id/signals/:signal` | 500/min per tenant |
| `GET *` | 5000/min per tenant |

Rate limits are enforced per-tenant, not per-key. Multiple keys for the
same tenant share the limit.

Rate limits can be adjusted or disabled via environment variables:
- `AXIOM_RATE_LIMIT_RUNS_PER_MIN`: Overrides the default ceiling for run creation (`POST /v1/workflows/:id/runs`, default: `1000`). Setting to `0` disables throttling on this route.
- `AXIOM_RATE_LIMIT_WORKFLOWS_PER_MIN`: Overrides the default ceiling for workflow registration (`POST /v1/workflows`, default: `100`). Setting to `0` disables throttling on this route.
- `AXIOM_RATE_LIMIT_DISABLED`: When set to `1` or `true`, disables all rate limiting (e.g. for high-throughput load and stress benchmarking).

### 5.2 Implementation

Rate limiting uses an in-memory token bucket per tenant (`RateLimiter`) with token refill (with optional
Redis backing planned for multi-instance deployments). Rate limit state is
best-effort — it is acceptable for a brief burst to exceed the limit during
a race condition.

Rate limit responses include:
- `429 Too Many Requests`
- `Retry-After` header
- `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` headers

## 6. Network Security

### 6.1 CORS

CORS is configured to allow only the dashboard origin by default. Additional
origins can be configured via environment variables.

```
AXIOM_CORS_ORIGINS=https://dashboard.example.com
```

### 6.2 Secure Headers

All responses include:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 0` (modern browsers; CSP is preferred)
- `Content-Security-Policy: default-src 'self'`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains` (when TLS)

### 6.3 TLS

Axiom does not terminate TLS directly. It is expected to run behind a
reverse proxy (nginx, Caddy, cloud load balancer) that handles TLS
termination.

The API gateway trusts `X-Forwarded-For` and `X-Real-IP` headers only when
explicitly configured to do so.

## 7. Secrets Management

### 7.1 Environment Variables

Secrets are provided via environment variables:
- `DATABASE_URL`
- `NATS_URL`
- `CLICKHOUSE_URL`
- `AXIOM_ENCRYPTION_KEY` (for encrypting sensitive workflow data at rest)

### 7.2 Secret Redaction

The logging system automatically redacts:
- API keys (replaced with `axm_****`)
- Authorization headers
- Database connection strings (password component)
- Any field matching configurable redaction patterns

### 7.3 What Is Never Logged

- Full API keys
- Passwords
- Tokens
- Secrets
- Full authorization headers
- Database passwords
- Encryption keys

## 8. Audit Logging

All mutating operations are recorded in the audit log:

- API key creation/revocation
- Workflow creation/update
- Run start/cancel
- Signal delivery
- Configuration changes

Audit log entries include:
- Actor (API key or user)
- Action
- Resource
- Timestamp
- IP address
- Request ID

Audit logs are append-only. They are never modified or deleted except by
explicit retention policy.

## 9. Workflow Code Execution Security

### 9.1 Sandbox Boundary

Workflow code runs in a Node.js process (sidecar). This process:
- Has no access to the Axiom runtime's memory or state.
- Communicates with the runtime only through a defined protocol.
- Can be resource-limited (CPU, memory) via container/cgroup controls.

### 9.2 Limitations (Phase 1)

Phase 1 does not implement fine-grained sandboxing of workflow code. The
workflow code has full Node.js capabilities. Security relies on:
- Tenant isolation (each tenant's code runs in separate processes).
- Container-level resource limits.
- Network policies (restrict outbound access if needed).

### 9.3 Future Considerations

- V8 isolate sandboxing for multi-tenant code execution.
- Network egress filtering per workflow.
- Secret injection via runtime APIs (not environment variables).

## 10. Data Encryption

### 10.1 At Rest

- PostgreSQL: Encryption at rest is delegated to the PostgreSQL deployment
  (transparent data encryption or disk encryption).
- Distributed KV (Phase 4): Workflow-local state is stored in PostgreSQL or
  FoundationDB. Encryption follows the backing store's encryption model.
- ClickHouse: Not encrypted (analytics data is non-sensitive).

### 10.2 In Transit

- API ↔ Client: TLS (via reverse proxy).
- API ↔ PostgreSQL: TLS (configured in connection string).
- API ↔ NATS: TLS (configured in NATS client).
- Internal service communication: TLS when deployed across network boundaries.

### 10.3 Sensitive Workflow Data

Workflow inputs and step outputs may contain sensitive data. An optional
encryption layer can encrypt specific fields at the application level using
`AXIOM_ENCRYPTION_KEY`. This is opt-in and documented for users who need it.

## 11. SSRF Protection

The API gateway does not make outbound HTTP requests based on user-supplied
URLs. Workflow code (running in the sidecar) may make arbitrary outbound
requests — this is by design, as workflows need to call external APIs.

SSRF protection for the gateway itself:
- No URL-based redirects from user input.
- No user-supplied URLs used in server-side requests.
- Webhook URLs (if added later) must be validated and allow-listed.

## 12. Security Testing

### 12.1 Required Tests

- Cross-tenant data access attempts (must all fail).
- Invalid API key rejection.
- Expired API key rejection.
- Revoked API key rejection.
- SQL injection attempts on all input fields.
- Rate limit enforcement.
- Missing authentication rejection.
- Invalid permission rejection.
- Oversized request body rejection.
- Malformed JSON rejection.

### 12.2 Penetration Testing (Future)

Formal penetration testing is recommended before any public deployment.
This is out of scope for Phase 1 but should be planned.
