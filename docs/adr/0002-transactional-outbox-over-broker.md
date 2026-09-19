# ADR 0002 — Transactional outbox on Postgres instead of a message broker

Date: 2026-09-19 · Status: accepted

## Context

The engine needs durable, at-least-once, replayable events between modules and to external
systems, at a volume of a few hundred bookings per month.

## Decision

Every state change writes its event to `outbox_messages` in the same transaction. A worker
claims due rows with `SELECT … FOR UPDATE SKIP LOCKED`, dispatches to idempotent handlers,
retries with exponential backoff, and dead-letters after `max_attempts`; operators re-arm dead
rows through an audited admin endpoint. Inbound webhooks land in `inbox_messages` first.

Two unique keys per event: `event_id` (per emission) and `dedupe_key` (per business fact).

## Consequences

- No Kafka/RabbitMQ/Redis to operate. Multiple worker replicas are safe.
- If a second consumer system or ordered partitions are ever needed, the envelope is already
  broker-shaped; the outbox becomes the producer and a broker the transport.
