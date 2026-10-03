// Wires ports to adapters from config. MOCK adapters whenever keys are absent.
import path from "node:path";
import { MockPayPalAdapter } from "@/core/adapters/paypal/mock";
import { PayPalAdapter } from "@/core/adapters/paypal/live";
import { StubLlmAdapter } from "@/core/adapters/llm/stub";
import { XaiLlmAdapter } from "@/core/adapters/llm/xai";
import { LocalStorageAdapter } from "@/core/adapters/storage/local";
import { InMemorySearchAdapter } from "@/core/adapters/search/none";
import { config, type AppConfig } from "@/core/config";
import { openDb, type DbHandle } from "@/core/db/client";
import type { ClockPort } from "@/core/ports/clock";
import { systemClock } from "@/core/ports/clock";
import type { LlmPort } from "@/core/ports/llm";
import type { PaymentsPort } from "@/core/ports/payments";
import type { SearchPort } from "@/core/ports/search";
import type { StoragePort } from "@/core/ports/storage";
import { AuditService } from "@/core/services/audit";
import { LedgerService } from "@/core/services/ledger";

export interface Container {
  config: AppConfig;
  dbHandle: DbHandle;
  payments: PaymentsPort;
  llm: LlmPort;
  storage: StoragePort;
  search: SearchPort;
  clock: ClockPort;
  ledger: LedgerService;
  audit: AuditService;
}

export function buildPayments(cfg: AppConfig): PaymentsPort {
  if (cfg.paymentsLive) {
    return new PayPalAdapter({
      clientId: cfg.PAYPAL_CLIENT_ID!,
      clientSecret: cfg.PAYPAL_CLIENT_SECRET!,
      env: cfg.PAYPAL_ENV,
      webhookId: cfg.PAYPAL_WEBHOOK_ID,
    });
  }
  return new MockPayPalAdapter({ payoutFailRate: cfg.MOCK_PAYOUT_FAIL_RATE, captureDelayMs: cfg.MOCK_CAPTURE_DELAY_MS });
}

export function buildLlm(cfg: AppConfig): LlmPort {
  switch (cfg.llmProvider) {
    case "xai":
      return new XaiLlmAdapter(cfg.XAI_API_KEY!, cfg.llmModel);
    case "anthropic":
      throw new Error("Anthropic adapter not included; use LLM_PROVIDER=xai or stub");
    default:
      return new StubLlmAdapter();
  }
}

export async function createContainer(cfg: AppConfig = config(), dbHandle?: DbHandle): Promise<Container> {
  const handle = dbHandle ?? (await openDb({ databaseUrl: cfg.DATABASE_URL, dataDir: cfg.PGLITE_DATA_DIR }));
  return {
    config: cfg,
    dbHandle: handle,
    payments: buildPayments(cfg),
    llm: buildLlm(cfg),
    storage: new LocalStorageAdapter(path.resolve(cfg.STORAGE_LOCAL_DIR)),
    search: new InMemorySearchAdapter(),
    clock: systemClock,
    ledger: new LedgerService(handle.db),
    audit: new AuditService(handle.db),
  };
}

// One container per server process (Next.js may re-evaluate modules in dev, so cache on globalThis).
const g = globalThis as unknown as { __settleai?: Promise<Container> };
export function getContainer(): Promise<Container> {
  return (g.__settleai ??= createContainer());
}
