# Phase 13 — Real POS Order Engine

This phase hardens the live Render/Neon/Cloudflare build for real POS billing behavior.

## Added / fixed

- Synchronous Neon-backed cloud-state persistence for order mutations.
- Real order-engine status endpoint: `/api/order-engine/status`.
- Order state validation before every API request.
- Dine-in table guard remains enforced: one active dine-in order per table.
- Paid orders remain locked against normal editing.
- Order lines are normalized on save/pay.
- Payment validation is stricter.
- Cash overpayment is converted to change, not revenue.
- Card and online overpayment is rejected.
- Table release is recorded after full payment.
- Audit/timeline events continue for create, hold, save, pay, void, refund, reopen and payment correction.

## Production checks

Use the Render URL:

```text
/api/health
/api/env-check
/api/order-engine/status
```

Expected:

```text
store = postgresql-cloud-state
oneTableOneActiveDineInOrder = true
paymentChangeCashOnly = true
synchronousPersistence = true
```
