# ADR 0003: Double-Entry Ledger Conservation and Zero-Cache Financial Policy

## Status
Accepted

## Context
Handling client escrow deposits, partial dispute allocations, and contractor payouts requires airtight financial accounting. Serving cached balances or stale ledger records risks overdrafts or incorrect dispute settlements.

## Options Considered
1. **Single Account Balance Column (Mutable `balance` column on users):**
   - *Rejected:* Fatal to auditability; concurrent updates cause race conditions, and historical transaction tracing is impossible.
2. **Read-Through Redis Cache for Balances & Escrow State:**
   - *Rejected:* Cache invalidation bugs can allow an agent to commit funds already spent elsewhere. Caching financial state introduces split-brain risk.
3. **Double-Entry Append-Only Ledger with Zero Financial Caching:** Every transfer requires balancing debit and credit entries (`sum(debits) == sum(credits)`). Escrow accounts can never drop below zero. All balance queries execute against the primary database with row-level locks or transactional views. Non-financial assets (job templates, public metrics) may be cached, but financial state is never cached.
   - *Selected:* Proven banking-grade design with mathematical correctness invariants.

## Decision
- Enforce strict double-entry ledger bookkeeping.
- Enforce that escrow accounts are non-negative at the database constraint level.
- Prohibit any caching layer in front of ledger balance queries or money movement execution paths.

## Consequences
- Property-based tests guarantee invariant conservation under random permutation sequences.
- Read performance for dashboards is handled via non-blocking read-replica views rather than caching.
