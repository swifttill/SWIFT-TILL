SwiftTill POS - Client Print Agent Setup

This package is for the restaurant counter PC only.
It lets the cloud POS print directly to the local Windows/default thermal printer.

Recommended production print flow:
SwiftTill cloud POS on Render -> Cloud print queue -> Client print agent -> Windows default thermal printer

One-time setup:
1. Install the 80mm/58mm thermal printer driver on Windows.
2. Set the thermal printer as Windows Default Printer.
3. Install Node.js LTS.
4. Extract this folder, for example C:\SwiftTill-Print-Agent.
5. Double-click INSTALL_PRINT_AGENT.bat.
6. Double-click START_PRINT_AGENT.bat.
7. Enter the SwiftTill Print Agent Key given by the owner/developer.
8. Double-click START_POS_WINDOW.bat to open the cloud POS.

Daily use:
1. Turn on printer.
2. Run START_PRINT_AGENT.bat and keep the black window open.
3. Run START_POS_WINDOW.bat.
4. Print bills/receipts/reports from the POS.

Test:
- Open http://127.0.0.1:9721/health in browser.
- Or run CHECK_PRINT_AGENT.bat.

Cloud app URL:
https://swift-till.onrender.com

Do not share Render, Neon, Cloudflare, R2, or database credentials with restaurant staff.
The print agent key is only for print queue access.
