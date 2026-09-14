SwiftTill POS — Final Client Print Agent V40

Purpose:
This small package is installed on the restaurant counter PC. It connects the cloud POS on Render to the local Windows thermal/default printer.

Client PC one-time setup:
1. Install thermal printer driver.
2. Set thermal printer as Windows Default Printer.
3. Extract this ZIP.
4. Run INSTALL_PRINT_AGENT.bat.
5. Paste the Print Agent Key provided by owner/admin.
6. Run START_PRINT_AGENT.bat and keep it open during billing.
7. Run TEST_PRINT_AGENT.bat for a paper test.
8. Open POS with START_POS_WINDOW.bat.

How it works:
Cloud POS → Render print queue → this local agent polls queue → Windows default printer prints.

Safety:
- Receipts are saved in storage/print-spool.
- Failed prints are copied to storage/print-spool/failed.
- Printed copies are copied to storage/print-spool/printed.
- Cloud jobs retry automatically.
- If printer is offline, job is not lost.

Important:
This package does not contain Render, Neon, or Cloudflare credentials.
It only uses the Print Agent Key for printer queue access.
