import type { z } from "zod";

export type LlmContent =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: "image/jpeg" | "image/png" | "image/webp"; base64: string };

export interface LlmMessage {
  role: "user" | "assistant";
  content: LlmContent[];
}

export interface StructuredRequest<T> {
  agent: string; // "scoping" | "verification" | "arbiter" | "concierge" | ...
  system: string;
  messages: LlmMessage[];
  schema: z.ZodType<T>;
  schemaName: string;
  /** Key used by the stub adapter to pick a deterministic fixture. */
  fixtureKey?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface StructuredResponse<T> {
  output: T;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
}

export interface LlmPort {
  readonly provider: "xai" | "anthropic" | "stub";
  readonly model: string;
  /** Returns schema-valid output or throws; callers retry once and then fall back to HUMAN_REVIEW. */
  structured<T>(req: StructuredRequest<T>): Promise<StructuredResponse<T>>;
}
