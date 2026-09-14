# Phase 45 — Offline Rollback to Stable Online Printer Build

## Reason

The offline-first work from V41-V44 was rolled back because the client requires a simpler and more stable operational setup before final testing.

## Active mode

SwiftTill is online-only again. If internet is unavailable, billing actions are blocked instead of creating local unsynced records.

## Preserved from previous stable phases

- V39 discount/payment guard rules
- V40 printer module and client print-agent package
- Cross-device live sync
- Neon cloud-state persistence
- Cloudflare R2 media handling
- Admin reports
- Paid order/table/payment safety rules

## Removed from active build

- Offline billing queue
- Offline authentication cache
- Manual offline sync center
- IndexedDB offline order mirror
- Counter-agent offline disk sync
- Offline month-long sync mode

## Operational policy

Use SwiftTill only when internet is available. For printer support, install/run the client print-agent package on the counter PC.
