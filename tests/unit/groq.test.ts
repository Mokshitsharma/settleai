import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { GROQ_MAX_IMAGES, GroqLlmAdapter } from "@/core/adapters/llm/groq";
import type { LlmContent } from "@/core/ports/llm";

const Out = z.object({ ok: z.boolean() });
const image: LlmContent = { type: "image", mediaType: "image/jpeg", base64: "AAAA" };

function mockFetch(content: string) {
  const calls: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)));
    return Response.json({ model: "qwen/qwen3.8-27b", choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 3 } });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("Groq adapter", () => {
  const llm = new GroqLlmAdapter("gsk_test", "qwen/qwen3.8-27b");

  it("uses json_schema for text-only requests and hides reasoning", async () => {
    const calls = mockFetch('{"ok":true}');
    const res = await llm.structured({ agent: "scoping", system: "sys", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }], schema: Out, schemaName: "Out" });
    expect(res.output).toEqual({ ok: true });
    expect(calls[0]).toMatchObject({ reasoning_format: "hidden", response_format: { type: "json_schema" } });
  });

  it("switches to JSON mode with the schema in the prompt when images are present, and caps images", async () => {
    const calls = mockFetch('{"ok":false}');
    await llm.structured({ agent: "verification", system: "sys", messages: [{ role: "user", content: [image, image, image, image, image] }], schema: Out, schemaName: "Out" });
    const body = calls[0] as { response_format: { type: string }; messages: { role: string; content: unknown }[] };
    expect(body.response_format.type).toBe("json_object");
    expect(String(body.messages[0]!.content)).toContain('"ok"');
    const parts = body.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])) as { type: string; text?: string }[];
    expect(parts.filter((p) => p.type === "image_url")).toHaveLength(GROQ_MAX_IMAGES);
    expect(parts.some((p) => p.text?.includes("2 further image(s)"))).toBe(true);
  });

  it("rejects output that does not match the schema", async () => {
    mockFetch('{"ok":"yes"}');
    await expect(llm.structured({ agent: "x", system: "s", messages: [{ role: "user", content: [{ type: "text", text: "t" }] }], schema: Out, schemaName: "Out" })).rejects.toThrow();
  });
});
