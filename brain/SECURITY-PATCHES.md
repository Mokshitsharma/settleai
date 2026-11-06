# Security patches

Author: Mokshit Sharma

## 2026-11-06

| File | Issue type | Fix |
|---|---|---|
| `docker-compose.yml` | Literal database password, session secret and API key pepper | Replaced with required environment variables that fail clearly when missing. |
| `.env.example` | Missing variable | Added `POSTGRES_PASSWORD` with placeholder text. |
| `package.json`, `pnpm-lock.yaml` | `next` critical and high advisories | `next` and `eslint-config-next` moved from 16.3.8 to 16.4.5. `zod` advisory also cleared. |
| `package.json`, `pnpm-lock.yaml` | Indirect advisories | Same-major `pnpm.overrides` for `body-parser`, `follow-redirects`, `qs`, `ip-address` and `fast-uri`. Production audit now reports 0. |
| `src/mcp/README.md` | Literal demo key | Replaced with a placeholder. |
| `.gitignore` | Sensitive and generated file types not fully covered | Added missing patterns, with `.env.example` kept tracked. |

Tests before and after: 443 passed, 0 failed.

## Secret scan

- Tracked sensitive files: none.
- `.env.local` and `.data/` are ignored by git and were not opened in the final review.
- A demo API key remains a literal in `src/core/db/seed-demo.ts` and in git history. `procurebotKey` throws when `NODE_ENV=production` or `DATABASE_URL` is set and `PROCUREBOT_API_KEY` is missing, so the key is not seeded on Docker or Render. This is a seed-time check, not a refusal at request time: a host with neither setting, or a database already seeded with it, would accept it.
- Test files hold fake PayPal values.

## Remaining risks

| Risk | Severity | Reason not fixed |
|---|---|---|
| The Next.js upgrade has not been built | Medium | Builds were skipped in this pass. Run `pnpm build` before the release. An earlier build on 16.3.8 failed while resolving Google font files for JetBrains Mono. |
| `results/index.sqlite` is tracked | Low | See `_reports/settleai_untrack.txt`; not run. |

## Keys to rotate

The former literal values in `docker-compose.yml` were local-development values. Do not reuse them. The compose values remain in git history.

## Repository history

The compose literals, demo key and fake test values match in history. No attribution trailers. No production credentials were identified. Recommended mode: normal, unless you want the local-development values gone from history.

## 2026-11-06, demo key

`src/core/db/seed-demo.ts` now reads `PROCUREBOT_API_KEY` with no literal fallback and throws when it is missing, locally and deployed. `pnpm db:reset` therefore needs the variable set. `playwright.config.ts` and the CI smoke step supply one. Tests: 443 passed before the Playwright config change; e2e was not run. The old key remains in git history, so never reuse it.
