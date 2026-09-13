# Phase 28 — Cart Density + Client Admin Cleanup

## Purpose
This phase responds to live POS cart feedback: the right bill panel was wasting vertical space, order metadata was stacked, totals/actions were oversized, and client-facing admin still exposed backup actions that ordinary restaurant staff do not need.

## Changes
- Current order detail card converted to compact two-column grid.
- Cart line list area given more usable height.
- Empty cart area compressed.
- Subtotal, discount and total area reduced.
- Print Bill, Move Table and Split Bill moved into one compact action row.
- Hold and Pay buttons compressed while preserving strong action styling.
- Backup / History removed from routine client Admin sidebar.
- Manual create/download/restore backup controls hidden from client-facing Admin.
- Automatic backup/history retention remains internal.
- Version/status flags added to `/api/order-engine/status`.

## Validation
- API syntax check passed.
- Web JavaScript parse check passed.
- Auth smoke test passed.
- Storage/print agent syntax check passed.

## Usage note
Restaurant staff should manage setup, menu, tables, payment methods, users, reports and receipt/printer settings. Raw backup file operations are retained internally and should be owner/developer-only.
