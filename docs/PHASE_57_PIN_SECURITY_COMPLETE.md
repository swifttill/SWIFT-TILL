# Phase 57 — Complete PIN Security and Approval Audit

V57 completes the PIN workflow without reintroducing offline mode.

## Scope
- User Register PIN.
- User Change PIN.
- User Remove PIN.
- Admin set/change/clear user PIN.
- PINs stored as hashes only.
- Manager/Admin approval PIN works for protected POS actions.
- Password approval remains supported.
- Online-only mode preserved.

## Protected actions
- Void / Cancel open bill.
- Refund paid bill.
- Payment correction.
- Reopen paid bill for edit.

## Rules
- First PIN setup requires current password.
- Change PIN requires current PIN or current password.
- Admin can set/change/clear employee PINs from Users.
- PIN format: 4 to 8 digits.
- PIN value is never sent back to the browser.
