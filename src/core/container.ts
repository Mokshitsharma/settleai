// Wires ports to adapters from config (MOCK adapters whenever keys are absent) and builds services.
import path from "node:path";
import { MOCK_WEBHOOK_HEADER, MockPayPalAdapter } from "@/core/adapters/paypal/mock";
import { PayPalAdapter } from "@/core/adapters/paypal/live";
import { XaiLlmAdapter } from "@/core/adapters/llm/xai";
import { LocalStorageAdapter } from "@/core/adapters/storage/local";
import { InMemorySearchAdapter } from "@/core/adapters/search/none";
import { createStubLlm } from "@/core/agents/stub-fixtures";
import { config, type AppConfig } from "@/core/config";
import { openDb, type DbHandle } from "@/core/db/client";
import { EventHub } from "@/core/events/hub";
import { systemClock, type ClockPort } from "@/core/ports/clock";
import type { LlmPort } from "@/core/ports/llm";
import type { PaymentsPort } from "@/core/ports/payments";
import type { SearchPort } from "@/core/ports/search";
import type { StoragePort } from "@/core/ports/storage";
import { AttestationService } from "@/core/services/attestations";
import { AuditService } from "@/core/services/audit";
import { FundingService } from "@/core/services/funding";
import { JobService } from "@/core/services/jobs";
import { KeyService } from "@/core/services/keys";
import { LedgerService } from "@/core/services/ledger";
import { MandateService } from "@/core/services/mandates";
import { TreasuryService } from "@/core/services/treasury";
import { WebhookService } from "@/core/services/webhooks";

export interface Container {
  config: AppConfig;
  dbHandle: DbHandle;
  payments: PaymentsPort;
  llm: LlmPort;
  storage: StoragePort;
  search: SearchPort;
  clock: ClockPort;
  events: EventHub;
  ledger: LedgerService;
  audit: AuditService;
  keys: KeyService;
  attestations: AttestationService;
  mandates: MandateService;
  jobs: JobService;
  funding: FundingService;
  treasury: TreasuryService;
  webhooks: WebhookService;
  /** MOCK mode only: delivers the mock's queued PayPal events through the real webhook pipeline. */
  deliverMockWebhooks(): Promise<number>;
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
      return createStubLlm();
  }
}

export async function createContainer(
  cfg: AppConfig = config(),
  overrides: { dbHandle?: DbHandle; clock?: ClockPort; payments?: PaymentsPort; llm?: LlmPort } = {},
): Promise<Container> {
  const dbHandle = overrides.dbHandle ?? (await openDb({ databaseUrl: cfg.DATABASE_URL, dataDir: cfg.PGLITE_DATA_DIR }));
  const db = dbHandle.db;
  const clock = overrides.clock ?? systemClock;
  const payments = overrides.payments ?? buildPayments(cfg);
  const events = new EventHub();
  const ledger = new LedgerService(db);
  const audit = new AuditService(db);
  const keys = new KeyService(db, {
    secret: cfg.SESSION_SECRET,
    platformJwk: cfg.PLATFORM_SIGNING_KEY_JWK,
    devKeyFile: cfg.PLATFORM_SIGNING_KEY_JWK ? undefined : path.resolve(".data/platform-key.json"),
  });
  // Load the platform key now: lazily registering it later could query the root handle while a
  // transaction is open, which deadlocks PGlite's single connection.
  await keys.platformSigner();
  const attestations = new AttestationService(db, keys, clock);
  const mandates = new MandateService(db, keys, audit, clock);
  const jobs = new JobService(db, ledger, audit, events, clock, cfg.PLATFORM_FEE_BPS);
  const funding = new FundingService(db, payments, jobs, audit, events, clock);
  const treasury = new TreasuryService(db, payments, ledger, audit, attestations, events, clock, { killSwitch: cfg.PAYOUT_KILL_SWITCH });
  const webhooks = new WebhookService(db, payments, ledger, treasury, audit, attestations, events, clock);

  async function deliverMockWebhooks(): Promise<number> {
    if (!(payments instanceof MockPayPalAdapter)) return 0;
    const queued = payments.drainOutbox();
    for (const e of queued) {
      await webhooks.process({ [MOCK_WEBHOOK_HEADER]: "1" }, JSON.stringify({ id: e.id, event_type: e.eventType, resource: e.resource }));
    }
    return queued.length;
  }

  return {
    config: cfg,
    dbHandle,
    payments,
    llm: overrides.llm ?? buildLlm(cfg),
    storage: new LocalStorageAdapter(path.resolve(cfg.STORAGE_LOCAL_DIR)),
    search: new InMemorySearchAdapter(),
    clock,
    events,
    ledger,
    audit,
    keys,
    attestations,
    mandates,
    jobs,
    funding,
    treasury,
    webhooks,
    deliverMockWebhooks,
  };
}

// One container per server process (Next.js may re-evaluate modules in dev, so cache on globalThis).
const g = globalThis as unknown as { __settleai?: Promise<Container> };
export function getContainer(): Promise<Container> {
  return (g.__settleai ??= createContainer());
}
