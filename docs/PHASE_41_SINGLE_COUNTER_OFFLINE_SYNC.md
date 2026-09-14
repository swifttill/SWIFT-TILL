# SwiftTill POS V41 — Single Counter Offline Mode + Manual Sync Center

This phase adds single-counter offline billing for clients with unreliable internet.

## Safety model
- Offline billing is allowed only on the registered desktop/counter PC.
- Mobile and second devices are online-only when internet is unavailable.
- Every offline order save writes a local WAL record plus a backup copy before the UI continues.
- The local Counter/Print Agent can also receive offline backup snapshots and save them to disk.
- Local pending bills are removed only after the cloud server confirms sync.
- Cash-only offline payment is enforced. Card/Online payment requires internet.
- Offline receipts use OFF-* references until the cloud assigns the final bill number.
- Admin Sync Center shows pending bills, upload progress, last local save, and manual Sync Now.

## Important
No software can honestly guarantee zero data loss against all possible hardware failures, disk corruption, browser data deletion, or Windows profile damage. V41 is built with defensive local persistence and server idempotency, and a UPS plus regular Sync Now remains recommended for real restaurant production.
