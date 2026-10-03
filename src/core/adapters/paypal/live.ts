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

/**
 * Live PayPal sandbox adapter. Implemented in task T101/T102 after each endpoint is VERIFIED
 * against official PayPal docs (findings go in docs/paypal-notes.md). Until then the app runs in MOCK mode.
 */
export class PayPalAdapter implements PaymentsPort {
  readonly mode = "LIVE" as const;

  constructor(
    private readonly opts: { clientId: string; clientSecret: string; env: "sandbox" | "live"; webhookId?: string },
  ) {}

  private notYet(method: string): never {
    throw new Error(`PayPalAdapter.${method} is not implemented yet (task T101/T102). Run in MOCK mode.`);
  }

  createOrder(_input: CreateOrderInput): Promise<OrderResult> {
    return this.notYet("createOrder");
  }
  captureOrder(_orderId: string, _requestId: string): Promise<CaptureResult> {
    return this.notYet("captureOrder");
  }
  createPayout(_input: CreatePayoutInput): Promise<PayoutResult> {
    return this.notYet("createPayout");
  }
  getPayout(_itemId: string): Promise<PayoutResult> {
    return this.notYet("getPayout");
  }
  refundCapture(_input: RefundInput): Promise<RefundResult> {
    return this.notYet("refundCapture");
  }
  verifyWebhook(_headers: Record<string, string>, _body: string): Promise<WebhookEvent | null> {
    return this.notYet("verifyWebhook");
  }
}
