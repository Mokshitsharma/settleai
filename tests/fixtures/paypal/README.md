Recorded-style PayPal REST responses used by `tests/contract/paypal-adapter.contract.test.ts`.

Provenance: these bodies follow the response shapes in the PayPal REST API reference (Orders v2, Payments v2,
Payouts v1, Notifications) as summarised in `docs/paypal-notes.md`. They were written by hand from that reference,
not captured from a live sandbox session (no sandbox credentials were used in this pass). Ids are fake.
The contract test replays them through an injected `fetch`, so the live adapter never reaches the network.
