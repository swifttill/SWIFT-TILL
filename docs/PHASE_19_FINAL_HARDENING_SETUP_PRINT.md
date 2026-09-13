# SwiftTill POS Monorepo V19 — Final Hardening, Setup & Print Test

Production stack remains Render + Neon PostgreSQL + Cloudflare R2.

## Phase 19 additions

- Restaurant Setup tab in Admin
- Setup checklist for business profile, categories, priced menu items, tables, order takers and password change
- Change Password endpoint and UI
- Default production passwords blocked when changing password
- Print Agent test button from Admin setup/settings
- Browser fallback print if local print agent is not running
- `/api/print-agent/sample` admin printer test payload
- `/api/order-engine/status` reports setup and print-agent readiness
- V18 backup/history/media cleanup preserved
- No demo restaurant/menu/tables/deals/images reintroduced

## Copy to repository

```powershell
Expand-Archive -Path "$env:USERPROFILE\Downloads\SwiftTill_POS_Monorepo_V19_Final_Hardening_Setup_Print.zip" `
  -DestinationPath "E:\pos\SwiftTill_POS_Monorepo_V19" -Force

robocopy "E:\pos\SwiftTill_POS_Monorepo_V19" "E:\swift-till\SWIFT-TILL" /E /XD .git node_modules /XF .env *.log

cd "E:\swift-till\SWIFT-TILL"
npm install
npm run db:generate
git status
git add .
git commit -m "Phase 19 final hardening setup and print test"
git push origin main
```

## Live checks

```text
https://swift-till.onrender.com/api/health
https://swift-till.onrender.com/api/env-check
https://swift-till.onrender.com/api/order-engine/status
```

Expected version: `19.0.0-final-hardening-setup-print`.
