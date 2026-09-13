# Phase 39 — Discount, Cash and Button Visibility Guards

This phase fixes operational cash/discount issues reported during POS testing.

## Fixes

- Discount amount no longer carries over when switching between Rs and %.
- Switching discount type resets the value to 0 to prevent accidental discount mistakes.
- Fixed Rs discount is clamped to the current bill amount.
- Percent discount is clamped to 100%.
- Discount calculations are normalized on frontend and backend before save/pay/cart sync.
- Total payable cannot become negative.
- Payment modal uses freshly sanitized totals before payment.
- Card/online extra amount rules are preserved: exact payment only.
- Cash overpayment continues to become change, not revenue.
- Button label visibility improved on mobile and desktop.
- Compact buttons keep readable text without clipping important labels.

## Safety rules

- Rs discount max = current bill amount.
- Percent discount max = 100%.
- Discount type switch = reset discount to 0.
- Cash extra = change returned.
- Card/online extra = blocked.
- Paid/report totals are calculated from sanitized values.

## Status endpoint

`/api/order-engine/status` now includes:

- `discountTypeSwitchResetsValue`
- `fixedDiscountClampedToBill`
- `percentDiscountMax100`
- `cashRevenueChangeSafe`
- `buttonTextVisibilitySafe`
