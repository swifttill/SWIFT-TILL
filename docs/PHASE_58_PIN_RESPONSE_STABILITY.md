# Phase 58 — PIN Registration Response Stability

Scope: online-only PIN security hotfix after a Render Bad Gateway / invalid server response during PIN registration.

Fixes:
- Register PIN can replace a seeded/default PIN after password verification.
- Default PIN values are blocked for new PIN setup.
- Password/PIN hash verification is malformed-hash safe.
- API responses are always JSON when the app is running.
- Client API now shows a clear server-unavailable message for Render 502/503/504 HTML pages instead of generic invalid server response.
- PIN Security modal no longer shows Register PIN incorrectly when a real PIN already exists.

Offline modules remain removed.
