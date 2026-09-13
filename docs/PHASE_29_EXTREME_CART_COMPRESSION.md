# Phase 29 — Extreme Cart Compression Without Breaking Readability

This phase compresses the right bill/cart panel to increase visible item space during rush-hour billing.

## Changes

- Order header row reduced.
- Order metadata uses four compact cells in one row where possible.
- Cart item list receives the maximum available vertical space.
- Cart lines use smaller thumbnails, tighter quantity controls and reduced gaps.
- Subtotal/discount/total rows are compressed without hiding values.
- Print, Move and Split remain in one slim row.
- Hold and Pay remain prominent but use less height.
- Print-after-pay label shortened.
- No backend/schema changes.

## Test

Create a dine-in order with 5–8 items. The bill list should show more items before scroll while totals and action buttons remain visible.
