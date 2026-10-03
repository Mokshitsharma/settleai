// Agent runtime (spec §8.1): structured output only, Zod-validated, retry once with the validation
// error, then a safe fallback. Every attempt is traced in agent_runs and streamed as events.
// Agents never receive tools that move money.
import { z } from "zod";
import type { Db } from "@/core/db/client";
import { agentRuns } from "@/core/db/schema";
import type { Emit } from "@/core/events/hub";
import { newId } from "@/core/ids";
import type { LlmMessage, LlmPort } from "@/core/ports/llm";

export interface AgentCall<T> {
  agent: string;
  promptVersion: string;
  entityType: string;
  entityId: string;
  system: string;
  messages: LlmMessage[];
  schema: z.ZodType<T>;
  schemaName: string;
  fixtureKey?: string;
  inputRef?: string;
  maxTokens?: number;
}

export type AgentResult<T> =
  | { ok: true; output: T; traceId: string; model: string; latencyMs: number }
  | { ok: false; traceId: string; error: string };

export interface AgentDeps {
  db: Db;
  llm: LlmPort;
  emit?: Emit;
}

function describeError(err: unknown): string {
  if (err instanceof z.ZodError) {
    return err.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
  }
  if (err instanceof SyntaxError) return `invalid JSON: ${err.message}`;
  return (err as Error).message ?? String(err);
}

export async function runAgent<T>(deps: AgentDeps, call: AgentCall<T>): Promise<AgentResult<T>> {
  const traceId = newId("trace");
  const emit = deps.emit ?? (() => {});
  let messages = call.messages;
  let lastError = "";

  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = Date.now();
    emit("agent.step", attempt === 1 ? `${call.agent}: thinking` : `${call.agent}: retrying after invalid output`, {
      agent: call.agent,
      attempt,
    });
    try {
      const res = await deps.llm.structured({
        agent: call.agent,
        system: call.system,
        messages,
        schema: call.schema,
        schemaName: call.schemaName,
        fixtureKey: call.fixtureKey,
        maxTokens: call.maxTokens,
      });
      await deps.db.insert(agentRuns).values({
        id: newId("run"),
        agent: call.agent,
        entityType: call.entityType,
        entityId: call.entityId,
        inputRef: call.inputRef,
        outputJson: res.output as object,
        model: res.model,
        promptVersion: call.promptVersion,
        tokensIn: res.tokensIn,
        tokensOut: res.tokensOut,
        latencyMs: res.latencyMs,
        status: "ok",
        traceId,
      });
      emit("agent.done", `${call.agent}: done in ${res.latencyMs || Date.now() - started} ms`, { agent: call.agent, model: res.model });
      return { ok: true, output: res.output, traceId, model: res.model, latencyMs: res.latencyMs };
    } catch (err) {
      lastError = describeError(err);
      const invalid = err instanceof z.ZodError || err instanceof SyntaxError;
      await deps.db.insert(agentRuns).values({
        id: newId("run"),
        agent: call.agent,
        entityType: call.entityType,
        entityId: call.entityId,
        inputRef: call.inputRef,
        outputJson: { error: lastError },
        model: deps.llm.model,
        promptVersion: call.promptVersion,
        latencyMs: Date.now() - started,
        status: invalid ? "invalid_output" : "error",
        traceId,
      });
      // Retry once, telling the model exactly what was wrong.
      messages = [
        ...call.messages,
        {
          role: "user",
          content: [{ type: "text", text: `Your previous output was rejected: ${lastError}. Return corrected JSON only, matching the schema exactly.` }],
        },
      ];
    }
  }

  await deps.db.insert(agentRuns).values({
    id: newId("run"),
    agent: call.agent,
    entityType: call.entityType,
    entityId: call.entityId,
    outputJson: { error: lastError },
    model: deps.llm.model,
    promptVersion: call.promptVersion,
    status: "fallback",
    traceId,
  });
  emit("agent.fallback", `${call.agent}: falling back to human review`, { agent: call.agent, error: lastError });
  return { ok: false, traceId, error: lastError };
}

/** Wraps untrusted content in a delimited data block (spec §8.8). Closing tags inside are neutralized. */
export function dataBlock(tag: string, content: string): string {
  const safe = content.replaceAll(`</${tag}>`, `</ ${tag}>`);
  return `<${tag}>\n${safe}\n</${tag}>`;
}
