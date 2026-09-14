# SwiftTill Phase 51 — Deep Clean UX + Builder Audit

Version: 51.0.0-deep-clean-ux-builder-audit

## Fixed

- Admin search/filter field no longer loses focus after typing one character.
- Filter tables update rows only instead of rebuilding the full filter bar.
- Caret/selection is preserved across safe UI re-renders.
- POS menu search keeps typed text stable during refreshes.
- Enter key in search fields no longer submits/blurs unexpectedly.
- Button text visibility guard strengthened for desktop and mobile.
- Input/focus styling improved for professional cashier/admin operation.

## Builder audit

- JavaScript syntax validation passed.
- API syntax validation passed.
- Auth smoke test passed.
- Offline concept remains removed; this is online-only.
