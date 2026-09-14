# SwiftTill Phase 46 — Business Day Open/Close + Report Cleanup

Offline concept remains removed. This phase keeps the online-only stable printer build and adds controlled daily operations.

## Business Day rules

- Billing is blocked until **Open Day** is completed.
- Only one business day can be open at a time.
- Each order is tagged with `businessDayId`, `shiftId`, `businessDate`, and day number.
- The sale day is based on **Open Day → Close Day** time, not calendar midnight.
- If restaurant opens on one date and closes after 12 AM, sales remain inside the opened business day.
- Day close is blocked until all open/held bills are cleared.
- Close Day records opening cash, cash sales, cash refunds, expected cash, counted cash, and difference.

## Reports cleanup

- Reports use business day dropdown where relevant.
- Summary reports are compact.
- Detailed bill rows are kept in the Detailed Bill Report only.
- A4/PDF print templates are compressed to reduce extra blank/wasted pages.
- Thermal reports are shorter and report-specific.

## Status flags

Expected `/api/order-engine/status` additions:

- `businessDayOpenCloseV46`
- `workBlockedWithoutOpenDay`
- `afterMidnightDaySales`
- `compactReportsV46`
- `reportPrintWasteReduced`
- `offlineConceptForgotten`
