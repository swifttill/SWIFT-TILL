# SwiftTill POS V24 — 360 Operational Audit Fixes

This package hardens the non-UI operational layer: auth/security, order lifecycle, reports, backup retention, media/history preservation, and cloud print queue.

# SwiftTill POS — V20 Admin Reports, Client-Safe Settings, Speed & Direct Print

Production hardening phase for real restaurant testing.

## Fixed in V20

- Admin Reports blank screen fixed with robust report renderer and fallback error state.
- Cloud/R2 credentials tab hidden from restaurant client UI.
- Restaurant staff only see business setup, menu, tables, users, reports, backup and printer tools.
- Busy/loading behavior changed to lightweight non-blocking indicator for faster rush-hour operation.
- Direct thermal printing defaults to local Windows print-agent mode.
- Browser print fallback remains if local agent is not running.
- Static HTML/JS/CSS are served no-store to avoid old cached frontend after Render deploy.
- `/api/order-engine/status` reports V20 readiness flags.

## Real production services

- Render: web service
- Neon: PostgreSQL cloud state
- Cloudflare R2: media/backup storage
- Client PC: local print agent for thermal printing

## Client warning

Render/Neon/R2 keys are never shown in Admin UI. They must stay only in Render environment variables.

## Phase 21 — Client Print Agent Package

After pushing to GitHub main, the restaurant counter PC can download the print-agent package from:

```text
https://github.com/swifttill/SWIFT-TILL/raw/main/downloads/SwiftTill_Print_Agent_Client_Package.zip
```

Client gets only the print-agent ZIP. Do not share Render, Neon, Cloudflare, or R2 credentials with restaurant staff.


## Phase 22 — Structured Reports

Reports now use main report menus with dedicated report types: Daily, Item Wise, Category Wise, Payment Mode, Custom, X, Y, Z, Discount, Void/Refund and Order Type. Each report shows only relevant filters, exports a report-specific Excel-compatible CSV, and prints in a consistent bill-style report format.

## Phase 23 — Professional POS Reports Rebuild

Adds closeout-grade reports with summary cards, totals footers, payment reconciliation, item/category/order-type analysis, X/Y/Z style layouts, receipt-like print, and per-report export columns.


## Phase 25 — UI/Admin Professional Polish

This phase performs a full non-design-breaking UI audit pass:

- Reports removed from the main POS rail and kept only in Admin Panel.
- Admin Panel navigation polished with clearer back-office structure.
- Image rendering uses safe aspect handling to avoid stretched logos/menu images.
- Cards, tables, buttons, spacing, margins, shadows and states polished for a professional restaurant POS look.
- Fast soft busy indicator fixed and visible without locking the full screen unnecessarily.
- No Render/Neon/Cloudflare credentials are exposed to restaurant clients.
- Existing V24 operational audit/security/backup/history/print fixes are preserved.


## Phase 26 — Formatting, Reports & Print Templates Audit

This phase audits formatting beyond the POS screen and fixes report templates for two separate use cases:

- On-screen admin reports: professional management view with readable totals.
- PDF / A4 output: QuickBooks-style clean business report with summary tables, details, totals and signature lines.
- Thermal printing: 80mm receipt-style report slip with no boxes, no wide tables, and no browser-style card layout.

It also keeps reports admin-only, keeps Excel/CSV exports report-specific, and keeps V24/V25 security, backup, history, media cleanup and print-agent work.
