# API

Author: Mokshit Sharma

Next.js route handlers in `src/app/api`: 50 route files. Main groups:

| Prefix | Purpose |
|---|---|
| `/api/agent/*`, `/api/agent-clients` | Agent jobs, mandates, milestone decisions and clients |
| `/api/admin/*` | Agents and policy |
| `/api/auth/*` | Demo login and logout |
| `/api/jobs/*` | Jobs, scope, spec, acceptance and funding |
| `/api/mandates/*` | Mandates, checks, drafts and revocation |
| `/api/milestones/*` | Milestone approval |
| `/api/disputes/*`, `/api/dispute-evidence/*` | Disputes and evidence |
| `/api/keys/*` | Keys |
| `/api/events/stream` | Event stream |
| `/api/health` | Health |
| `/api/dev/*` | Development helpers, including mock PayPal and simulated webhooks |

Per-route request and response schemas are in the handlers and `src/core/contracts`.
