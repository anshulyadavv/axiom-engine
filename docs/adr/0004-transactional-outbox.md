# ADR 0004: PostgreSQL Transactional Outbox for NATS

## Context
The architecture requires components to update PostgreSQL state and publish messages to NATS. Writing to both sequentially introduces a dual-write problem: if the database commits but the NATS publish fails (or vice versa), the system is left in an inconsistent state.

## Decision
Use the Transactional Outbox pattern:
- All database transactions that require publishing a NATS message will simultaneously insert the message payload into an `outbox_messages` table within the same transaction.
- A background Relayer process polls/listens to the `outbox_messages` table and reliably publishes the messages to NATS.
- Once NATS acknowledges receipt, the message is marked as published or deleted from the outbox.

## Consequences
- Guarantees at-least-once delivery of internal messages without distributed transactions.
- slightly increased latency for message dispatch (bound by the outbox polling/listening interval).
