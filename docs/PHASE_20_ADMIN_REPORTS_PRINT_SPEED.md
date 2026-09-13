# Phase 20 — Admin Reports, Client-Safe Settings, Speed and Direct Printing

Changes:
- Fixed Admin Reports blank screen.
- Removed Cloud/R2 tab from client-facing Admin navigation.
- Kept Backup/History visible because restaurant needs business backup controls.
- Switched busy indicator to non-blocking lightweight mode.
- Print agent defaults to Windows default-printer mode for direct thermal printing.
- Added no-store cache headers for app shell/static assets so Render deploy updates are visible immediately.

Direct print model:
Cloud app runs on Render. Browser sends receipt payload to `http://127.0.0.1:9721/print` on the restaurant PC. The local agent sends the text receipt to the Windows default printer. If the local agent is closed, browser print fallback opens.
