# SwiftTill POS Monorepo V9

Real database and auth foundation for SwiftTill POS.

V9 keeps the approved V7/V8 POS UI direction and adds the production layer for Neon PostgreSQL, Prisma, password hashing, token sessions, seeded users/roles/permissions, and protected-route planning.

## Run locally

```powershell
npm install
npm start
```

Open: http://localhost:5174

## Real database setup

```powershell
copy .env.example .env
# edit DATABASE_URL and SESSION_SECRET
npm run db:generate
npm run db:push
npm run db:seed
npm start
```

## Login

```text
admin@swifttill.local / admin123
manager@swifttill.local / manager123
cashier@swifttill.local / cashier123
```

## Phase 9 additions

- Auth package with password hashing and signed sessions.
- Prisma/Neon database adapter boundary.
- PostgreSQL seed script for organization, branch, roles, permissions and users.
- Neon setup guide.
- Production env structure.
- DB scripts: generate, push, migrate, seed.
- Validation includes auth smoke test.

## Clean package policy

No `node_modules`, no build cache, no test database, no `.env` secrets.

---

# SwiftTill POS Monorepo V8

SwiftTill POS V8 is the production-foundation package for the real cloud project. It preserves the approved V7 POS/admin UI while adding the structure needed for Neon PostgreSQL, Cloudflare R2, GitHub workflow, Render/Vercel deployment and local thermal print-agent integration.

## Current status

```text
V7 UI/runtime: preserved
V8 production foundation: added
Local test mode: working through JSON runtime
Production database schema: added
R2 storage boundary: added
GitHub workflow: added
Offline mode: disabled direction
Print: cloud POS + local print agent
```

## Run locally

```powershell
cd "E:\swift-till\SWIFT-TILL"
npm install
npm start
```

Open:

```text
http://localhost:5174
```

## App-window mode

```powershell
.\START_SWIFTTILL_APP_WINDOW.bat
```

This opens SwiftTill like a desktop app window instead of a normal browser tab.

## Local print agent

```powershell
.\START_SWIFTTILL_PRINT_AGENT.bat
```

The cloud POS can send receipt payloads to this local agent for thermal printing.

## Login

```text
admin@swifttill.local / admin123
manager@swifttill.local / manager123
cashier@swifttill.local / cashier123
```

Manager PIN:

```text
1234
```

## Added in V8

```text
.gitignore
.env.example production variables
packages/db/prisma/schema.prisma
packages/db/src/client.js
packages/storage/src/r2.js
.github/workflows/validate.yml
docs/PHASE_8_PRODUCTION_FOUNDATION.md
docs/DEPLOYMENT_CHECKLIST.md
docs/PRINT_AGENT_SPEC.md
```

## Production infrastructure decision

```text
Source code: GitHub
Database: Neon PostgreSQL
Images/media: Cloudflare R2
Hosting: Render first, Vercel optional later
Thermal printing: local Windows print agent
POS mode: online cloud app
```

## Next phase

Phase 9 should replace the local JSON API persistence with a real Neon/PostgreSQL implementation using the V8 Prisma schema and DB adapter boundary.

## Clean package policy

No `node_modules`, no build cache, no test database, no `.env` secrets.


## V10 Admin CRUD + R2 Media

- Admin CRUD delete endpoints added.
- Admin delete UI actions added.
- Cloudflare R2 image upload boundary implemented.
- Local upload fallback retained for development when R2 env is missing.
- Seed script loads `.env` directly.
- R2 variables are documented for Render deployment.


## Phase 11 — Runtime Deployment Hardening

- API now loads `.env` automatically.
- Added `/api/health` and `/api/env-check`.
- Startup console confirms DATABASE_URL and R2 mode.
- PostgreSQL seed now creates full demo setup: organization, branch, users, roles, permissions, menu, modifiers, deals, tables, order takers and receipt settings.

Run:

```powershell
npm run db:generate
npm run db:push
npm run db:seed
npm start
```

Check:

```text
http://localhost:5174/api/health
http://localhost:5174/api/env-check
```

## Phase 12 — Real POS Order Engine

This package adds production cleanup for Render deployment:

- `/api/health` public status endpoint.
- `/api/env-check` public safe environment status endpoint.
- Production image uploads require Cloudflare R2.
- Local upload fallback is development-only.
- Render production data store uses Neon-backed `swifttill_app_state` cloud state.
- Startup logs clearly show `DATABASE_URL`, data-store mode, and R2 configuration status.

Live checks after deploy:

```text
https://swift-till.onrender.com/api/health
https://swift-till.onrender.com/api/env-check
```


## Phase 13

Real POS order engine hardening: synchronous persistence, stricter order/payment validation, cash-change rules and `/api/order-engine/status`.


## Phase 14 — Production Data Clean

This phase removes demo restaurant/catalog/table/order-taker seed data from the runtime bootstrap. The app now starts with only bootstrap access, roles, permissions and payment methods. Real business logo, categories, items, deals, tables and order takers must be added from Admin and saved to Neon/R2. It also fixes `/api/order-engine/status` database initialization.


## Phase 15 — POS Flow Guards + Processing Overlay

Fixes live POS issues reported after V14:
- Empty dine-in orders no longer make tables busy.
- Hold, save, pay and split bill require at least one item/deal line.
- Open Orders and table busy status ignore empty drafts.
- `/api/order-engine/status` reports Phase 15 and real counts.
- Global processing overlay blocks double-click/interruption during API, upload, login, save, payment, report and admin operations.
- Sidebar Deals buttons no longer truncate/hide text.


## Phase 16 — Operational Audit Fixes

- Blocks zero-price items and deals in POS billing.
- Makes Sale Price required and obvious in Admin item/deal editors.
- Prevents Rs 0 payment modal from opening.
- Keeps empty orders from holding, paying, or making tables busy.
- Adds lightweight fast cloud-save indicator instead of heavy full-screen freeze.
- Removes hardcoded login logo image fallback; runtime uses real Admin Settings logo/brand.
- Updates Cloud/R2 status wording to production-connected.


## Phase 17

Print/report operational fixes: unpaid bill print, safe print area, browser/agent receipt fallback, and visible report loading/error states.


## Phase 18 — Backup, History & Media Cleanup

This package adds production-safe retention and media cleanup for the real restaurant workflow. Paid orders remain historical records for reports even when the live menu item/category/deal is later deleted. Line name, price and category snapshots are kept on the paid order so reports do not break after menu cleanup.

Production media cleanup rules:

- Replacing a category/item/deal image deletes the previous Cloudflare R2 object when it is not reused.
- Deleting a category/item/deal removes its menu image from R2 when safe.
- Replacing the company logo deletes the old R2 logo when safe.
- Shared media is not deleted if another active record still uses it.
- Paid order history remains available for reports.

Backup rules:

- Neon cloud state remains the primary live database.
- Manual backups can be created/downloaded from Admin → Backup / History.
- Automatic daily backup is indexed and pushed to Cloudflare R2 when configured.
- Daily backup retention target: 30 days.
- Monthly backup retention target: 12 months.

Live checks after deploy:

```text
https://swift-till.onrender.com/api/health
https://swift-till.onrender.com/api/env-check
https://swift-till.onrender.com/api/order-engine/status
```

Expected order engine version:

```text
18.0.0-backup-history-media-cleanup
```
