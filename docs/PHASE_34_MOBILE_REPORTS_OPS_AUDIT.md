# Phase 34 — Mobile, Reports Navigation, Favicon and Operational Scenarios

## Fixed

- Browser favicon was too small; replaced with stronger high-contrast SwiftTill icon set.
- Reports submenu moved into Admin left sidebar.
- Report workspace now focuses only on filters, results and actions.
- Restaurant/company logo now appears in screen report header, A4/PDF reports and thermal report.
- Mobile POS layout improved: header, actions, categories/search, menu/workspace.
- Mobile cart drawer now has visible close button.
- Mobile quick controls added for Menu, Open Bills and Pay/Open Bill.
- Operational Safety admin section added for local restaurant scenarios.

## Operational scenarios covered

- Browser tab or Chrome crash.
- PC shutdown or electricity failure.
- Internet drop in online-only mode.
- Render restart/sleep.
- Thermal printer offline/disconnected.
- Double-click Hold/Pay.
- Same table duplicate order attempt.
- Menu media replace/delete.
- Wrong payment/refund.
- End-of-day X/Z closeout.

## Endpoints

- `/api/order-engine/status`
- `/api/audit/final-360`
- `/api/ops/scenarios`
