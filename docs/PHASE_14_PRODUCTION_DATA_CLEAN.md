# Phase 14 — Production Data Clean

- Fixed `/api/order-engine/status` so cloud state is loaded before counts are read.
- Removed demo restaurant/menu/deal/table/order-taker bootstrap data from `apps/api/server.js`.
- Seed no longer creates demo categories, menu items, deals, tables or order takers.
- Legacy hardcoded demo IDs are cleaned once from cloud state on deployment.
- Receipt preview now uses a real current/paid order only; no fake Zinger/Pizza sample receipt.
- Static sample images are no longer referenced by runtime seed data.

Bootstrap data still kept intentionally: Admin/roles/permissions/basic payment methods. These are required to log in and configure the real business.
