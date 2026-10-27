// Section 9 data model. Ids are prefixed ULIDs; money columns end in _minor (integer cents).
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { now as timeSourceNow } from "@/core/ports/time-source";

const money = (name: string) => bigint(name, { mode: "number" });
// Row timestamps come from the app's ClockPort (via the time source); the SQL default is only a fallback.
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow().$defaultFn(timeSourceNow);
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$defaultFn(timeSourceNow).$onUpdateFn(timeSourceNow);
const ts = (name: string) => timestamp(name, { withTimezone: true });

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    role: text("role", { enum: ["payer", "worker", "admin"] }).notNull(),
    paypalEmail: text("paypal_email"),
    paypalEmailChangedAt: ts("paypal_email_changed_at"),
    trustScore: integer("trust_score").notNull().default(50),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("users_trust_range", sql`${t.trustScore} between 0 and 100`)],
);

export const apiClients = pgTable("api_clients", {
  id: text("id").primaryKey(),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  scopes: text("scopes").array().notNull(),
  capPerJobMinor: money("cap_per_job_minor").notNull(),
  capPerDayMinor: money("cap_per_day_minor").notNull(),
  status: text("status", { enum: ["active", "suspended", "revoked"] }).notNull().default("active"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const jobs = pgTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    payerId: text("payer_id").notNull().references(() => users.id),
    workerId: text("worker_id").references(() => users.id),
    title: text("title").notNull(),
    category: text("category", { enum: ["delivery", "digital_deliverable", "onsite_service"] }).notNull(),
    specJson: jsonb("spec_json").notNull(),
    currency: text("currency").notNull().default("USD"),
    totalMinor: money("total_minor").notNull(),
    feeMinor: money("fee_minor").notNull().default(0),
    status: text("status").notNull().default("DRAFT"),
    createdBy: text("created_by").notNull(), // user:<id> | api_client:<id>
    locationJson: jsonb("location_json"),
    intentMandateId: text("intent_mandate_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("jobs_amounts_nonneg", sql`${t.totalMinor} >= 0 and ${t.feeMinor} >= 0`),
    index("jobs_payer_idx").on(t.payerId),
    index("jobs_worker_idx").on(t.workerId),
    index("jobs_status_idx").on(t.status),
  ],
);

export const milestones = pgTable(
  "milestones",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").notNull().references(() => jobs.id),
    seq: integer("seq").notNull(),
    title: text("title").notNull(),
    amountMinor: money("amount_minor").notNull(),
    dueAt: ts("due_at").notNull(),
    status: text("status").notNull().default("PENDING"),
    criteriaJson: jsonb("criteria_json").notNull(),
    activatedAt: ts("activated_at"),
    releasedMinor: money("released_minor").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("milestones_job_seq_uq").on(t.jobId, t.seq),
    check("milestones_amounts", sql`${t.amountMinor} >= 0 and ${t.releasedMinor} >= 0 and ${t.releasedMinor} <= ${t.amountMinor}`),
    index("milestones_status_idx").on(t.status),
  ],
);

export const fundingOrders = pgTable(
  "funding_orders",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").notNull().references(() => jobs.id),
    paypalOrderId: text("paypal_order_id").unique(),
    paypalCaptureId: text("paypal_capture_id").unique(),
    amountMinor: money("amount_minor").notNull(),
    status: text("status").notNull().default("CREATED"),
    requestId: text("request_id").notNull().unique(),
    rawJson: jsonb("raw_json"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("funding_amount_nonneg", sql`${t.amountMinor} >= 0`), index("funding_job_idx").on(t.jobId)],
);

export const proofs = pgTable(
  "proofs",
  {
    id: text("id").primaryKey(),
    milestoneId: text("milestone_id").notNull().references(() => milestones.id),
    submitterId: text("submitter_id").notNull().references(() => users.id),
    kind: text("kind", { enum: ["photo", "file", "text", "geo"] }).notNull(),
    storageKey: text("storage_key"),
    mime: text("mime"),
    sha256: text("sha256"),
    phash: text("phash"),
    exifJson: jsonb("exif_json"),
    geoLat: doublePrecision("geo_lat"),
    geoLng: doublePrecision("geo_lng"),
    textContent: text("text_content"),
    createdAt: createdAt(),
  },
  (t) => [index("proofs_milestone_idx").on(t.milestoneId), index("proofs_phash_idx").on(t.phash)],
);

export const verifications = pgTable("verifications", {
  id: text("id").primaryKey(),
  milestoneId: text("milestone_id").notNull().references(() => milestones.id),
  resultJson: jsonb("result_json").notNull(),
  overall: text("overall").notNull(),
  confidence: doublePrecision("confidence").notNull(),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  latencyMs: integer("latency_ms").notNull(),
  createdAt: createdAt(),
});

export const riskAssessments = pgTable("risk_assessments", {
  id: text("id").primaryKey(),
  milestoneId: text("milestone_id").notNull().references(() => milestones.id),
  verificationId: text("verification_id").notNull().references(() => verifications.id),
  score: integer("score").notNull(),
  flagsJson: jsonb("flags_json").notNull(),
  decision: text("decision", { enum: ["AUTO_RELEASE", "HUMAN_REVIEW", "HOLD"] }).notNull(),
  policyVersion: integer("policy_version").notNull(),
  explanation: text("explanation"),
  cardJson: jsonb("card_json").notNull(),
  createdAt: createdAt(),
});

export const releases = pgTable(
  "releases",
  {
    id: text("id").primaryKey(),
    milestoneId: text("milestone_id").notNull().references(() => milestones.id),
    amountMinor: money("amount_minor").notNull(),
    feeMinor: money("fee_minor").notNull().default(0),
    decisionSource: text("decision_source", { enum: ["auto", "payer", "admin", "dispute"] }).notNull(),
    status: text("status").notNull().default("CREATED"),
    challengeEndsAt: ts("challenge_ends_at"),
    payoutId: text("payout_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("releases_amounts", sql`${t.amountMinor} >= 0 and ${t.feeMinor} >= 0`), index("releases_status_idx").on(t.status)],
);

export const payouts = pgTable("payouts", {
  id: text("id").primaryKey(),
  releaseId: text("release_id").notNull().references(() => releases.id),
  paypalBatchId: text("paypal_batch_id"),
  paypalItemId: text("paypal_item_id").unique(),
  senderItemId: text("sender_item_id").notNull().unique(),
  amountMinor: money("amount_minor").notNull(),
  status: text("status").notNull().default("CREATED"),
  failureReason: text("failure_reason"),
  rawJson: jsonb("raw_json"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const disputes = pgTable("disputes", {
  id: text("id").primaryKey(),
  milestoneId: text("milestone_id").notNull().references(() => milestones.id),
  openedBy: text("opened_by").notNull().references(() => users.id),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("OPEN"),
  deadlineAt: ts("deadline_at").notNull(),
  resolutionJson: jsonb("resolution_json"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const refunds = pgTable("refunds", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull().references(() => jobs.id),
  disputeId: text("dispute_id").references(() => disputes.id),
  paypalRefundId: text("paypal_refund_id").unique(),
  requestId: text("request_id").notNull().unique(),
  amountMinor: money("amount_minor").notNull(),
  status: text("status").notNull().default("CREATED"),
  rawJson: jsonb("raw_json"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const disputeEvidence = pgTable("dispute_evidence", {
  id: text("id").primaryKey(),
  disputeId: text("dispute_id").notNull().references(() => disputes.id),
  submitterId: text("submitter_id").notNull().references(() => users.id),
  kind: text("kind", { enum: ["text", "file", "photo"] }).notNull(),
  content: text("content"),
  storageKey: text("storage_key"),
  createdAt: createdAt(),
});

export const disputeProposals = pgTable("dispute_proposals", {
  id: text("id").primaryKey(),
  disputeId: text("dispute_id").notNull().references(() => disputes.id),
  proposalJson: jsonb("proposal_json").notNull(),
  confidence: doublePrecision("confidence").notNull(),
  payerResponse: text("payer_response", { enum: ["accept", "reject"] }),
  workerResponse: text("worker_response", { enum: ["accept", "reject"] }),
  status: text("status").notNull().default("PROPOSED"),
  expiresAt: ts("expires_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const ledgerAccounts = pgTable("ledger_accounts", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(), // PAYPAL_BALANCE | ESCROW:<jobId> | FEE_REVENUE | PAYPAL_FEES
  jobId: text("job_id").references(() => jobs.id),
  type: text("type", { enum: ["asset", "liability", "revenue", "expense"] }).notNull(),
  createdAt: createdAt(),
});

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: text("id").primaryKey(),
    txnId: text("txn_id").notNull(),
    accountId: text("account_id").notNull().references(() => ledgerAccounts.id),
    debitMinor: money("debit_minor").notNull().default(0),
    creditMinor: money("credit_minor").notNull().default(0),
    refType: text("ref_type").notNull(),
    refId: text("ref_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "ledger_one_side",
      sql`${t.debitMinor} >= 0 and ${t.creditMinor} >= 0 and (${t.debitMinor} = 0) <> (${t.creditMinor} = 0)`,
    ),
    index("ledger_txn_idx").on(t.txnId),
    index("ledger_account_idx").on(t.accountId),
  ],
);

// Idempotency of money movements: one ledger transaction per (refType, refId, kind).
export const ledgerTxns = pgTable("ledger_txns", {
  id: text("id").primaryKey(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  kind: text("kind").notNull(),
  memo: text("memo"),
  createdAt: createdAt(),
});

export const agentRuns = pgTable("agent_runs", {
  id: text("id").primaryKey(),
  agent: text("agent").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  inputRef: text("input_ref"),
  outputJson: jsonb("output_json"),
  toolCallsJson: jsonb("tool_calls_json"),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  tokensIn: integer("tokens_in").notNull().default(0),
  tokensOut: integer("tokens_out").notNull().default(0),
  latencyMs: integer("latency_ms").notNull().default(0),
  status: text("status", { enum: ["ok", "invalid_output", "error", "fallback"] }).notNull(),
  traceId: text("trace_id").notNull(),
  createdAt: createdAt(),
});

export const approvals = pgTable("approvals", {
  id: text("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  requestedBy: text("requested_by").notNull(),
  decidedBy: text("decided_by"),
  decision: text("decision", { enum: ["approve", "reject", "more_info"] }),
  note: text("note"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const auditLog = pgTable("audit_log", {
  id: text("id").primaryKey(),
  seq: integer("seq").notNull().unique(),
  actor: text("actor").notNull(), // user:<id> | admin:<id> | agent:<name> | system
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  payloadJson: jsonb("payload_json").notNull(),
  prevHash: text("prev_hash").notNull(),
  hash: text("hash").notNull().unique(),
  createdAt: createdAt(),
});

export const webhookEvents = pgTable("webhook_events", {
  id: text("id").primaryKey(),
  paypalEventId: text("paypal_event_id").notNull().unique(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status", { enum: ["received", "processed", "ignored", "failed"] }).notNull().default("received"),
  processedAt: ts("processed_at"),
  createdAt: createdAt(),
});

export const reputationEvents = pgTable("reputation_events", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  delta: integer("delta").notNull(),
  reason: text("reason").notNull(),
  refType: text("ref_type").notNull(),
  refId: text("ref_id").notNull(),
  createdAt: createdAt(),
});

export const policies = pgTable(
  "policies",
  {
    id: text("id").primaryKey(),
    version: integer("version").notNull().unique(),
    json: jsonb("json").notNull(),
    active: boolean("active").notNull().default(false),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
  },
  // Only one active policy at a time.
  (t) => [uniqueIndex("policies_one_active").on(t.active).where(sql`${t.active}`)],
);

export const notifications = pgTable("notifications", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  channel: text("channel", { enum: ["email", "whatsapp", "in_app"] }).notNull(),
  template: text("template").notNull(),
  payload: jsonb("payload").notNull(),
  sentAt: ts("sent_at"),
  createdAt: createdAt(),
});

export const signingKeys = pgTable("signing_keys", {
  id: text("id").primaryKey(), // keyId
  ownerType: text("owner_type", { enum: ["user", "client", "platform"] }).notNull(),
  ownerId: text("owner_id").notNull(),
  publicJwk: jsonb("public_jwk").notNull(), // public keys only, never private material
  alg: text("alg").notNull().default("ES256"),
  status: text("status", { enum: ["active", "retired", "revoked"] }).notNull().default("active"),
  createdAt: createdAt(),
  retiredAt: ts("retired_at"),
});

export const mandates = pgTable(
  "mandates",
  {
    id: text("id").primaryKey(),
    type: text("type", { enum: ["intent", "job", "payment"] }).notNull(),
    parentId: text("parent_id"),
    issuerId: text("issuer_id").notNull(),
    subjectId: text("subject_id").notNull(),
    payloadJson: jsonb("payload_json").notNull(),
    payloadHash: text("payload_hash").notNull(),
    signaturesJson: jsonb("signatures_json").notNull(),
    status: text("status", { enum: ["draft", "active", "consumed", "expired", "revoked", "exhausted"] })
      .notNull()
      .default("draft"),
    nonce: text("nonce").notNull(),
    notBefore: ts("not_before"),
    notAfter: ts("not_after"),
    revokedAt: ts("revoked_at"),
    revokedReason: text("revoked_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("mandates_type_nonce_uq").on(t.type, t.nonce),
    index("mandates_parent_idx").on(t.parentId),
    index("mandates_status_idx").on(t.status),
  ],
);

export const mandateChecks = pgTable(
  "mandate_checks",
  {
    id: text("id").primaryKey(),
    mandateId: text("mandate_id").notNull(),
    gate: text("gate", { enum: ["G1", "G2", "G3", "G4"] }).notNull(),
    action: text("action").notNull(),
    result: text("result", { enum: ["allow", "deny", "step_up"] }).notNull(),
    reasonCodes: text("reason_codes").array().notNull(),
    message: text("message").notNull(),
    requestRef: text("request_ref"),
    createdAt: createdAt(),
  },
  (t) => [index("mandate_checks_mandate_idx").on(t.mandateId)],
);

export const spendCounters = pgTable(
  "spend_counters",
  {
    id: text("id").primaryKey(),
    intentMandateId: text("intent_mandate_id").notNull().references(() => mandates.id),
    day: text("day").notNull(), // YYYY-MM-DD (UTC, from ClockPort)
    spentMinor: money("spent_minor").notNull().default(0),
    jobsCount: integer("jobs_count").notNull().default(0),
    version: integer("version").notNull().default(0),
  },
  (t) => [
    uniqueIndex("spend_counters_mandate_day_uq").on(t.intentMandateId, t.day),
    check("spend_nonneg", sql`${t.spentMinor} >= 0 and ${t.jobsCount} >= 0`),
  ],
);

export const attestations = pgTable(
  "attestations",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").notNull(),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    subjectId: text("subject_id").notNull(),
    payloadJson: jsonb("payload_json").notNull(),
    payloadHash: text("payload_hash").notNull(),
    signerRole: text("signer_role").notNull(),
    keyId: text("key_id").notNull(),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull().unique(),
    signature: text("signature").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("attestations_job_seq_uq").on(t.jobId, t.seq)],
);

export const complianceReports = pgTable("compliance_reports", {
  id: text("id").primaryKey(),
  disputeId: text("dispute_id").notNull().references(() => disputes.id),
  jobId: text("job_id").notNull().references(() => jobs.id),
  resultJson: jsonb("result_json").notNull(),
  createdAt: createdAt(),
});

// Managed demo keys (KEY_MODE managed/both). Private JWK encrypted at rest with AES-256-GCM; never plaintext.
export const managedKeys = pgTable("managed_keys", {
  keyId: text("key_id").primaryKey().references(() => signingKeys.id),
  ownerType: text("owner_type", { enum: ["user", "client"] }).notNull(),
  ownerId: text("owner_id").notNull().unique(),
  encryptedPrivateJwk: text("encrypted_private_jwk").notNull(), // base64(iv || ciphertext+tag)
  createdAt: createdAt(),
});

// ---- Hardening 2026-10 (migration 0002, additive only) -------------------------------------------

// Transactional outbox: side effects (webhook re-dispatch, payout retries) are written in the same database
// transaction as the state change, then run by the outbox worker with backoff + jitter. `dedupe_key` makes
// enqueueing idempotent. Rows that exhaust their attempts move to dead_letters.
export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: text("id").primaryKey(),
    topic: text("topic").notNull(), // webhook.redispatch | payout.retry
    dedupeKey: text("dedupe_key").notNull().unique(),
    payload: jsonb("payload").notNull(),
    status: text("status", { enum: ["pending", "done", "dead"] }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(6),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow().$defaultFn(timeSourceNow),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("outbox_due_idx").on(t.status, t.availableAt), check("outbox_attempts", sql`${t.attempts} >= 0 and ${t.maxAttempts} > 0`)],
);

export const deadLetters = pgTable("dead_letters", {
  id: text("id").primaryKey(),
  outboxId: text("outbox_id").notNull().unique(),
  topic: text("topic").notNull(),
  payload: jsonb("payload").notNull(),
  attempts: integer("attempts").notNull(),
  lastError: text("last_error"),
  resolvedAt: ts("resolved_at"),
  createdAt: createdAt(),
});

// Offline evaluation runs (pnpm eval:generated). Synthetic scenarios only; no production data.
export const evalRuns = pgTable("eval_runs", {
  id: text("id").primaryKey(), // same id as results/runs/<run_id>
  gitSha: text("git_sha").notNull(),
  datasetHash: text("dataset_hash").notNull(),
  seed: integer("seed").notNull(),
  variant: text("variant").notNull(), // ai | rules_only
  llm: text("llm").notNull(),
  scenarios: integer("scenarios").notNull(),
  metricsJson: jsonb("metrics_json").notNull(),
  startedAt: ts("started_at").notNull(),
  finishedAt: ts("finished_at").notNull(),
});

export const evalResults = pgTable(
  "eval_results",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => evalRuns.id),
    scenarioId: text("scenario_id").notNull(),
    family: text("family").notNull(),
    pass: boolean("pass").notNull(),
    decision: text("decision"),
    latencyMs: doublePrecision("latency_ms"),
    detailJson: jsonb("detail_json"),
  },
  (t) => [uniqueIndex("eval_results_run_scenario").on(t.runId, t.scenarioId)],
);
