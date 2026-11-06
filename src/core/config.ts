import { z } from "zod";

// Every variable is optional: the app must start in MOCK mode with zero secrets set.
const EnvSchema = z.object({
  APP_MODE: z.enum(["MOCK", "LIVE"]).optional(),
  APP_URL: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  PGLITE_DATA_DIR: z.string().optional(),
  PAYPAL_ENV: z.enum(["sandbox", "live"]).default("sandbox"),
  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),
  PAYPAL_WEBHOOK_ID: z.string().optional(),
  LLM_PROVIDER: z.enum(["xai", "groq", "anthropic", "stub"]).optional(),
  LLM_MODEL: z.string().optional(),
  LLM_TEXT_MODEL: z.string().optional(),
  XAI_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default(".data/uploads"),
  PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(10000).default(200),
  CHALLENGE_WINDOW_SECONDS: z.coerce.number().int().positive().default(86400),
  DISPUTE_EVIDENCE_WINDOW_SECONDS: z.coerce.number().int().positive().default(259200),
  PAYOUT_KILL_SWITCH: z.stringbool().default(false),
  MOCK_PAYOUT_FAIL_RATE: z.coerce.number().min(0).max(1).default(0),
  MOCK_CAPTURE_DELAY_MS: z.coerce.number().int().min(0).default(0),
  SESSION_SECRET: z.string().default("dev-only-session-secret-change-me"),
  API_KEY_PEPPER: z.string().default("dev-only-pepper-change-me"),
  PLATFORM_SIGNING_KEY_JWK: z.string().optional(),
  KEY_MODE: z.enum(["browser", "managed", "both"]).default("both"),
  MANDATE_DEFAULT_TTL_SECONDS: z.coerce.number().int().positive().default(86400),
  STEP_UP_ABOVE_MINOR: z.coerce.number().int().nonnegative().default(10000),
  PROCUREBOT_MODE: z.enum(["live", "scripted"]).default("scripted"),
});

export type Env = z.infer<typeof EnvSchema>;

export interface AppConfig extends Env {
  mode: "MOCK" | "LIVE";
  paymentsLive: boolean;
  llmProvider: "xai" | "groq" | "anthropic" | "stub";
  llmModel: string;
}

const DEFAULT_MODELS = { xai: "grok-4.7", groq: "qwen/qwen3.8-27b", anthropic: "claude-sonnet-5-5", stub: "stub" } as const;

export function loadConfig(source: Record<string, string | undefined> = process.env): AppConfig {
  // An empty value (KEY= in a copied .env.example) means unset, so the default applies.
  const env = EnvSchema.parse(Object.fromEntries(Object.entries(source).filter(([, v]) => v !== "")));
  const hasPayPal = Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET);
  const paymentsLive = env.APP_MODE === "MOCK" ? false : hasPayPal;
  if (env.APP_MODE === "LIVE" && !hasPayPal) throw new Error("APP_MODE=LIVE requires PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET");

  // Pick the LLM provider explicitly, else from whichever key is present, else the offline stub.
  const llmProvider =
    env.LLM_PROVIDER ?? (env.XAI_API_KEY ? "xai" : env.GROQ_API_KEY ? "groq" : env.ANTHROPIC_API_KEY ? "anthropic" : "stub");
  if (llmProvider === "xai" && !env.XAI_API_KEY) throw new Error("LLM_PROVIDER=xai requires XAI_API_KEY");
  if (llmProvider === "groq" && !env.GROQ_API_KEY) throw new Error("LLM_PROVIDER=groq requires GROQ_API_KEY");
  if (llmProvider === "anthropic" && !env.ANTHROPIC_API_KEY) throw new Error("LLM_PROVIDER=anthropic requires ANTHROPIC_API_KEY");

  // Never sign sessions with the public dev default on a deployment: fall back to a random per-process
  // secret (sessions then reset on restart, which is safe).
  const deployed = source.NODE_ENV === "production" || Boolean(env.DATABASE_URL);
  if (deployed && env.SESSION_SECRET.startsWith("dev-only")) {
    env.SESSION_SECRET = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Agent API keys are stored as peppered hashes, so the pepper must stay the same across restarts and can't be
  // replaced with a random one like the session secret. A deployment refuses to start with the published default.
  if (deployed && env.API_KEY_PEPPER.startsWith("dev-only")) {
    throw new Error("API_KEY_PEPPER must be set on a deployment (render.yaml generates one)");
  }

  return {
    ...env,
    mode: paymentsLive ? "LIVE" : "MOCK",
    paymentsLive,
    llmProvider,
    llmModel: env.LLM_MODEL ?? DEFAULT_MODELS[llmProvider],
  };
}

let cached: AppConfig | undefined;
export function config(): AppConfig {
  return (cached ??= loadConfig());
}
