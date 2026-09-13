# Phase 21 — Client Print Agent Download Package

Added a dedicated client package for restaurant counter PCs.

Direct GitHub raw download path after pushing main:

```text
https://github.com/swifttill/SWIFT-TILL/raw/main/downloads/SwiftTill_Print_Agent_Client_Package.zip
```

The restaurant client should receive only this print-agent ZIP, not the full project repository and not any Render/Neon/Cloudflare credentials.

Included in the package:

- `INSTALL_PRINT_AGENT.bat`
- `START_PRINT_AGENT.bat`
- `START_POS_WINDOW.bat`
- `CHECK_PRINT_AGENT.bat`
- `README_CLIENT_SETUP.txt`
- `apps/print-agent/agent.js`

Daily printing flow:

```text
Render SwiftTill POS -> Browser -> Local Print Agent -> Windows Default Thermal Printer
```
