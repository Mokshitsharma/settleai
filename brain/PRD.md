# Product requirements

Author: Mokshit Sharma

## Problem

AI agents can hire people for real-world work, but payers need proof the work was done before money moves, and a clear finding of who is liable when it was not.

## Target user

Payers and their AI agents, workers, and platform admins. Built for the PayPal AI Hackathon 2026.

## Goals

- Hold money until proof passes checks.
- Decide every payout through a deterministic Mandate Guard.
- Produce signed receipts that can be verified offline.
- Handle disputes with a liability finding.

## Non-goals

- Official AP2 status; the mandates are AP2-inspired.
- Handling customer funds in production without licensing or a regulated partner.

## Core features

- Intent and job mandates, funding through PayPal Orders v2 or a labelled mock.
- Proof checks: EXIF, GPS, duplicate photo and injection scan, then a verification agent and risk engine.
- Double-entry ledger, disputes and admin policy.
- MCP server for external agents.

## User flow

1. A payer signs a mandate, or an agent creates a job within one.
2. The job is scoped into milestones and funded.
3. A worker submits proof.
4. Proof is checked and the payout is released, held or disputed.
5. Anyone can verify the receipt.

## Success criteria measurable from the repo

- `pnpm test` and `pnpm eval` pass.
- CI gates: audit, typecheck, lint, test, eval and demo smoke.

## Open questions

- Digital document deliverables (scenarios S07 and S08) are not built.
- Production plans: TBD – needs owner input.
