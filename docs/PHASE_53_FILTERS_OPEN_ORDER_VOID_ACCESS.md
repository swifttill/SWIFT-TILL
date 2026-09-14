# Phase 53 - Filters, Sorting, Open Order Void/Cancel Access

## Scope
- Paid Orders now has search, from/to date range, order type, payment type and sort controls.
- Open Orders now has search, from/to date range, order type and sort controls.
- Open/Held bills can be voided/cancelled from POS.
- Void/cancel requires either current user `pos.void` permission, Manager PIN, or manager/admin email + password with `pos.void` permission.
- Paid bills are still not voided; use Refund for paid bills.
- All void/cancel actions are audited with approver method.
- Online-only mode is preserved. Offline modules remain removed.

## Status flags
- paidOrdersFiltersV53
- paidOrdersSortingV53
- openOrdersFiltersV53
- openOrderVoidCancelFromPosV53
- managerAdminApprovalForVoidV53
- searchDateRangeFilterAuditV53
