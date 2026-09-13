# Phase 16 — Operational Audit Fixes

This phase addresses real cashier/admin testing problems found after production Render/Neon/R2 deployment.

## Fixes

- Item/deal price is mandatory for billing.
- POS cards with Rs 0 are disabled and marked `SET PRICE`.
- Admin item/deal editor has a required Sale Price field with min 1.
- Payment modal cannot open if total is zero.
- Backend rejects item/deal records with missing or zero price.
- Backend rejects Rs 0 payments and zero-total orders.
- Empty orders cannot be held, paid, listed as open, or counted as busy table.
- Loading indicator is lightweight and fast but still blocks duplicate rapid action during cloud save.
- Hardcoded logo image is removed from login shell; business logo is only Admin Settings driven after login.

## Real test

1. Add category.
2. Add item with Sale Price > 0.
3. Create dine-in order.
4. Add item.
5. Verify right bill total updates instantly.
6. Pay order and verify receipt total.
7. Add zero price item attempt should be blocked.
