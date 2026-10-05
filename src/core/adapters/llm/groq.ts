import { z } from "zod";
import type { LlmContent, LlmPort, StructuredRequest, StructuredResponse } from "@/core/ports/llm";

// Groq's API is OpenAI-compatible (https://api.groq.com/openai/v1/chat/completions). VERIFIED 2026-10-05
// against console.groq.com/docs (see docs/llm-notes.md):
// - qwen/qwen3.8-27b is Groq's only vision model; max 3 images per request.
// - json_schema structured output does not accept image input, so requests with images use JSON mode
//   (json_object) with the schema in the system prompt. Zod below is the real gate either way.
// - Qwen is a reasoning model: reasoning_format must be "parsed" or "hidden" with JSON mode ("raw" is a 400).
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
export const GROQ_MAX_IMAGES = 3;

const ChatCompletion = z.object({
  model: z.string(),
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }), finish_reason: z.string().nullable() })),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).optional(),
});

type OpenAiPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

/** Keeps the first GROQ_MAX_IMAGES images; the caller tells the model how many were left out. */
function toOpenAiContent(content: LlmContent[], budget: { images: number; omitted: number }): OpenAiPart[] {
  return content.flatMap((c): OpenAiPart[] => {
    if (c.type === "text") return [{ type: "text", text: c.text }];
    if (budget.images >= GROQ_MAX_IMAGES) {
      budget.omitted++;
      return [];
    }
    budget.images++;
    return [{ type: "image_url", image_url: { url: `data:${c.mediaType};base64,${c.base64}` } }];
  });
}

export class GroqLlmAdapter implements LlmPort {
  readonly provider = "groq" as const;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly timeoutMs = 60_000,
  ) {}

  async structured<T>(req: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    const started = Date.now();
    const budget = { images: 0, omitted: 0 };
    const messages = req.messages.map((m) => ({ role: m.role, content: toOpenAiContent(m.content, budget) }));
    if (budget.omitted > 0) {
      messages.push({ role: "user", content: [{ type: "text", text: `(${budget.omitted} further image(s) were not shown because of a provider limit; do not assume what they contain.)` }] });
    }
    const jsonSchema = z.toJSONSchema(req.schema, { target: "draft-7", io: "output", unrepresentable: "any" });
    const withImages = budget.images > 0;
    const res = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(this.timeoutMs),
      body: JSON.stringify({
        model: this.model,
        temperature: req.temperature ?? 0.1,
        max_completion_tokens: req.maxTokens ?? 2048,
        reasoning_format: "hidden",
        messages: [
          {
            role: "system",
            content: withImages
              ? `${req.system}\n\nRespond with one JSON object that matches this JSON Schema (${req.schemaName}):\n${JSON.stringify(jsonSchema)}`
              : req.system,
          },
          ...messages,
        ],
        response_format: withImages
          ? { type: "json_object" }
          : { type: "json_schema", json_schema: { name: req.schemaName, schema: jsonSchema, strict: false } },
      }),
    });
    if (!res.ok) {
      // Never log the request body: it may contain user content. The key is never echoed.
      throw new Error(`Groq request failed with HTTP ${res.status}`);
    }
    const body = ChatCompletion.parse(await res.json());
    const text = body.choices[0]?.message.content;
    if (!text) throw new Error("Groq returned an empty completion");
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
