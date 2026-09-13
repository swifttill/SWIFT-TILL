# Phase 31 — Final 360 Non-Testing Audit Fixes

This phase focuses on non-UI operational hardening before live QA. It does not replace real restaurant testing.

## Fixed in V31

- Strengthened table double-booking guard when two draft dine-in orders try to activate the same table.
- Blocked paid-bill voids; paid bills must use refund workflow.
- Added refund overrun protection so total refunds cannot exceed the paid bill total.
- Added refund status tracking on paid orders: partial/full.
- Blocked payment correction and reopen after a refund to protect audit history.
- Shift close now subtracts cash refunds from expected cash and requires counted cash.
- Client-facing roles no longer include internal cloud/backup permissions.
- Raw backup create/download/restore routes are owner-maintenance-only and not normal restaurant admin actions.
- Cloud-state migration now persists cleanup/migration changes back to Neon immediately.
- Production startup fails hard if the data store cannot load.
- Added `/api/audit/final-360` for safe readiness visibility.

## Still not replaceable by code-only audit

- Real thermal printer paper width/cutter/driver behavior.
- Real 30–50 dummy order day simulation.
- Client-specific menu/category/table data entry and approval.
- Owner decision on final password/PIN policy.
- Final live Render deploy confirmation after GitHub push.
