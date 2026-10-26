# ADR 0002: Idempotency and Transactional Outbox for External Payment Rails

## Status
Accepted

## Context
When interacting with third-party payment rails (such as PayPal Payouts and webhook endpoints), transient network partitions, timeouts, and concurrent delivery can cause duplicate payments or split-brain ledger states.

## Options Considered
1. **Direct Synchronous API Calls in HTTP Request Handlers:** Call PayPal directly inside the release route handler.
   - *Rejected:* If PayPal hangs, the web client times out, leading to unknown disbursement status and double-spend on retry.
2. **Distributed Saga Coordinator with Redis Locks:** Use a distributed transaction manager.
   - *Rejected:* Adds operational complexity, Redis failure modes, and potential split-brain during cluster network partitions.
3. **Transactional Outbox with Database-Enforced Unique Constraints:** Write ledger entries and payout intent atomically to PostgreSQL/PGlite in a single transaction. A resilient background runner consumes the outbox with exponential backoff, jitter, and circuit breaker protection.
   - *Selected:* Guaranteed at-least-once delivery with exactly-once settlement semantics via idempotency keys (`idempotency_key = hash(milestone_id, attempt)`).

## Decision
All payment releases and webhook ingestion use the transactional outbox pattern with database-level uniqueness constraints. A circuit breaker suspends external calls on 3 consecutive network failures to prevent provider rate-limit blacklisting.

## Consequences
- Payouts never double-execute under webhook storms (verified under 50 concurrent duplicate webhook deliveries).
- The application remains deployable even in serverless or single-container environments with zero external message broker dependencies.
