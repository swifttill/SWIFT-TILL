SwiftTill POS - Client Print Agent Setup

This small package is for the restaurant counter PC only.
It lets the cloud POS print to the local Windows/default thermal printer.

One-time setup:
1. Install thermal printer driver on Windows.
2. Set the thermal printer as Windows Default Printer.
3. Install Node.js LTS from https://nodejs.org/.
4. Extract this folder anywhere, for example C:\SwiftTill-Print-Agent.
5. Double-click INSTALL_PRINT_AGENT.bat.
6. Double-click START_PRINT_AGENT.bat and keep the black window open.
7. Double-click START_POS_WINDOW.bat to open SwiftTill POS.

Daily use:
1. Turn on printer.
2. Run START_PRINT_AGENT.bat.
3. Run START_POS_WINDOW.bat.
4. Print bills/receipts from the POS.

Test:
- Open http://127.0.0.1:9721/health in browser.
- Or run CHECK_PRINT_AGENT.bat.

Cloud app URL:
https://swift-till.onrender.com

Do not share Render, Neon, Cloudflare, R2, or database credentials with the restaurant staff.
