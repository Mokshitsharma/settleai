# Deployment

Author: Mokshit Sharma

- `Dockerfile`: container image.
- `docker-compose.yml`: app and `postgres:16-alpine`. Needs `POSTGRES_PASSWORD`, `SESSION_SECRET` and `API_KEY_PEPPER` in the environment.
- `render.yaml`: Render web service `settleai`. Secrets marked `sync:false` are entered in the dashboard. On the free plan the demo starts fresh after each restart.
- `infra/`: Terraform.

Current live state: TBD – needs owner input.
