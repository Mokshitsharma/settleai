// PaymentsPort: the only interface through which money moves. Implemented by PayPalAdapter (live)
// and MockPayPalAdapter. Only TreasuryService and FundingService may call the write methods.
// Shapes verified against PayPal docs and OpenAPI specs: see docs/paypal-notes.md.

export interface CreateOrderInput {
  requestId: string; // deterministic PayPal-Request-Id, e.g. fund_{jobId}_{attempt}
  amountMinor: number;
  currency: "USD";
  customId: string; // smd_<jobShortId>_<16 hex of PaymentMandate hash> (≤255 chars)
  invoiceId: string; // funding id (≤127 chars, unique per merchant)
  description: string;
}

export interface OrderResult {
  orderId: string;
  status: "CREATED" | "APPROVED" | "COMPLETED" | "PAYER_ACTION_REQUIRED" | "SAVED" | "VOIDED";
  approveUrl?: string;
  raw: unknown;
}

export interface CaptureResult {
  orderId: string;
  captureId: string;
  status: "COMPLETED" | "DECLINED" | "PARTIALLY_REFUNDED" | "PENDING" | "REFUNDED" | "FAILED";
  amountMinor: number;
  raw: unknown;
}

export interface CreatePayoutInput {
  requestId: string; // rel_{releaseId}
  senderBatchId: string; // release id (≤256), PayPal's idempotency key for batches
  senderItemId: string; // release id (≤63)
  receiverEmail: string;
  amountMinor: number;
  currency: "USD";
  note: string;
}

/** Internal payout item status. The PayPal API says SUCCESS; adapters map it to SUCCEEDED. */
export type PayoutItemStatus =
  | "PENDING"
  | "SUCCEEDED"
  | "UNCLAIMED"
  | "FAILED"
  | "BLOCKED"
  | "RETURNED"
  | "ONHOLD"
  | "REFUNDED"
  | "REVERSED";

export const TERMINAL_PAYOUT_FAILURES: readonly PayoutItemStatus[] = ["FAILED", "BLOCKED", "RETURNED", "REVERSED"];

export interface PayoutResult {
  batchId: string;
  itemId?: string; // may be absent until the batch is processed
  status: PayoutItemStatus;
  failureReason?: string;
  raw: unknown;
}

export interface RefundInput {
  requestId: string; // ref_{refundId}
  captureId: string;
  amountMinor: number;
  currency: "USD";
  invoiceId: string;
  noteToPayer: string; // ≤255 chars
}

export interface RefundResult {
  refundId: string;
  status: "COMPLETED" | "PENDING" | "FAILED" | "CANCELLED";
  raw: unknown;
}

export interface WebhookEvent {
  id: string;
  eventType: string;
  resource: Record<string, unknown>;
  raw: unknown;
}

export interface PaymentsPort {
  readonly mode: "MOCK" | "LIVE";
  createOrder(input: CreateOrderInput): Promise<OrderResult>;
  captureOrder(orderId: string, requestId: string): Promise<CaptureResult>;
  createPayout(input: CreatePayoutInput): Promise<PayoutResult>;
  getPayoutItem(itemId: string): Promise<PayoutResult>;
  refundCapture(input: RefundInput): Promise<RefundResult>;
  /** Returns the parsed event only when the signature verifies; otherwise null. */
  verifyWebhook(headers: Record<string, string>, body: string): Promise<WebhookEvent | null>;
}

/** Minor units -> PayPal decimal string ("102.00"). */
export function toPayPalValue(minor: number): string {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new Error(`Invalid amount ${minor}`);
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;
}

/** PayPal decimal string -> minor units, without floating point. */
export function fromPayPalValue(value: string): number {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!m) throw new Error(`Invalid PayPal amount ${value}`);
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}
