# SwiftTill POS Monorepo V7

Clean online-focused SwiftTill POS with backend API, responsive POS UI, separate Admin Panel, roles/permissions, reports, receipt/report formats, payment calculators, live table timers, and local print-agent path for thermal printers.

## Run locally

```powershell
cd "E:\pos\SwiftTill_POS_Monorepo_V7"
npm start
```

Open: http://localhost:5174

## App-window mode

```powershell
.\START_SWIFTTILL_APP_WINDOW.bat
```

This opens SwiftTill like a desktop app window instead of a normal browser tab.

## Cloud app-window mode

After deployment, edit `START_SWIFTTILL_CLOUD_WINDOW.bat` and set your cloud URL.

```powershell
.\START_SWIFTTILL_CLOUD_WINDOW.bat
```

## Local print agent

```powershell
.\START_SWIFTTILL_PRINT_AGENT.bat
```

Use this once on the client PC for thermal printer access. Cloud POS sends receipt data to the local print agent.

## Login

```text
admin@swifttill.local / admin123
manager@swifttill.local / manager123
cashier@swifttill.local / cashier123
```

Manager PIN: `1234`

## V7 fixes

- Dine In order cannot be created without table selection.
- New Order table dropdown shows available tables only.
- Busy table cannot be assigned again until paid/void/released.
- Busy table timer now shows live `HH:MM:SS` and updates every second.
- Moving a table preserves original occupied time; timer does not restart.
- Menu item and deal cards are fully clickable; plus button removed.
- Deal amount visibility fixed on compact cards.
- Payment modal now has a calculator for Cash, Card, Online, and Split Payment.
- Cash overpayment shows Change and is not counted as revenue.
- Card/Online extra amount is detected and blocked; exact amount required.
- Reports API/UI verified and expanded with shift cash separation.
- Opening Cash is shown separately in reports and is not counted as sale.
- Admin panel no longer shows customer-irrelevant Cloud/R2/Backup configuration tabs.
- Offline cache/service worker disabled; old local cache is unregistered automatically.
- Production direction is online cloud app + one-time local print agent.

## Clean package policy

No `node_modules`, no build cache, no test database.
