// Wires ports to adapters from config (MOCK adapters whenever keys are absent) and builds services.
import path from "node:path";
import { MOCK_WEBHOOK_HEADER, MockPayPalAdapter } from "@/core/adapters/paypal/mock";
import { PayPalAdapter } from "@/core/adapters/paypal/live";
import { GroqLlmAdapter } from "@/core/adapters/llm/groq";
import { XaiLlmAdapter } from "@/core/adapters/llm/xai";
import { LocalStorageAdapter } from "@/core/adapters/storage/local";
import { InMemorySearchAdapter } from "@/core/adapters/search/none";
import { createStubLlm } from "@/core/agents/stub-fixtures";
import { config, type AppConfig } from "@/core/config";
import { openDb, type DbHandle } from "@/core/db/client";
import { EventHub } from "@/core/events/hub";
import { systemClock, type ClockPort } from "@/core/ports/clock";
import { setTimeSource } from "@/core/ports/time-source";
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
import { MandateBindingService } from "@/core/services/binding";
import { AgentJobService } from "@/core/services/agent-jobs";
import { DisputeService } from "@/core/services/disputes";
import { ReceiptService } from "@/core/services/receipts";
import { ReconciliationService } from "@/core/services/reconciliation";
import { AnalyticsService } from "@/core/services/analytics";
import { MandateGuardService } from "@/core/services/guard";
import { OutboxService } from "@/core/services/outbox";
import { CircuitBreaker, withCircuitBreaker } from "@/core/reliability/circuit-breaker";
import { PolicyService } from "@/core/services/policy";
import { ProofService } from "@/core/services/proofs";
import { ReleaseService } from "@/core/services/releases";
import { ReputationService } from "@/core/services/reputation";
import { VerificationService } from "@/core/services/verification";

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
  policy: PolicyService;
  guard: MandateGuardService;
  binding: MandateBindingService;
  proofs: ProofService;
  verification: VerificationService;
  releases: ReleaseService;
  agentJobs: AgentJobService;
  disputes: DisputeService;
  receipts: ReceiptService;
  reconciliation: ReconciliationService;
  analytics: AnalyticsService;
  outbox: OutboxService;
  /** Breaker around every PayPal network call made by services. */
  paypalBreaker: CircuitBreaker;
  /** Runs verification for a submitted milestone in the background; progress streams over SSE. */
  verifyInBackground(milestoneId: string): void;
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
  // A per-process tag keeps mock PayPal ids unique when a seed script and the app share a database.
  const idTag = `${Math.random().toString(36).slice(2, 6).toUpperCase()}-`;
  return new MockPayPalAdapter({ payoutFailRate: cfg.MOCK_PAYOUT_FAIL_RATE, captureDelayMs: cfg.MOCK_CAPTURE_DELAY_MS, idTag });
}

export function buildLlm(cfg: AppConfig): LlmPort {
  switch (cfg.llmProvider) {
    case "xai":
      return new XaiLlmAdapter(cfg.XAI_API_KEY!, cfg.llmModel);
    case "groq":
      return new GroqLlmAdapter(cfg.GROQ_API_KEY!, cfg.llmModel, undefined, cfg.LLM_TEXT_MODEL);
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
  // Row timestamps follow this container's clock. Only an explicit clock replaces the process default,
  // so extra containers built in a test (without a clock) do not reset it.
  if (overrides.clock) setTimeSource(overrides.clock);
  const payments = overrides.payments ?? buildPayments(cfg);
  // Services get the breaker-wrapped port; `payments` stays the raw adapter (mode checks, mock helpers).
  const paypalBreaker = new CircuitBreaker({ name: "paypal", failureThreshold: 5, cooldownMs: 30_000, now: () => clock.now().getTime() });
  const guardedPayments = withCircuitBreaker(payments, paypalBreaker);
  const outbox = new OutboxService(db, clock, { baseMs: 2_000, capMs: 5 * 60_000 });
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
  const policy = new PolicyService(db, audit);
  const reputation = new ReputationService();
  const guard = new MandateGuardService(db, keys, mandates, attestations, audit, clock);
  const binding = new MandateBindingService(db, keys, attestations, clock);
  const jobs = new JobService(db, ledger, audit, events, clock, cfg.PLATFORM_FEE_BPS, binding, guard);
  const funding = new FundingService(db, guardedPayments, jobs, audit, events, clock, binding, guard, policy, cfg.CHALLENGE_WINDOW_SECONDS);
  const treasury = new TreasuryService(
    db,
    guardedPayments,
    ledger,
    audit,
    attestations,
    events,
    clock,
    { killSwitch: cfg.PAYOUT_KILL_SWITCH, releaseGuard: (a) => guard.g3Release({ releaseId: a.releaseId }), outbox },
    reputation,
    policy,
  );
  const webhooks = new WebhookService(db, guardedPayments, ledger, treasury, audit, attestations, events, clock, outbox);
  outbox.on("webhook.redispatch", async (p) => {
    await webhooks.redispatch(String(p.webhookEventId));
  });
  outbox.on("payout.retry", async (p) => {
    await treasury.executeRelease(String(p.releaseId), "system:outbox");
  });
  const storage = new LocalStorageAdapter(path.resolve(cfg.STORAGE_LOCAL_DIR));
  const llm = overrides.llm ?? buildLlm(cfg);
  const proofs = new ProofService(db, storage, attestations, audit, events, clock);
  const verification = new VerificationService(db, llm, storage, proofs, policy, treasury, attestations, audit, events, clock, {
    baseChallengeWindowSeconds: cfg.CHALLENGE_WINDOW_SECONDS,
  });
  const releases = new ReleaseService(db, treasury, attestations, audit, reputation, policy, events, clock);
  mandates.onRevoked = (mandateId, reason) => releases.pauseForMandate(mandateId, reason);
  const agentJobs = new AgentJobService(db, llm, guard, mandates, binding, jobs, events, clock);
  const disputes = new DisputeService(db, llm, storage, treasury, guard, ledger, attestations, audit, reputation, policy, events, clock, {
    evidenceWindowSeconds: cfg.DISPUTE_EVIDENCE_WINDOW_SECONDS,
  });
  const receipts = new ReceiptService(db, jobs, attestations, keys, clock);
  const reconciliation = new ReconciliationService(db, guardedPayments, ledger, treasury, webhooks);

  function verifyInBackground(milestoneId: string): void {
    void verification.run(milestoneId).catch((err) => console.error("verification failed", milestoneId, err));
  }

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
    llm,
    storage,
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
    policy,
    guard,
    binding,
    proofs,
    verification,
    releases,
    agentJobs,
    disputes,
    receipts,
    reconciliation,
    analytics: new AnalyticsService(db),
    outbox,
    paypalBreaker,
    verifyInBackground,
    deliverMockWebhooks,
  };
}

// One container per server process (Next.js may re-evaluate modules in dev, so cache on globalThis).
const g = globalThis as unknown as { __settleai?: Promise<Container>; __settleaiTimer?: ReturnType<typeof setInterval> };
export function getContainer(): Promise<Container> {
  return (g.__settleai ??= createContainer().then((c) => {
    // Challenge-window timer: DB-driven, so a restart simply picks up overdue releases.
    g.__settleaiTimer ??= setInterval(() => {
      void c.releases
        .processDueWindows()
        .then(() => c.disputes.processDueWindows())
        .then(() => c.deliverMockWebhooks())
        .then(() => c.outbox.runDue())
        .catch((err) => console.error("release timer", err));
    }, 2000);
    // LIVE only: webhook safety net. Mock events are delivered by the timer above.
    if (c.payments.mode === "LIVE") {
      setInterval(() => void c.reconciliation.repairInFlight().catch((err) => console.error("repair timer", err)), 10_000);
    }
    return c;
  }));
}
