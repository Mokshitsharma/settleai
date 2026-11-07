import { sha256Hex } from "@/core/mandates/canonical";
import { toPayPalValue } from "@/core/ports/payments";
import type {
  CaptureResult,
  CreateOrderInput,
  CreatePayoutInput,
  OrderResult,
  PaymentsPort,
  PayoutResult,
  RefundInput,
  RefundResult,
  WebhookEvent,
} from "@/core/ports/payments";

export interface MockPayPalOptions {
  payoutFailRate?: number; // 0..1, decided deterministically from the request id
  captureDelayMs?: number;
  /** Prefix that keeps ids unique across processes sharing one database (seed script vs app). */
  idTag?: string;
  /** PayPal's fees to simulate; off by default. */
  fees?: { captureMinor?: number; captureBps?: number; captureFixedMinor?: number; payoutMinor?: number };
}

export const MOCK_WEBHOOK_HEADER = "x-settleai-mock-webhook";

/**
 * Deterministic in-memory PayPal. Same request id => same response (mirrors PayPal-Request-Id
 * idempotency). Every state change is also queued as the webhook event the live system would receive.
 */
export class MockPayPalAdapter implements PaymentsPort {
  readonly mode = "MOCK" as const;
  private counter = 0;
  private byRequestId = new Map<string, unknown>();
  private orders = new Map<string, { amountMinor: number; status: OrderResult["status"]; captureId?: string }>();
  private captures = new Map<string, { amountMinor: number; refundedMinor: number }>();
  private payouts = new Map<string, PayoutResult>();
  readonly outbox: WebhookEvent[] = [];

  constructor(private readonly options: MockPayPalOptions = {}) {}

  private nextId(prefix: string): string {
    this.counter += 1;
    return `MOCK-${prefix}-${this.options.idTag ?? ""}${String(this.counter).padStart(4, "0")}`;
  }

  private idempotent<T>(requestId: string, fn: () => T): T {
    if (this.byRequestId.has(requestId)) return this.byRequestId.get(requestId) as T;
    const result = fn();
    this.byRequestId.set(requestId, result);
    return result;
  }

  private emit(eventType: string, resource: Record<string, unknown>): void {
    const event = { id: this.nextId("EVT"), eventType, resource, raw: { event_type: eventType, resource } };
    this.outbox.push(event);
  }

  private captureFee(amountMinor: number): number | undefined {
    const f = this.options.fees;
    if (!f) return undefined;
    if (f.captureMinor !== undefined) return f.captureMinor;
    return f.captureBps === undefined ? undefined : Math.round((amountMinor * f.captureBps) / 10000) + (f.captureFixedMinor ?? 0);
  }

  /** Remove and return queued webhook events (used by /api/dev/simulate-webhook and tests). */
  drainOutbox(): WebhookEvent[] {
    return this.outbox.splice(0, this.outbox.length);
  }

  async createOrder(input: CreateOrderInput): Promise<OrderResult> {
    return this.idempotent(input.requestId, () => {
      const orderId = this.nextId("ORD");
      this.orders.set(orderId, { amountMinor: input.amountMinor, status: "CREATED" });
      return { orderId, status: "CREATED" as const, approveUrl: `/mock-paypal/approve/${orderId}`, raw: { mock: true, input } };
    });
  }

  /** Simulates the buyer clicking Approve in the PayPal popup. */
  approveOrder(orderId: string): void {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`Unknown mock order ${orderId}`);
    if (order.status === "CREATED") {
      order.status = "APPROVED";
      this.emit("CHECKOUT.ORDER.APPROVED", { id: orderId });
    }
  }

  async captureOrder(orderId: string, requestId: string): Promise<CaptureResult> {
    if (this.options.captureDelayMs) await new Promise((r) => setTimeout(r, this.options.captureDelayMs));
    return this.idempotent(requestId, () => {
      const order = this.orders.get(orderId);
      if (!order) throw new Error(`Unknown mock order ${orderId}`);
      if (order.status !== "APPROVED") throw new Error(`ORDER_NOT_APPROVED: ${orderId} is ${order.status}`);
      const captureId = this.nextId("CAP");
      order.status = "COMPLETED";
      order.captureId = captureId;
      this.captures.set(captureId, { amountMinor: order.amountMinor, refundedMinor: 0 });
      this.emit("PAYMENT.CAPTURE.COMPLETED", {
        id: captureId,
        amount: { value: (order.amountMinor / 100).toFixed(2), currency_code: "USD" },
        supplementary_data: { related_ids: { order_id: orderId } },
        ...(this.captureFee(order.amountMinor) !== undefined ? { seller_receivable_breakdown: { paypal_fee: { value: toPayPalValue(this.captureFee(order.amountMinor)!) } } } : {}),
      });
      return { orderId, captureId, status: "COMPLETED" as const, amountMinor: order.amountMinor, raw: { mock: true } };
    });
  }

  async createPayout(input: CreatePayoutInput): Promise<PayoutResult> {
    return this.idempotent(input.requestId, () => {
      const batchId = this.nextId("BATCH");
      const itemId = this.nextId("ITEM");
      const fail = this.shouldFail(input.requestId);
      const result: PayoutResult = fail
        ? { batchId, itemId, status: "FAILED", failureReason: "MOCK_INJECTED_FAILURE", raw: { mock: true } }
        : { batchId, itemId, status: "SUCCEEDED", paypalFeeMinor: this.options.fees?.payoutMinor, raw: { mock: true } };
      this.payouts.set(itemId, result);
      this.emit(fail ? "PAYMENT.PAYOUTS-ITEM.FAILED" : "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", {
        payout_item_id: itemId,
        payout_batch_id: batchId,
        payout_item: { sender_item_id: input.senderItemId },
        // Real PayPal wording: the event is ...SUCCEEDED but the status field says SUCCESS.
        transaction_status: fail ? "FAILED" : "SUCCESS",
        ...(this.options.fees?.payoutMinor !== undefined && !fail ? { payout_item_fee: { value: toPayPalValue(this.options.fees.payoutMinor) } } : {}),
      });
      return result;
    });
  }

  /** Failure injection (spec §6.6): make PayPal report a different item status, e.g. a late RETURNED. */
  forcePayoutStatus(itemId: string, status: PayoutResult["status"]): void {
    const payout = this.payouts.get(itemId);
    if (!payout) throw new Error(`Unknown mock payout item ${itemId}`);
    this.payouts.set(itemId, { ...payout, status });
  }

  async getPayoutItem(itemId: string): Promise<PayoutResult> {
    const payout = this.payouts.get(itemId);
    if (!payout) throw Object.assign(new Error(`Unknown mock payout item ${itemId}`), { retryable: false }); // like PayPal's 404: not an outage
    return payout;
  }

  async getPayoutBatch(batchId: string): Promise<PayoutResult> {
    for (const payout of this.payouts.values()) if (payout.batchId === batchId) return payout;
    throw Object.assign(new Error(`Unknown mock payout batch ${batchId}`), { retryable: false });
  }

  async getCapture(captureId: string) {
    const capture = this.captures.get(captureId);
    if (!capture) throw Object.assign(new Error(`Unknown mock capture ${captureId}`), { retryable: false });
    return { captureId, status: "COMPLETED", amountMinor: capture.amountMinor, paypalFeeMinor: this.captureFee(capture.amountMinor) };
  }

  async refundCapture(input: RefundInput): Promise<RefundResult> {
    return this.idempotent(input.requestId, () => {
      const capture = this.captures.get(input.captureId);
      if (!capture) throw new Error(`Unknown mock capture ${input.captureId}`);
      if (capture.refundedMinor + input.amountMinor > capture.amountMinor) {
        throw new Error("REFUND_AMOUNT_EXCEEDED: refund exceeds remaining captured amount");
      }
      capture.refundedMinor += input.amountMinor;
      const refundId = this.nextId("REF");
      this.emit("PAYMENT.CAPTURE.REFUNDED", { id: refundId, capture_id: input.captureId });
      return { refundId, status: "COMPLETED" as const, raw: { mock: true } };
    });
  }

  async verifyWebhook(headers: Record<string, string>, body: string): Promise<WebhookEvent | null> {
    // Mock events are only accepted with the mock header; the live adapter verifies PayPal signatures.
    if (headers[MOCK_WEBHOOK_HEADER] !== "1") return null;
    const parsed = JSON.parse(body) as { id: string; event_type: string; resource: Record<string, unknown> };
    return { id: parsed.id, eventType: parsed.event_type, resource: parsed.resource, raw: parsed };
  }

  private shouldFail(requestId: string): boolean {
    const rate = this.options.payoutFailRate ?? 0;
    if (rate <= 0) return false;
    const bucket = parseInt(sha256Hex(requestId).slice(0, 8), 16) / 0xffffffff;
    return bucket < rate;
  }
}
