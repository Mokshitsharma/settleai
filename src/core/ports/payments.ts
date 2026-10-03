// PaymentsPort: the only interface through which money moves. Implemented by PayPalAdapter (live)
// and MockPayPalAdapter. Only TreasuryService may call the write methods.

export interface CreateOrderInput {
  requestId: string; // deterministic PayPal-Request-Id, e.g. fund_{jobId}_{attempt}
  amountMinor: number;
  currency: "USD";
  customId: string; // smd_<jobShortId>_<16 hex of PaymentMandate hash>
  invoiceId: string; // funding id
  description: string;
}

export interface OrderResult {
  orderId: string;
  status: "CREATED" | "APPROVED" | "COMPLETED";
  approveUrl?: string;
  raw: unknown;
}

export interface CaptureResult {
  orderId: string;
  captureId: string;
  status: "COMPLETED" | "PENDING" | "DECLINED";
  amountMinor: number;
  raw: unknown;
}

export interface CreatePayoutInput {
  requestId: string; // rel_{releaseId}
  senderBatchId: string; // release id
  senderItemId: string; // release id
  receiverEmail: string;
  amountMinor: number;
  currency: "USD";
  note: string;
}

export type PayoutItemStatus = "PENDING" | "SUCCEEDED" | "UNCLAIMED" | "FAILED" | "BLOCKED" | "RETURNED";

export interface PayoutResult {
  batchId: string;
  itemId: string;
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
  noteToPayer: string;
}

export interface RefundResult {
  refundId: string;
  status: "COMPLETED" | "PENDING" | "FAILED";
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
  getPayout(itemId: string): Promise<PayoutResult>;
  refundCapture(input: RefundInput): Promise<RefundResult>;
  /** Returns the parsed event only when the signature verifies; otherwise null. */
  verifyWebhook(headers: Record<string, string>, body: string): Promise<WebhookEvent | null>;
}
