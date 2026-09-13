# SwiftTill POS V39 — Discount, Cash and Button Visibility Guards

This phase fixes discount switching, over-discount prevention, cash/payment calculation guards and hidden button text on compact screens.

## V39 fixes

- Rs/% discount switch now resets value to avoid carrying old Rs values into percentage mode.
- Rs fixed discount cannot exceed the current bill amount.
- Percent discount cannot exceed 100%.
- Frontend and backend both sanitize discount before save, autosync and payment.
- Total payable cannot go negative.
- Cash overpayment remains change, not revenue.
- Card/online overpayment remains blocked.
- Button text visibility improved on mobile and desktop.

---

# SwiftTill POS V38 — Live Cross-Device Sync

This phase improves real-time operational sync between mobile and PC counters. Paying, holding, saving, editing and opening bills on one device now refreshes the other device automatically.

## V38 fixes

- Added state revision tracking in cloud state.
- Added `/api/sync/status` lightweight sync endpoint.
- Added `/api/orders/cart-sync` autosave endpoint for active cart changes.
- Mobile item/deal add stays on menu, but cart is autosaved to Neon.
- PC and mobile refresh Open Bills, table status and paid status automatically.
- If a bill is paid on mobile, PC closes/clears that active bill and removes it from Open Bills.
- If PC changes/holds/pays a bill, mobile sees the same state without manual refresh.
- Before Pay, device syncs with server to avoid paying an already-closed bill.
- Desktop/mobile UI stays fast: sync is quiet and does not show the big loading overlay.

## Current verdict

Controlled restaurant pilot is stronger after V38 deploy. Multi-device order state now has active polling + autosave, but final handover still needs real printer and rush-hour order simulation.

---

# SwiftTill POS V33 — Final 360 Non-Testing Audit Fixes

This package applies a deep non-UI operational audit pass after V30. It keeps the modern POS/admin/report/branding work and hardens the remaining backend, history, security, print, backup and workflow rules before live QA.

## V31 fixes

- Table double-booking guard strengthened for draft-to-open and draft-to-pay race cases.
- Paid bill void is blocked; paid bills must use refund.
- Refund overrun is blocked; refunds cannot exceed remaining refundable balance.
- Payment correction and paid-order reopen are blocked after refund to preserve clean audit history.
- Shift close requires counted cash and subtracts cash refunds from expected cash.
- Technical cloud/backup permissions removed from restaurant-facing role catalog.
- Raw backup create/download/restore moved to owner-maintenance-only access.
- Cloud-state migrations/cleanup persist back to Neon immediately.
- Production startup fails hard if Neon/cloud state cannot load.
- Added `/api/audit/final-360` safe readiness endpoint.

## Current verdict

Controlled restaurant pilot is possible after V31 deploy and real QA. Final handover still requires real thermal-printer testing and a full dummy-order day simulation.


---

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


## Phase 27 — Modern POS UI System Rebuild

This phase audits and polishes the visible POS/admin interface while preserving V24-V26 operational hardening.

Key changes:
- Compact top header and Back to POS moved into the top action cluster.
- POS Reports remain admin-only.
- Category-aware colors for menu/category cards: burgers, fries/sides, drinks, desserts, pizza and deals.
- Distinct action styling for New Order, Hold, Pay, Print, Admin and Logout.
- Menu thumbnails use safe contain mode; no stretched images.
- Margins, gaps, border radii, shadows and icon visibility are tightened for modern POS screens.
- Same-screen POS workflow remains: order, table/menu/deal selection, cart, hold/pay/print actions.
- Admin panel gets a more professional back-office shell without exposing cloud credentials.

Version: 30.0.0-media-admin-filters-branding


## Phase 28 — Cart Density + Client Admin Cleanup

This phase compresses the right bill/cart panel for rush-hour billing and removes raw backup file actions from the restaurant-facing admin UI.

- Order details are shown as a compact grid.
- Cart line area gets more visible working height.
- Subtotal/discount/total rows are compressed.
- Print Bill, Move Table and Split Bill are in one compact action row.
- Hold and Pay actions are tighter but still clearly separated.
- Client admin no longer shows create/download/restore backup controls. Automatic backup/history behavior remains internal.
- Admin sidebar no longer exposes Backup / History as a routine staff screen.
- Version status flags added for V28.


## Phase 29 — Extreme Cart Compression

This phase tightens the right bill/cart panel again after real screenshot feedback.

- Order details grid is smaller and more horizontal.
- Bill item list gets more visible height.
- Item rows, thumbnails and quantity controls are denser.
- Totals and discount section are smaller but still readable.
- Print / Move / Split buttons are slimmer.
- Hold / Pay buttons are compact but still strong.
- Print-after-payment label is shortened to save space.
- No UI section is hidden incorrectly; only spacing is compressed.

Version: 30.0.0-media-admin-filters-branding


## Phase 30 — Media, Admin Filters/Sorting and Branding

- Fixed half-cropped item/card images with safe food image frames.
- Added admin search, category filter and sorting to lists, especially Menu Items.
- Added SwiftTill favicon/browser tab icon and PWA icons.
- Added branded login background, company logo in header and SwiftTill footer branding for bills/reports.


## Phase 32 — Mobile Friendly + Final Noted Code-Side Cleanup

This package adds a phone/tablet POS usability pass and closes the code-side notes that do not require real hardware testing:

- mobile cart drawer with bottom bill button
- compact phone/tablet POS workspace
- horizontal mobile category rail
- mobile-safe admin navigation
- mobile report/admin tables scroll safely
- client admin backup controls remain hidden
- tax / NTN / STRN / invoice footer fields added to company settings
- final audit/status flags updated for mobile pilot readiness

Remaining items after this phase are field-testing items only: real thermal printer test, dummy order day simulation, and final customer UI approval.


## Phase 33 — R2 Media Lifecycle Hard Delete

This phase fixes Cloudflare R2 media cleanup so the bucket does not keep old item/category/deal/logo files forever.

- Replacing a category, item, deal or logo image deletes the previous R2 object when no live record still uses it.
- Deleting a category, item or deal deletes its R2 image when no other live record uses it.
- Paid order/report history remains safe because reports keep text/price/category snapshots, not live media dependencies.
- Historical paid-order image references no longer block bucket cleanup.
- Daily orphan cleanup scans managed media prefixes and deletes unreferenced R2 files.
- Owner/admin endpoint added: POST /api/admin/media-cleanup.
- Backups under swifttill/backups are not touched by media cleanup.


## Phase 34 — Mobile, Reports Navigation, Favicon and Operational Scenarios

This package adds a client-facing operational UX hardening pass:

- Enlarged high-contrast SwiftTill favicon/app icons for browser tabs and PWA installs.
- Reports submenus now live inside the Admin left navigation under Reports.
- Reports content no longer opens a second report-menu workspace.
- Organization/restaurant logo is included on report screen headers, A4/PDF reports and thermal report slips.
- Mobile POS layout is reordered for restaurant use: header, mobile actions, categories/search, then menu/workspace.
- Mobile bill drawer has visible close/back control.
- Mobile action strip provides Menu, Open Bills and Pay/Open Bill controls.
- Operational Safety admin section documents recovery for browser crash, power loss, internet drop, Render restart, printer offline, double-click payment, duplicate table, media cleanup and closeout.
- API endpoint `/api/ops/scenarios` added for live scenario readiness.

Version: `34.0.0-mobile-reports-ops-audit`


## Phase 36 — Original Logo Favicon Restore

Restored browser/favicon/PWA icons from the original SwiftTill logo asset, with cache-busting links so the browser tab refreshes after deploy.


## Phase 36 — Original Logo Favicon Size Fix

The favicon still uses the original SwiftTill logo mark. It is now cropped tighter and scaled up to fill the favicon canvas so it appears larger in browser tabs. No redesigned artwork was introduced. Cache-busting is updated to `v=36`.


## Phase 37 — Mobile Add Items Stay On Menu

Mobile cashier flow fixed: adding menu items or deals no longer opens the bill drawer automatically. The bill/cart drawer is manual-only through the mobile Bill/Open Bill/Pay controls so staff can add multiple items quickly without closing the drawer after every tap.

Status flags: `mobileAddItemsStayOnMenu=true`, `mobileBillDrawerManualOnly=true`.


## Phase 40 — Printer Module 99% Final

Printer module hardened with cloud queue polling, Windows default printer diagnostics, local spool recovery, retry support, and final client PC print-agent ZIP.

Client download after pushing to GitHub:

```text
https://github.com/swifttill/SWIFT-TILL/raw/main/downloads/SwiftTill_Print_Agent_Client_Package_Final.zip
```
