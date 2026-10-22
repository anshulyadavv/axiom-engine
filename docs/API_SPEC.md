# Axiom Engine — API Specification

## 1. Base URL

```
https://{host}/v1
```

## 2. Authentication

All requests require an API key in the `Authorization` header:

```
Authorization: Bearer axm_live_k7Hj3mNp...
```

Unauthenticated requests receive `401 Unauthorized`.
Requests with insufficient permissions receive `403 Forbidden`.

## 3. Common Headers

### Request Headers

| Header | Required | Description |
|--------|----------|-------------|
| `Authorization` | Yes | `Bearer <api_key>` |
| `Content-Type` | Yes (POST/PUT) | `application/json` |
| `X-Request-Id` | No | Client-supplied request ID (UUID). If absent, server generates one. |
| `X-Idempotency-Key` | No | Idempotency key for POST requests. |

### Response Headers

| Header | Description |
|--------|-------------|
| `X-Request-Id` | Request ID (echoed or generated). |
| `X-RateLimit-Limit` | Rate limit ceiling. |
| `X-RateLimit-Remaining` | Remaining requests in window. |
| `X-RateLimit-Reset` | Window reset time (Unix timestamp). |

## 4. Error Response Schema

All errors use a consistent schema:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable error description.",
    "details": [
      {
        "field": "input.orderId",
        "message": "Required field is missing."
      }
    ],
    "request_id": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

### Error Codes

| HTTP Status | Code | Description |
|------------|------|-------------|
| 400 | `VALIDATION_ERROR` | Request body or parameters are invalid. |
| 400 | `INVALID_INPUT` | Workflow input fails validation. |
| 401 | `UNAUTHORIZED` | Missing or invalid API key. |
| 403 | `FORBIDDEN` | Insufficient permissions. |
| 404 | `NOT_FOUND` | Resource does not exist. |
| 409 | `CONFLICT` | Resource already exists (idempotency key collision with different payload). |
| 422 | `UNPROCESSABLE` | Request is syntactically valid but semantically wrong. |
| 429 | `RATE_LIMITED` | Too many requests. |
| 500 | `INTERNAL_ERROR` | Unexpected server error. No internal details exposed. |
| 503 | `SERVICE_UNAVAILABLE` | Server is temporarily unable to handle the request. |

## 5. Pagination

List endpoints support cursor-based pagination:

```
GET /v1/workflows?limit=20&cursor=eyJpZCI6Ii4uLiJ9
```

Response:

```json
{
  "data": [...],
  "pagination": {
    "cursor": "eyJpZCI6Ii4uLiJ9",
    "has_more": true
  }
}
```

- `limit`: Maximum items per page. Default: 20. Maximum: 100.
- `cursor`: Opaque cursor for the next page. Absent on the first request.

## 6. Endpoints

---

### 6.1 Workflows

#### `POST /v1/workflows`

Register a new workflow definition.

**Permissions**: `workflow:write`

**Request**:
```json
{
  "name": "order-processing",
  "description": "Processes customer orders end-to-end.",
  "version": 1,
  "retry_policy": {
    "max_attempts": 3,
    "initial_delay_ms": 1000,
    "max_delay_ms": 60000,
    "backoff_multiplier": 2.0,
    "jitter": true
  },
  "timeout_ms": 3600000
}
```

**Response** `201 Created`:
```json
{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "order-processing",
    "version": 1,
    "description": "Processes customer orders end-to-end.",
    "status": "active",
    "retry_policy": { ... },
    "timeout_ms": 3600000,
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-01T00:00:00Z"
  }
}
```

---

#### `GET /v1/workflows`

List workflow definitions.

**Permissions**: `workflow:read`

**Query Parameters**:
| Param | Type | Description |
|-------|------|-------------|
| `status` | string | Filter by status (`active`, `paused`, `archived`). |
| `name` | string | Filter by name (exact match). |
| `limit` | integer | Page size (default 20, max 100). |
| `cursor` | string | Pagination cursor. |

**Response** `200 OK`:
```json
{
  "data": [
    {
      "id": "...",
      "name": "order-processing",
      "version": 1,
      "status": "active",
      "created_at": "...",
      "updated_at": "..."
    }
  ],
  "pagination": {
    "cursor": "...",
    "has_more": true
  }
}
```

---

#### `GET /v1/workflows/:id`

Get workflow definition details.

**Permissions**: `workflow:read`

**Response** `200 OK`:
```json
{
  "data": {
    "id": "...",
    "name": "order-processing",
    "version": 1,
    "description": "...",
    "status": "active",
    "retry_policy": { ... },
    "timeout_ms": 3600000,
    "stats": {
      "total_runs": 1524,
      "active_runs": 12,
      "success_rate": 0.973,
      "avg_duration_ms": 45230,
      "p95_duration_ms": 120500
    },
    "created_at": "...",
    "updated_at": "..."
  }
}
```

---

### 6.2 Runs

#### `POST /v1/workflows/:id/runs`

Start a new workflow run.

**Permissions**: `run:write`

**Request**:
```json
{
  "input": {
    "orderId": "order-123"
  },
  "idempotency_key": "order-123-run-1",
  "correlation_id": "request-456"
}
```

**Response** `201 Created`:
```json
{
  "data": {
    "id": "...",
    "workflow_id": "...",
    "workflow_version": 1,
    "status": "pending",
    "input": { "orderId": "order-123" },
    "idempotency_key": "order-123-run-1",
    "correlation_id": "request-456",
    "created_at": "..."
  }
}
```

**Idempotency**: If an `idempotency_key` is provided and a run with the same
key already exists for this tenant:
- If the input matches → return the existing run (`200 OK`).
- If the input differs → return `409 Conflict`.

---

#### `GET /v1/runs/:id`

Get run details.

**Permissions**: `run:read`

**Response** `200 OK`:
```json
{
  "data": {
    "id": "...",
    "workflow_id": "...",
    "workflow_name": "order-processing",
    "workflow_version": 1,
    "status": "running",
    "input": { ... },
    "output": null,
    "error": null,
    "correlation_id": "...",
    "worker_id": "worker-1",
    "attempt_count": 1,
    "steps": [
      {
        "step_id": "fetch-order",
        "status": "completed",
        "attempt": 1,
        "duration_ms": 45,
        "completed_at": "..."
      },
      {
        "step_id": "charge-payment",
        "status": "running",
        "attempt": 1,
        "started_at": "..."
      }
    ],
    "created_at": "...",
    "started_at": "...",
    "completed_at": null
  }
}
```

---

#### `POST /v1/runs/:id/cancel`

Cancel a workflow run.

**Permissions**: `run:cancel`

**Request**:
```json
{
  "reason": "Customer requested cancellation."
}
```

**Response** `200 OK`:
```json
{
  "data": {
    "id": "...",
    "status": "cancelled",
    "cancelled_at": "..."
  }
}
```

**Idempotent**: Cancelling an already-cancelled run returns `200 OK`.
Cancelling a completed or failed run returns `422 Unprocessable` (terminal
state).

---

### 6.3 Signals

#### `POST /v1/runs/:id/signals/:signal`

Send a signal to a workflow run.

**Permissions**: `signal:write`

**Request**:
```json
{
  "payload": {
    "approved_by": "user-123",
    "approved_at": "2024-01-01T12:00:00Z"
  }
}
```

**Response** `202 Accepted`:
```json
{
  "data": {
    "signal_name": "manager-approved",
    "run_id": "...",
    "status": "delivered"
  }
}
```

---

### 6.4 Event History

#### `GET /v1/runs/:id/history`

Get the full event history for a run.

**Permissions**: `run:read`

**Query Parameters**:
| Param | Type | Description |
|-------|------|-------------|
| `limit` | integer | Page size (default 100, max 1000). |
| `cursor` | string | Pagination cursor. |

**Response** `200 OK`:
```json
{
  "data": [
    {
      "id": "...",
      "sequence_number": 1,
      "event_type": "WorkflowStarted",
      "data": { "input": { ... } },
      "timestamp": "..."
    },
    {
      "id": "...",
      "sequence_number": 2,
      "event_type": "StepScheduled",
      "step_id": "fetch-order",
      "data": {},
      "timestamp": "..."
    },
    {
      "id": "...",
      "sequence_number": 3,
      "event_type": "StepCompleted",
      "step_id": "fetch-order",
      "attempt": 1,
      "data": { "output": { ... } },
      "timestamp": "..."
    }
  ],
  "pagination": {
    "cursor": "...",
    "has_more": false
  }
}
```

---

#### `GET /v1/runs/:id/events`

Stream events for a run in real-time via Server-Sent Events.

**Permissions**: `run:read`

**Response**: `200 OK` with `Content-Type: text/event-stream`

```
event: StepCompleted
data: {"sequence_number":3,"step_id":"fetch-order","timestamp":"..."}

event: StepStarted
data: {"sequence_number":4,"step_id":"charge-payment","timestamp":"..."}
```

---

### 6.5 Workers

#### `GET /v1/workers`

List registered workers.

**Permissions**: `admin`

**Response** `200 OK`:
```json
{
  "data": [
    {
      "id": "worker-1",
      "status": "active",
      "last_heartbeat": "...",
      "active_runs": 5,
      "metadata": { ... },
      "registered_at": "..."
    }
  ]
}
```

---

### 6.6 Health

#### `GET /health`

Liveness check. Returns `200 OK` if the process is alive. No authentication
required. Does not check dependencies.

```json
{ "status": "ok" }
```

#### `GET /ready`

Readiness check. Returns `200 OK` if the service can accept traffic (database
connected, NATS connected). No authentication required.

```json
{
  "status": "ready",
  "checks": {
    "postgres": "ok",
    "nats": "ok"
  }
}
```

Returns `503 Service Unavailable` if any critical dependency is unreachable.

---

## 7. WebSocket API

### `WS /v1/ws`

Authenticated WebSocket connection for real-time updates.

**Authentication**: API key as query parameter (`?token=axm_live_...`) or
in the first message.

**Subscription**:
```json
{
  "type": "subscribe",
  "channel": "run",
  "run_id": "..."
}
```

**Events**:
```json
{
  "type": "event",
  "channel": "run",
  "run_id": "...",
  "event": {
    "event_type": "StepCompleted",
    "step_id": "fetch-order",
    "timestamp": "..."
  }
}
```

**Heartbeat**: Server sends `{"type":"ping"}` every 30 seconds. Client must
respond with `{"type":"pong"}`. Connection is closed after 3 missed pongs.

## 8. SDK Client Interface

The TypeScript SDK wraps these APIs:

```typescript
const axiom = new AxiomClient({ apiKey: "axm_live_..." });

// Start a run
const run = await axiom.workflows.run("order-processing", {
  input: { orderId: "order-123" },
  idempotencyKey: "order-123-run-1"
});

// Check run status
const status = await axiom.runs.get(run.id);

// Cancel a run
await axiom.runs.cancel(run.id, { reason: "No longer needed" });

// Send a signal
await axiom.runs.signal(run.id, "manager-approved", {
  payload: { approved_by: "user-123" }
});

// Stream events
const stream = axiom.runs.events(run.id);
for await (const event of stream) {
  console.log(event.event_type, event.step_id);
}
```
