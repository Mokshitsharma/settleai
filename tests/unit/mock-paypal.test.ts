import { describe, expect, it } from "vitest";
import { MOCK_WEBHOOK_HEADER, MockPayPalAdapter } from "@/core/adapters/paypal/mock";
import { loadConfig } from "@/core/config";

const order = { amountMinor: 10200, currency: "USD" as const, customId: "smd_job1_0123456789abcdef", invoiceId: "fund_1", description: "Job" };

describe("MockPayPalAdapter", () => {
  it("funds, pays out and refunds with deterministic ids and webhook events", async () => {
    const pp = new MockPayPalAdapter();
    const o = await pp.createOrder({ ...order, requestId: "fund_job1_1" });
    expect(o.orderId).toBe("MOCK-ORD-0001");
    await expect(pp.captureOrder(o.orderId, "cap_1")).rejects.toThrow(/NOT_APPROVED/);
    pp.approveOrder(o.orderId);
    const cap = await pp.captureOrder(o.orderId, "cap_1");
    expect(cap.status).toBe("COMPLETED");

    const payout = await pp.createPayout({
      requestId: "rel_1", senderBatchId: "rel_1", senderItemId: "rel_1",
      receiverEmail: "asha@example.com", amountMinor: 4000, currency: "USD", note: "Milestone 1",
    });
    expect(payout.status).toBe("SUCCEEDED");
    await pp.refundCapture({ requestId: "ref_1", captureId: cap.captureId, amountMinor: 2000, currency: "USD", invoiceId: "fund_1", noteToPayer: "x" });
    await expect(
      pp.refundCapture({ requestId: "ref_2", captureId: cap.captureId, amountMinor: 9000, currency: "USD", invoiceId: "fund_1", noteToPayer: "x" }),
    ).rejects.toThrow(/REFUND_AMOUNT_EXCEEDED/);

    expect(pp.drainOutbox().map((e) => e.eventType)).toEqual([
      "CHECKOUT.ORDER.APPROVED",
      "PAYMENT.CAPTURE.COMPLETED",
      "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
      "PAYMENT.CAPTURE.REFUNDED",
    ]);
  });

  it("same PayPal-Request-Id returns the same result (no double payout)", async () => {
    const pp = new MockPayPalAdapter();
    const input = { requestId: "rel_9", senderBatchId: "rel_9", senderItemId: "rel_9", receiverEmail: "a@b.c", amountMinor: 100, currency: "USD" as const, note: "" };
    const a = await pp.createPayout(input);
    const b = await pp.createPayout(input);
    expect(b).toBe(a);
    expect(pp.drainOutbox()).toHaveLength(1);
  });

  it("failure injection is deterministic", async () => {
    const run = async () => {
      const pp = new MockPayPalAdapter({ payoutFailRate: 0.5 });
      const out = [];
      for (let i = 0; i < 20; i++) {
        out.push((await pp.createPayout({ requestId: `rel_${i}`, senderBatchId: "b", senderItemId: `s${i}`, receiverEmail: "a@b.c", amountMinor: 1, currency: "USD", note: "" })).status);
      }
      return out;
    };
    const first = await run();
    expect(await run()).toEqual(first);
    expect(first).toContain("FAILED");
    expect(first).toContain("SUCCEEDED");
  });

  it("rejects webhooks without the mock signature header", async () => {
    const pp = new MockPayPalAdapter();
    const body = JSON.stringify({ id: "e1", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: {} });
    expect(await pp.verifyWebhook({}, body)).toBeNull();
    expect(await pp.verifyWebhook({ [MOCK_WEBHOOK_HEADER]: "1" }, body)).toMatchObject({ id: "e1" });
  });
});

describe("config", () => {
  it("defaults to MOCK and the stub LLM with zero keys", () => {
    const cfg = loadConfig({});
    expect(cfg.mode).toBe("MOCK");
    expect(cfg.llmProvider).toBe("stub");
  });

  it("selects xAI when an xAI key is present, and stays MOCK without PayPal keys", () => {
    const cfg = loadConfig({ XAI_API_KEY: "xai-test" });
    expect(cfg.llmProvider).toBe("xai");
    expect(cfg.llmModel).toBe("grok-4.7");
    expect(cfg.mode).toBe("MOCK");
  });

  it("goes LIVE only when PayPal keys are present", () => {
    expect(loadConfig({ PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "s" }).mode).toBe("LIVE");
    expect(loadConfig({ PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "s", APP_MODE: "MOCK" }).mode).toBe("MOCK");
  });
});
