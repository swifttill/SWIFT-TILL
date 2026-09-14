# Phase 47 — Auto Logout Inactivity Security

## Purpose
Protect the POS counter when the screen is left open and no cashier activity happens.

## Rules
- Auto logout after 12 minutes of inactivity.
- Warning modal appears 60 seconds before logout.
- User activity includes clicks, typing, touch, wheel, input/change.
- Continue Session resets the timer.
- Manual logout and auto logout clear the local token and return to login.
- Auto logout calls the server logout endpoint for audit.
- Current dirty cart is auto-saved before idle logout where possible.

## Online-only
Offline modules remain removed from this package.
