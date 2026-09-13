# Phase 18 — Backup, History & Media Cleanup

## Scope

Phase 18 adds production-safe backup, retention and media cleanup behaviour.

## Included

- Public `/api/order-engine/status` reports V18 backup/media rules.
- Admin backup status endpoint.
- Manual backup creation endpoint.
- Backup download creates a JSON snapshot.
- R2 JSON backup upload when Cloudflare R2 is configured.
- Daily backup check after production cloud saves.
- 30 daily backup retention target.
- 12 monthly backup retention target.
- Image cleanup for replaced logo/category/item/deal media.
- Image cleanup for deleted category/item/deal media when not reused.
- Paid order line snapshot preserves item name, price and category for future reports.
- Item/category/deal deletion removes live menu records but does not remove historical paid bills.

## Functional status

The app is operational for real testing on Render with Neon and Cloudflare R2. Remaining production polish after V18 should focus on receipt printer agent packaging, role-password hardening, business onboarding wizard, and full end-to-end QA with a restaurant sample dataset.
