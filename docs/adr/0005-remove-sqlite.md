# ADR 0005: Remove SQLite, Prefer Distributed KV

## Context
The initial architecture proposed using worker-local SQLite databases for workflow-local state. However, because workflow runs can be reassigned to different workers upon crash or lease expiration, a strictly worker-local SQLite file creates a data availability problem. Reassigning a workflow would mean losing its local state or requiring complex state-shipping mechanisms between workers.

## Decision
Remove SQLite from the Phase 1 architecture completely. 
For Phase 4 (Advanced Features), introduce a worker-independent durable KV strategy (e.g., backed by PostgreSQL or FoundationDB) instead of local SQLite.

## Consequences
- Simplifies Phase 1 deployment and worker statelessness.
- Ensures that workflow state is always highly available and survives worker reassignment.
- Reduces the number of moving parts in the persistence layer.
