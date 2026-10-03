import { z } from "zod";
import type { LlmContent, LlmPort, StructuredRequest, StructuredResponse } from "@/core/ports/llm";

// xAI's API is OpenAI-compatible (https://api.x.ai/v1/chat/completions) and supports
// response_format json_schema. VERIFIED 2026-10-03 against docs.x.ai (see docs/llm-notes.md).
// Image input together with structured output must be re-verified in T202.
const XAI_BASE_URL = "https://api.x.ai/v1";

const ChatCompletion = z.object({
  model: z.string(),
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }), finish_reason: z.string().nullable() })),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).optional(),
});

function toOpenAiContent(content: LlmContent[]) {
  return content.map((c) =>
    c.type === "text"
      ? { type: "text", text: c.text }
      : { type: "image_url", image_url: { url: `data:${c.mediaType};base64,${c.base64}`, detail: "high" } },
  );
}

export class XaiLlmAdapter implements LlmPort {
  readonly provider = "xai" as const;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly timeoutMs = 60_000,
  ) {}

  async structured<T>(req: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    const started = Date.now();
    const res = await fetch(`${XAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(this.timeoutMs),
      body: JSON.stringify({
        model: this.model,
        temperature: req.temperature ?? 0.1,
        max_tokens: req.maxTokens ?? 2048,
        messages: [
          { role: "system", content: req.system },
          ...req.messages.map((m) => ({ role: m.role, content: toOpenAiContent(m.content) })),
        ],
        response_format: {
          type: "json_schema",
          // strict:false because optional fields can be rejected by strict mode; Zod below is the real gate.
          json_schema: {
            name: req.schemaName,
            schema: z.toJSONSchema(req.schema, { target: "draft-7", io: "output", unrepresentable: "any" }),
            strict: false,
          },
        },
      }),
    });
    if (!res.ok) {
      // Never log the request body: it may contain user content. The key is never echoed.
      throw new Error(`xAI request failed with HTTP ${res.status}`);
    }
    const body = ChatCompletion.parse(await res.json());
    const text = body.choices[0]?.message.content;
    if (!text) throw new Error("xAI returned an empty completion");
    const output = req.schema.parse(JSON.parse(text));
    return {
      output,
      model: body.model,
      tokensIn: body.usage?.prompt_tokens ?? 0,
      tokensOut: body.usage?.completion_tokens ?? 0,
      latencyMs: Date.now() - started,
    };
  }
}
