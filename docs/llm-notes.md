# LLM provider notes

Provider: **xAI Grok** (owner decision D2), behind `LlmPort`. Offline `StubLlmAdapter` for demo mode and CI.

| Item | Finding | Verified |
|---|---|---|
| API shape | OpenAI-compatible, base URL `https://api.x.ai/v1`, `POST /chat/completions` | 2026-10-03, docs.x.ai |
| Structured output | `response_format: { type: "json_schema", json_schema: {...} }` supported (Grok 4 family) | 2026-10-03, docs.x.ai structured-outputs guide |
| Recommended model | `grok-4.7` (others: grok-4.6, grok-4.5, grok-4.3, grok-4.20 reasoning/non-reasoning) | 2026-10-03, docs.x.ai models page |
| Image input limits | Max 20 MiB per image, no limit on image count | 2026-10-03, docs.x.ai models page |
| Image input + json_schema in one request with grok-4.7 | Not stated in docs | **Pending: test live in T202** |

All agent outputs are still validated with Zod after the provider returns; schema enforcement on the provider side is a convenience, not a guarantee.
