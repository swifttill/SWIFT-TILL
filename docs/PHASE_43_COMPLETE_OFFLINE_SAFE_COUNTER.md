# Phase 43 — Complete Offline Safe Counter

## Scope

V43 finalizes the single-counter offline operating model for clients with unreliable internet.

## Payment model

Cash, Card and Online are POS payment selections/captured records only. There is no real payment gateway integration and none is required for this phase. Card/Online reference is optional and retained only for audit/report detail when entered.

## Safety model

- Offline billing is allowed only on the registered counter PC.
- Mobile and second devices remain online-only to avoid duplicate offline tables/bills.
- Every offline bill is saved to browser local queue.
- A backup copy and write-ahead metadata are written.
- V43 mirrors the latest order queue to IndexedDB.
- Counter Agent writes atomic disk snapshots and a local offline ledger.
- Pending orders are not cleared until `/api/offline/sync` confirms upload.
- Server sync is idempotent by `clientOrderId/localId/offlineRef`.
- Reports include offline local sales with clear unsynced status.

## Windows safety

The client agent is plain Node.js source plus BAT launchers. It avoids EXE wrapping, obfuscation, registry edits, Windows services, startup tasks and ExecutionPolicy bypass. It binds to `127.0.0.1` only.

## Remaining real-world requirement

No software can guarantee recovery from physical disk failure, deleted browser profile, deleted agent folder, or corrupted Windows user account. For restaurant operation use a UPS and avoid clearing browser data before sync.
