# Phase 38 — Live Cross-Device Sync

## Goal

Fix mobile/PC state mismatch where a bill paid on one device could still appear open on another device until manual refresh.

## Added

- Cloud-state revision number and update timestamp.
- `/api/sync/status` endpoint for lightweight polling.
- `/api/orders/cart-sync` endpoint for debounced current-cart autosave.
- Client polling every ~1.8 seconds while logged in.
- Focus/visibility/online refresh hooks.
- Remote paid-order detection: active bill is cleared if another device paid it.
- Open Bills and table status refresh automatically on revision changes.
- Before opening payment modal, the device checks latest server state.

## Scenario coverage

- Mobile pays bill -> PC removes it from open/edit state.
- PC pays bill -> mobile removes it from open/edit state.
- Mobile adds item -> PC sees updated order after autosave.
- PC adds/holds order -> mobile Open Bills updates automatically.
- Render restart/session refresh still reloads from Neon cloud state.
