# SwiftTill V44 — Offline Authentication + Operational Safety

This phase completes the offline-first counter model with safe local authentication and operational scenario coverage.

## Offline authentication model

- First login on the main counter PC must be online.
- After successful online login, the counter PC caches:
  - last-known user profile
  - last-known permissions
  - salted PBKDF2 password hash
  - POS state cache
- Plain passwords are never saved.
- Offline unlock works only on the registered counter PC.
- Mobile and second devices remain online-only when internet is unavailable.
- Offline session is time-boxed and can be locked from Sync Center.

## Safety and recovery

- Offline bill changes are written to localStorage, a backup copy, IndexedDB mirror, and Counter Agent disk snapshots.
- Sync Center shows pending upload and progress.
- Data is not deleted before cloud confirmation.
- Counter Agent exposes a local restore endpoint for browser-data-loss recovery.
- Manual Sync Now remains available.

## Operational scenario guard matrix

Covers first login, offline login, wrong user/password, role snapshots, mobile blocking, power cut, PC restart, long offline period, browser data cleared, storage warnings, duplicate sync, reports, payment selections and printer disconnection.
