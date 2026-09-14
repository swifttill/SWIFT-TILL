SwiftTill Counter Agent V44

This package is local-only and Defender-friendly: no EXE, no hidden service, no registry changes. It supports printing, print retry, offline disk backups, and latest-backup restore for Sync Center.

SwiftTill POS — Safe Counter Agent V43

Purpose:
This small package is installed one time on the restaurant counter PC. It handles:
- local Windows thermal/default printer printing
- cloud print queue polling when internet is available
- offline backup snapshots from the POS browser app
- offline Cash/Card/Online payment selections and reports support

Safety / Windows Defender friendly design:
- No EXE is included.
- No obfuscated code is included.
- No registry changes are made.
- No Windows service or auto-start task is installed.
- No admin permission is required by the agent itself.
- No PowerShell ExecutionPolicy Bypass is used.
- Agent listens only on 127.0.0.1:9721, not the whole network.
- Offline backups are saved only inside this extracted folder under storage/offline-backups.
- This package does not contain Render, Neon, Cloudflare, database, or R2 credentials.

Client PC one-time setup:
1. Install Node.js LTS once if Node is not already installed.
2. Install thermal printer driver.
3. Set thermal printer as Windows Default Printer.
4. Extract this ZIP into a normal folder, for example C:\SwiftTillCounterAgent.
5. Run INSTALL_PRINT_AGENT.bat.
6. Paste the Print Agent Key provided by owner/admin.
7. Run START_PRINT_AGENT.bat and keep the window open during billing.
8. Run TEST_PRINT_AGENT.bat for paper test.
9. Open POS with START_POS_WINDOW.bat.

Offline safety:
- POS saves bills in browser local queue and IndexedDB mirror.
- Counter Agent stores extra atomic disk snapshots in storage/offline-backups.
- Pending bills are not removed before server confirms upload.
- If internet returns after days/weeks, Sync Center can upload pending bills.
- Card/Online are POS payment selections only; real bank gateway integration is not required.

Important:
Do not delete browser data or this agent folder before syncing. Use a UPS on the counter PC for best protection against power cuts.
