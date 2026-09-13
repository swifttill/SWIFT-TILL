# Phase 33 — R2 Media Lifecycle Hard Delete

## Problem
Uploaded replacement images were staying in the Cloudflare R2 bucket because historical order image references blocked cleanup.

## Fix
Live media usage is now based only on current live business settings, categories, items and deals. Paid order/report history remains text/price/category snapshot-based, so old image objects can be deleted safely.

## Cleanup rules
- Replace category/item/deal/logo image: delete previous object if not used by another live record.
- Delete category/item/deal: delete object if not used by another live record.
- Daily production cleanup: scan managed media prefixes and delete unreferenced objects.
- Backups are excluded.

## Endpoint
POST /api/admin/media-cleanup

Requires logged-in admin with menu permission.
