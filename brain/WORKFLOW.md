# Workflow

Author: Mokshit Sharma

## Set up

```bash
pnpm install
pnpm db:reset
pnpm dev
```

No keys are needed for the demo. `docker compose up` now requires `POSTGRES_PASSWORD`, `SESSION_SECRET` and `API_KEY_PEPPER` to be set.

## Test

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm eval
pnpm demo:smoke
```

## Branches

The current branch on 2026-11-06 is `hardening-gaps`. Release process: TBD – needs owner input.

## CI

`.github/workflows/ci.yml` runs install, `pnpm audit --audit-level=high`, typecheck, lint, test, eval and demo smoke.

## From edit to deploy

Edit, test, commit, push and let CI run. `render.yaml` is a Render blueprint.
