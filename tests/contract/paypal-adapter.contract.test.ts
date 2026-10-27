// Adapter contract tests: the live PayPal adapter and the mock satisfy the same PaymentsPort contract.
// The live side runs ONLY against fixture responses (tests/fixtures/paypal) through an injected fetch;
// the test fails if any request would leave the process. No real PayPal call is ever made.
import { describe, expect, it } from "vitest";
import fixtures from "../fixtures/paypal/fixtures.json";
import { MockPayPalAdapter, MOCK_WEBHOOK_HEADER } from "@/core/adapters/paypal/mock";
import { PayPalAdapter, PayPalApiError } from "@/core/adapters/paypal/live";
import type { PaymentsPort, PayoutItemStatus } from "@/core/ports/payments";

type Fixture = { status: number; body: unknown };
const FX = fixtures as Record<string, Fixture>;
const PAYOUT_STATUSES: PayoutItemStatus[] = ["PENDING", "SUCCEEDED", "UNCLAIMED", "FAILED", "BLOCKED", "RETURNED", "ONHOLD", "REFUNDED", "REVERSED"];

interface Recorded {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: unknown;
}

/** fetch replacement that answers from fixtures and records every request. Unknown routes throw. */
function replayFetch(overrides: Record<string, Fixture> = {}) {
  const calls: Recorded[] = [];
  const impl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname !== "api-m.sandbox.paypal.com") throw new Error(`blocked network call to ${url.hostname}`);
    const key = `${init?.method ?? "GET"} ${url.pathname}`;
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    let body: unknown;
    if (typeof init?.body === "string") body = headers["content-type"]?.includes("json") ? JSON.parse(init.body) : init.body;
    calls.push({ method: init?.method ?? "GET", path: url.pathname, headers, body });
    expect(init?.signal, `${key} must carry a timeout signal`).toBeInstanceOf(AbortSignal);
    const fx = overrides[key] ?? FX[key];
    if (!fx) throw new Error(`no fixture for ${key}`);
    return new Response(JSON.stringify(fx.body), { status: fx.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { impl, calls };
}

function live(overrides?: Record<string, Fixture>) {
  const f = replayFetch(overrides);
  const adapter = new PayPalAdapter({ clientId: "fixture-id", clientSecret: "fixture-secret", env: "sandbox", webhookId: "WH-FIXTURE", fetchImpl: f.impl });
  return { adapter, calls: f.calls };
}

const ORDER = { requestId: "fund_job1_1", amountMinor: 10200, currency: "USD" as const, customId: "smd_job1_abc", invoiceId: "fnd_fixture", description: "SettleAI escrow" };
const PAYOUT = { requestId: "rel_rel1", senderBatchId: "rel1", senderItemId: "rel1", receiverEmail: "asha@example.com", amountMinor: 4000, currency: "USD" as const, note: "milestone 1" };

/** The shared contract, run against both adapters. */
function contract(name: string, make: () => { port: PaymentsPort; approve?: (orderId: string) => void; refundCaptureId?: (c: string) => string }) {
  describe(`PaymentsPort contract: ${name}`, () => {
    it("createOrder returns an id, a CREATED status and an approve link", async () => {
      const { port } = make();
      const o = await port.createOrder(ORDER);
      expect(o.orderId).toMatch(/\S+/);
      expect(o.status).toBe("CREATED");
      expect(o.approveUrl).toMatch(/approve|checkoutnow/);
    });

    it("captureOrder returns a COMPLETED capture whose amount is integer minor units", async () => {
      const { port, approve } = make();
      const o = await port.createOrder(ORDER);
      approve?.(o.orderId);
      const c = await port.captureOrder(o.orderId, "cap_job1_1");
      expect(c.captureId).toMatch(/\S+/);
      expect(c.status).toBe("COMPLETED");
      expect(Number.isSafeInteger(c.amountMinor)).toBe(true);
      expect(c.amountMinor).toBe(10200);
    });

    it("createPayout returns a batch id and a status from the internal enum", async () => {
      const { port } = make();
      const p = await port.createPayout(PAYOUT);
      expect(p.batchId).toMatch(/\S+/);
      expect(PAYOUT_STATUSES).toContain(p.status);
    });

    it("refundCapture returns a refund id and a known status", async () => {
      const { port, approve } = make();
      const o = await port.createOrder(ORDER);
      approve?.(o.orderId);
      const c = await port.captureOrder(o.orderId, "cap_job1_1");
      const r = await port.refundCapture({ requestId: "ref_rfd1", captureId: c.captureId, amountMinor: 1000, currency: "USD", invoiceId: "fnd_fixture", noteToPayer: "partial" });
      expect(r.refundId).toMatch(/\S+/);
      expect(["COMPLETED", "PENDING", "FAILED", "CANCELLED"]).toContain(r.status);
    });

    it("verifyWebhook rejects an unsigned event (returns null, never throws)", async () => {
      const { port } = make();
      expect(await port.verifyWebhook({}, JSON.stringify({ id: "WH-1", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: {} }))).toBeNull();
    });
  });
}

contract("MockPayPalAdapter", () => {
  const m = new MockPayPalAdapter();
  return { port: m, approve: (id) => m.approveOrder(id) };
});
contract("PayPalAdapter (fixtures only)", () => ({ port: live().adapter }));

describe("PayPalAdapter wire format (fixtures only)", () => {
  it("sends PayPal-Request-Id, bearer auth, and decimal amounts on every money write", async () => {
    const { adapter, calls } = live();
    await adapter.createOrder(ORDER);
    await adapter.createPayout(PAYOUT);
    await adapter.refundCapture({ requestId: "ref_rfd1", captureId: "3C679366HH908993F", amountMinor: 1005, currency: "USD", invoiceId: "fnd_fixture", noteToPayer: "x".repeat(400) });
    const writes = calls.filter((c) => c.path !== "/v1/oauth2/token");
    expect(writes.map((c) => c.headers["paypal-request-id"])).toEqual(["fund_job1_1", "rel_rel1", "ref_rfd1"]);
    for (const w of writes) expect(w.headers.authorization).toBe("Bearer A21AA-fixture-token");
    expect((writes[0].body as { purchase_units: { amount: { value: string } }[] }).purchase_units[0].amount.value).toBe("102.00");
    const payout = writes[1].body as { sender_batch_header: { sender_batch_id: string }; items: { amount: { value: string }; sender_item_id: string }[] };
    expect(payout.sender_batch_header.sender_batch_id).toBe("rel1");
    expect(payout.items[0]).toMatchObject({ sender_item_id: "rel1", amount: { value: "40.00" } });
    const refund = writes[2].body as { amount: { value: string }; note_to_payer: string };
    expect(refund.amount.value).toBe("10.05");
    expect(refund.note_to_payer).toHaveLength(255);
    // The OAuth token is cached: one token call for three writes.
    expect(calls.filter((c) => c.path === "/v1/oauth2/token")).toHaveLength(1);
  });

  it("maps payout item SUCCESS to SUCCEEDED and verifies a signed webhook through PayPal", async () => {
    const { adapter } = live();
    expect((await adapter.getPayoutItem("8AELMXH8UB2P8")).status).toBe("SUCCEEDED");
    const signed = {
      "paypal-auth-algo": "SHA256withRSA",
      "paypal-cert-url": "https://api-m.sandbox.paypal.com/v1/notifications/certs/CERT-fixture",
      "paypal-transmission-id": "t1",
      "paypal-transmission-sig": "sig",
      "paypal-transmission-time": "2026-10-27T00:00:00Z",
    };
    const evt = await adapter.verifyWebhook(signed, JSON.stringify({ id: "WH-1", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "3C679366HH908993F" } }));
    expect(evt).toMatchObject({ id: "WH-1", eventType: "PAYMENT.CAPTURE.COMPLETED" });
    const { adapter: failing } = live({ "POST /v1/notifications/verify-webhook-signature": { status: 200, body: { verification_status: "FAILURE" } } });
    expect(await failing.verifyWebhook(signed, JSON.stringify({ id: "WH-2", event_type: "X", resource: {} }))).toBeNull();
  });

  it("classifies 4xx as non-retryable and 5xx as retryable PayPalApiError", async () => {
    const { adapter: bad } = live({ "POST /v1/payments/payouts": FX["error:422"] });
    const e422 = await bad.createPayout(PAYOUT).catch((e) => e);
    expect(e422).toBeInstanceOf(PayPalApiError);
    expect(e422).toMatchObject({ status: 422, issue: "INSTRUMENT_DECLINED", retryable: false });
    const { adapter: down } = live({ "POST /v1/payments/payouts": FX["error:503"] });
    const e503 = await down.createPayout(PAYOUT).catch((e) => e);
    expect(e503).toMatchObject({ status: 503, retryable: true });
  });

  it("documented divergence: live payouts start PENDING (status via webhook), the mock settles synchronously", async () => {
    const { adapter } = live();
    expect((await adapter.createPayout(PAYOUT)).status).toBe("PENDING");
    expect((await new MockPayPalAdapter().createPayout(PAYOUT)).status).toBe("SUCCEEDED");
  });

  it("the mock enforces the same idempotency contract as PayPal-Request-Id", async () => {
    const m = new MockPayPalAdapter();
    const a = await m.createPayout(PAYOUT);
    const b = await m.createPayout(PAYOUT);
    expect(b).toEqual(a);
    expect(await m.verifyWebhook({ [MOCK_WEBHOOK_HEADER]: "1" }, JSON.stringify({ id: "x", event_type: "y", resource: {} }))).not.toBeNull();
  });
});
