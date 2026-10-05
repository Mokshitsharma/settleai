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

## Groq (added 2026-10-05, owner request; xAI account has no credits yet)

| Item | Finding | Verified |
|---|---|---|
| API shape | OpenAI-compatible, base URL `https://api.groq.com/openai/v1`, `POST /chat/completions` | 2026-10-05, console.groq.com/docs |
| Vision model | `qwen/qwen3.8-27b` is the only vision model; max 3 images per request; base64 data URLs accepted | 2026-10-05, docs/vision |
| Structured output | `json_schema` (strict on gpt-oss-20b/120b and qwen3.8-27b), but **not with image input**; images use JSON mode (`json_object`) with the schema in the system prompt | 2026-10-05, docs/structured-outputs, docs/vision |
| Reasoning | Qwen defaults to `reasoning_format: raw` (`<think>` in content); JSON mode requires `parsed` or `hidden`. The adapter sends `hidden` | 2026-10-05, docs/reasoning |
| More than 3 images | The adapter sends the first 3 and tells the model how many were left out | adapter design |

Provider selection: `LLM_PROVIDER`, else the first key present (xAI, Groq, Anthropic), else the offline stub.
ProcureBot live mode still uses xAI function calling.
