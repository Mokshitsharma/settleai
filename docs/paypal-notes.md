# PayPal integration notes

Every item marked VERIFY in docs/SPEC.md §6–7 is checked against official PayPal sources before coding.
Sources used (2026-10-03):
- PayPal REST API reference pages on developer.paypal.com (Orders v2, Payments v2, Payouts v1, Webhooks v1, webhook event names)
- Official OpenAPI specs: github.com/paypal/paypal-rest-api-specifications (`openapi/checkout_orders_v2.json`, `payments_payment_v2.json`, `payments_payouts_batch_v1.json`, `notifications_webhooks_v1.json`)
- `@paypal/paypal-server-sdk` 2.5.0 (covers Orders and Payments only; **no Payouts and no webhook verification**, so the live adapter uses REST directly for consistency)

Current mode: **MOCK** (no sandbox credentials yet). `MockPayPalAdapter` mirrors the verified shapes below.

## Verified

| Item | Finding | Source |
|---|---|---|
| Base URLs | Sandbox `https://api-m.sandbox.paypal.com`, live `https://api-m.paypal.com` | REST API reference |
| OAuth | `POST /v1/oauth2/token`, Basic auth (client id:secret), `grant_type=client_credentials` | REST API reference, SDK oAuthAuthorizationController |
| Orders create | `POST /v2/checkout/orders`; `intent` enum `CAPTURE` / `AUTHORIZE`; amount `value` is a decimal string ("102.00") | Orders v2 reference + OpenAPI |
| Approve link | `links[]` entry with `rel: "approve"` (or `payer-action` when using payment_source) | Orders v2 reference |
| Orders capture | `POST /v2/checkout/orders/{id}/capture`; capture id at `purchase_units[].payments.captures[].id` | Orders v2 reference |
| Capture status enum | `COMPLETED, DECLINED, PARTIALLY_REFUNDED, PENDING, REFUNDED, FAILED` | OpenAPI `capture_status` |
| `custom_id` (orders) | 1–255 chars, any characters. `smd_<jobShortId>_<16 hex>` (~42 chars) fits; no fallback needed | OpenAPI `purchase_unit_request` |
| `invoice_id` (orders) | 1–127 chars; must be unique per merchant account by default → use the funding id | OpenAPI + SDK doc comment |
| `description` (orders) | up to 3000 accepted, truncated to 127 in responses | OpenAPI + SDK doc comment |
| Refund | `POST /v2/payments/captures/{capture_id}/refund`; partial refund by sending `amount`; `invoice_id` ≤127, `note_to_payer` ≤255; status enum `CANCELLED, FAILED, PENDING, COMPLETED` | Payments v2 reference + OpenAPI |
| Payouts create | `POST /v1/payments/payouts`; `sender_batch_header.sender_batch_id` ≤256 and acts as an idempotency key; item `sender_item_id` ≤63, `receiver` ≤127, `note` ≤4000 | Payouts v1 reference + OpenAPI |
| Payout item lookup | `GET /v1/payments/payouts-item/{payout_item_id}`; cancel unclaimed: `POST .../{id}/cancel` | Payouts v1 reference |
| **Payout item status** | `transaction_status` enum is `SUCCESS, FAILED, PENDING, UNCLAIMED, RETURNED, ONHOLD, BLOCKED, REFUNDED, REVERSED`. **Spec said `SUCCEEDED`: the API says `SUCCESS`.** Adapter maps `SUCCESS → SUCCEEDED` internally; `ONHOLD` is an extra state the spec did not list | OpenAPI `transaction_enum` |
| UNCLAIMED behavior | Recipient has no PayPal account; sign-up link emailed; funds return if not claimed within 30 days | OpenAPI enum descriptions |
| PayPal-Request-Id | Supported on Orders, Payments and Payouts for idempotency | API references + OpenAPI |
| Webhook verification | `POST /v1/notifications/verify-webhook-signature` with `auth_algo, cert_url, transmission_id, transmission_sig, transmission_time` (from headers `PAYPAL-AUTH-ALGO`, `PAYPAL-CERT-URL`, `PAYPAL-TRANSMISSION-ID`, `PAYPAL-TRANSMISSION-SIG`, `PAYPAL-TRANSMISSION-TIME`), `webhook_id`, `webhook_event`; response `verification_status` = `SUCCESS` or `FAILURE` | Webhooks v1 reference + OpenAPI |
| Webhook events (orders/captures) | `CHECKOUT.ORDER.APPROVED`, `CHECKOUT.ORDER.COMPLETED`, `PAYMENT.CAPTURE.COMPLETED / DECLINED / PENDING / REFUNDED / REVERSED` | Event names page |
| Webhook events (payouts) | Batch: `PAYMENT.PAYOUTSBATCH.DENIED / PROCESSING / SUCCESS`. Item: `PAYMENT.PAYOUTS-ITEM.BLOCKED / CANCELED / FAILED / HELD / REFUNDED / RETURNED / SUCCEEDED / UNCLAIMED` (note: the event says SUCCEEDED while the status field says SUCCESS) | Event names page |

## Still pending

| Item | Status |
|---|---|
| Payouts enabled on the sandbox business account | Needs owner's sandbox setup |
| Agent-presence field exposed in sandbox | Not found in Orders OpenAPI; keep internal |
| `@paypal/agent-toolkit` for Concierge read tools | Check in T302 |
| Live run of the adapter against sandbox | Needs credentials; contract tests are skipped without them |
