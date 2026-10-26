# ADR 0001: Autonomous Escrow and Mandate Guard Architecture

## Status
Accepted

## Context
Autonomous agents require programmatic hiring and disbursement capabilities. Allowing an LLM direct API access to bank accounts or payment credentials creates an unacceptable loss risk (prompt injection, hallucinations, rogue spend loops). We need an architectural separation between agent intent and fund movement.

## Options Considered
1. **Direct Agent API Access:** Give the agent PayPal API tokens to disburse funds upon claiming task completion.
   - *Rejected:* Fatal vulnerability; prompt injection in task prompt could drain accounts in seconds.
2. **Pre-Funded Prepaid Virtual Cards:** Generate a single-use card per job.
   - *Rejected:* Complex KYC, high per-card transaction fees, no post-verification challenge window, impossible to enforce programmatic proof-of-work checks.
3. **Escrow Mandate Guard (G1-G2-G3 Architecture):** Agents receive signed mandate envelopes (Ed25519) with strict spend limits and category geofencing. Agents can *only* create escrow jobs, never disburse. Funds are locked until deterministic checks + LLM verification (G2) pass, and a challenge window (G3) elapses.
   - *Selected:* Mathematically bounds maximum agent spend and enforces human-in-the-loop dispute rights.

## Decision
Implement the three-gate Mandate Guard pattern:
- **Gate 1 (G1):** Cryptographic mandate validation, spend reservation, and nonce deduplication.
- **Gate 2 (G2):** Multi-modal evidence verification (EXIF, geo, perceptual hash, vision LLM).
- **Gate 3 (G3):** Challenge window holding period prior to immutable payout disbursement.

## Consequences
- Agents are entirely isolated from financial execution.
- If an agent is compromised or hallucinates, the damage is capped at the mandate's single-job reserve and can be cancelled by the payer during the challenge window.
