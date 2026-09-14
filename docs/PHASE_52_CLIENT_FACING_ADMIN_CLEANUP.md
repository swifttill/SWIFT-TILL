# SwiftTill Phase 52 — Client-Facing Admin Cleanup

Version: 52.0.0-client-facing-admin-cleanup

## Scope
- Removed unsupported Image columns from admin modules that do not display or manage images.
- Image column remains only for Categories, Menu Items and Deals.
- Tables, Order Takers, Payment Methods, Users and Roles now render module-specific columns only.
- Column labels are client-facing, not raw field names.
- Server validates/sanitizes non-media admin records so accidental image fields are not stored.
- V51 focus/caret stability remains preserved.
- Online-only mode remains preserved. Offline concept remains removed.

## Validation
- Node syntax check
- Web JavaScript parse check
- Auth smoke test
- ZIP integrity check
