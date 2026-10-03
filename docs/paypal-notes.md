# PayPal integration notes

Every item marked VERIFY in docs/SPEC.md §6–7 is checked against official PayPal developer docs or
`@paypal/paypal-server-sdk` types before coding, and the result is recorded here.

Current mode: **MOCK** (no sandbox credentials yet). `MockPayPalAdapter` implements the full `PaymentsPort`.

| Item | Spec assumption | Verified? | Finding / source |
|---|---|---|---|
| Orders v2 create | POST /v2/checkout/orders, intent CAPTURE, custom_id, invoice_id | Pending (T101) | |
| Orders v2 capture | POST /v2/checkout/orders/{id}/capture | Pending (T101) | |
| custom_id length/charset | `smd_<jobShortId>_<16 hex>` fits | Pending (T101) | |
| PayPal-Request-Id idempotency | Same id returns same result | Pending (T101) | |
| Payouts | POST /v1/payments/payouts, sender_batch_id, sender_item_id | Pending (T102) | |
| Payouts enabled in sandbox business account | Unknown | Pending (owner setup) | |
| Refunds | POST /v2/payments/captures/{id}/refund (partial supported) | Pending (T102) | |
| Webhook event names | PAYMENT.CAPTURE.COMPLETED, PAYMENT.PAYOUTS-ITEM.* etc. | Pending (T101) | |
| Webhook signature verification | Verify-webhook-signature API or SDK helper | Pending (T101) | |
| UNCLAIMED payout behavior | Email without PayPal account | Pending (F36) | |
| Agent-presence field in sandbox | Probably not exposed | Pending | |
| `@paypal/agent-toolkit` availability | Concierge read tools | Pending (T302) | |
