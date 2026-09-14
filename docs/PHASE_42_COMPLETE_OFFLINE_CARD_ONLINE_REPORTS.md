# Phase 42 — Complete Offline Card/Online Payments + Professional Offline Reports

## Why this phase exists
V41 added emergency offline sync, but card/online were still treated like basic payment selections and offline mode was cash-only. V42 makes payment capture and reporting more complete for real restaurant use.

## Payment hardening
- Card and Online payments now require a reference/slip/transaction number.
- Card and Online cannot be overpaid; exact approved amount is required.
- Cash remains the only method that can create change.
- Split payment supports cash + card + online with reference fields.
- Offline card/online payments are allowed only when staff has external confirmation reference.
- Offline card/online payments sync as `PENDING_SYNC` / `PENDING_RECONCILIATION` until uploaded.
- Server validates payment references again during cloud sync.

## Offline reports
- Reports work offline using cached cloud paid bills plus unsynced local paid bills.
- Daily, item wise, category, payment, order type, discount and bill detail reports have local data support.
- Reports show an offline warning and unsynced count.
- Offline CSV export works without internet for reports.
- Payment references and pending reconciliation status are visible in reports/receipt data.

## Sync Center polish
- Sync Center now shows pending upload, total local stored bills, card/online pending reconciliation and last local save.
- Bills are never removed locally before server confirmation.
- Failed/conflict items remain pending for retry.

## Safety limits
No browser/local software can guarantee survival if the Windows profile is deleted, disk is destroyed, or browser data is manually cleared. This build uses local queue + WAL + export + counter agent backup to reduce risk.
