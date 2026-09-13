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
