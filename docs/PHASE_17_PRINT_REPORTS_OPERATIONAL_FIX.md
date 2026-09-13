# Phase 17 — Print, Receipt and Reports Operational Fix

Fixes real counter issues found during Render testing:

- Adds unpaid/current bill print option before payment.
- Prevents blank browser print by keeping the print area outside the hidden app shell.
- Sends unpaid bill and paid receipt payloads to local print agent when configured.
- Keeps browser print fallback working when local print agent is not running.
- Shows report loading and report failure directly on the report screen instead of leaving it blank.
- Keeps reports backed by Neon cloud state.
- Keeps production uploads backed by Cloudflare R2.

Expected status endpoint version: `17.0.0-print-reports-operational-fix`.
