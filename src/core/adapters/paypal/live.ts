// Live PayPal adapter (sandbox or live) using the REST API directly. Every endpoint, field and enum
// here was verified against official PayPal sources; see docs/paypal-notes.md.
import { z } from "zod";
import {
  fromPayPalValue,
  toPayPalValue,
  type CaptureResult,
  type CreateOrderInput,
  type CreatePayoutInput,
  type OrderResult,
  type PaymentsPort,
  type PayoutItemStatus,
  type PayoutResult,
  type RefundInput,
  type RefundResult,
  type WebhookEvent,
} from "@/core/ports/payments";

const BASE_URLS = { sandbox: "https://api-m.sandbox.paypal.com", live: "https://api-m.paypal.com" } as const;

export class PayPalApiError extends Error {
  constructor(
    readonly status: number,
    readonly issue: string,
    readonly debugId?: string,
  ) {
    super(`PayPal API ${status}: ${issue}${debugId ? ` (debug_id ${debugId})` : ""}`);
  }
  /** 5xx and network errors are retryable; 4xx validation errors are not (spec §6.4). */
  get retryable(): boolean {
    return this.status >= 500 || this.status === 429;
  }
}

const TokenResponse = z.object({ access_token: z.string(), expires_in: z.number() });
const Link = z.object({ href: z.string(), rel: z.string() });
const OrderResponse = z.object({ id: z.string(), status: z.string(), links: z.array(Link).optional() });
const CaptureResponse = z.object({
  id: z.string(),
  purchase_units: z.array(
    z.object({
      payments: z
        .object({
          captures: z.array(z.object({ id: z.string(), status: z.string(), amount: z.object({ value: z.string() }) })).optional(),
        })
        .optional(),
    }),
  ),
});
const PayoutBatchResponse = z.object({
  batch_header: z.object({ payout_batch_id: z.string(), batch_status: z.string() }),
});
const PayoutItemResponse = z.object({
  payout_item_id: z.string(),
  payout_batch_id: z.string(),
  transaction_status: z.string(),
  errors: z.object({ name: z.string().optional(), message: z.string().optional() }).optional(),
});
const RefundResponse = z.object({ id: z.string(), status: z.enum(["COMPLETED", "PENDING", "FAILED", "CANCELLED"]) });
const VerifyResponse = z.object({ verification_status: z.enum(["SUCCESS", "FAILURE"]) });
const WebhookBody = z.object({ id: z.string(), event_type: z.string(), resource: z.record(z.string(), z.unknown()) });

/** PayPal transaction_status -> internal status. */
export function mapPayoutStatus(s: string): PayoutItemStatus {
  switch (s) {
    case "SUCCESS":
      return "SUCCEEDED";
    case "FAILED":
    case "PENDING":
    case "UNCLAIMED":
    case "RETURNED":
    case "ONHOLD":
    case "BLOCKED":
    case "REFUNDED":
    case "REVERSED":
      return s;
    default:
      return "PENDING"; // unknown or not-yet-processed (e.g. NEW) stays pending; reconciliation follows up
  }
}

export interface PayPalAdapterOptions {
  clientId: string;
  clientSecret: string;
  env: "sandbox" | "live";
  webhookId?: string;
  fetchImpl?: typeof fetch;
}

export class PayPalAdapter implements PaymentsPort {
  readonly mode = "LIVE" as const;
  private token?: { value: string; expiresAt: number };
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: PayPalAdapterOptions) {
    this.base = BASE_URLS[opts.env];
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const basic = Buffer.from(`${this.opts.clientId}:${this.opts.clientSecret}`).toString("base64");
    const res = await this.fetchImpl(`${this.base}/v1/oauth2/token`, {
      method: "POST",
      headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new PayPalApiError(res.status, "OAUTH_FAILED");
    const body = TokenResponse.parse(await res.json());
    this.token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return body.access_token;
  }

  private async call(method: "GET" | "POST", path: string, body?: unknown, requestId?: string): Promise<unknown> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${await this.accessToken()}`,
      "content-type": "application/json",
      prefer: "return=representation",
    };
    if (requestId) headers["paypal-request-id"] = requestId;
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!res.ok) {
      const details = (json.details as { issue?: string }[] | undefined)?.[0]?.issue;
      throw new PayPalApiError(res.status, String(details ?? json.name ?? json.error ?? "UNKNOWN"), json.debug_id as string | undefined);
    }
    return json;
  }

  async createOrder(input: CreateOrderInput): Promise<OrderResult> {
    const raw = await this.call(
      "POST",
      "/v2/checkout/orders",
      {
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: input.invoiceId,
            custom_id: input.customId,
            invoice_id: input.invoiceId,
            description: input.description.slice(0, 127),
            amount: { currency_code: input.currency, value: toPayPalValue(input.amountMinor) },
          },
        ],
      },
      input.requestId,
    );
    const order = OrderResponse.parse(raw);
    const approve = order.links?.find((l) => l.rel === "approve" || l.rel === "payer-action");
    return { orderId: order.id, status: order.status as OrderResult["status"], approveUrl: approve?.href, raw };
  }

  async captureOrder(orderId: string, requestId: string): Promise<CaptureResult> {
    const raw = await this.call("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {}, requestId);
    const order = CaptureResponse.parse(raw);
    const capture = order.purchase_units[0]?.payments?.captures?.[0];
    if (!capture) throw new PayPalApiError(502, "CAPTURE_MISSING_IN_RESPONSE");
    return {
      orderId,
      captureId: capture.id,
      status: capture.status as CaptureResult["status"],
      amountMinor: fromPayPalValue(capture.amount.value),
      raw,
    };
  }

  async createPayout(input: CreatePayoutInput): Promise<PayoutResult> {
    const raw = await this.call(
      "POST",
      "/v1/payments/payouts",
      {
        sender_batch_header: { sender_batch_id: input.senderBatchId, email_subject: "You have a payment from SettleAI" },
        items: [
          {
            recipient_type: "EMAIL",
            receiver: input.receiverEmail,
            sender_item_id: input.senderItemId,
            note: input.note,
            amount: { currency: input.currency, value: toPayPalValue(input.amountMinor) },
          },
        ],
      },
      input.requestId,
    );
    const batch = PayoutBatchResponse.parse(raw);
    // Batch creation is asynchronous: the item id and final status arrive via webhook or polling.
    return { batchId: batch.batch_header.payout_batch_id, status: batch.batch_header.batch_status === "DENIED" ? "FAILED" : "PENDING", raw };
  }

  async getPayoutItem(itemId: string): Promise<PayoutResult> {
    const raw = await this.call("GET", `/v1/payments/payouts-item/${encodeURIComponent(itemId)}`);
    const item = PayoutItemResponse.parse(raw);
    return {
      batchId: item.payout_batch_id,
      itemId: item.payout_item_id,
      status: mapPayoutStatus(item.transaction_status),
      failureReason: item.errors?.name ?? item.errors?.message,
      raw,
    };
  }

  async refundCapture(input: RefundInput): Promise<RefundResult> {
    const raw = await this.call(
      "POST",
      `/v2/payments/captures/${encodeURIComponent(input.captureId)}/refund`,
      {
        amount: { currency_code: input.currency, value: toPayPalValue(input.amountMinor) },
        invoice_id: input.invoiceId,
        note_to_payer: input.noteToPayer.slice(0, 255),
      },
      input.requestId,
    );
    const refund = RefundResponse.parse(raw);
    return { refundId: refund.id, status: refund.status, raw };
  }

  async verifyWebhook(headers: Record<string, string>, body: string): Promise<WebhookEvent | null> {
    if (!this.opts.webhookId) throw new Error("PAYPAL_WEBHOOK_ID is required to verify webhooks in LIVE mode");
    const h = (name: string) => headers[name] ?? headers[name.toLowerCase()];
    const required = ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"];
    if (required.some((n) => !h(n))) return null;
    const event = WebhookBody.safeParse(JSON.parse(body));
    if (!event.success) return null;
    const raw = await this.call("POST", "/v1/notifications/verify-webhook-signature", {
      auth_algo: h("paypal-auth-algo"),
      cert_url: h("paypal-cert-url"),
      transmission_id: h("paypal-transmission-id"),
      transmission_sig: h("paypal-transmission-sig"),
      transmission_time: h("paypal-transmission-time"),
      webhook_id: this.opts.webhookId,
      webhook_event: JSON.parse(body),
    });
    if (VerifyResponse.parse(raw).verification_status !== "SUCCESS") return null;
    return { id: event.data.id, eventType: event.data.event_type, resource: event.data.resource, raw: event.data };
  }
}
