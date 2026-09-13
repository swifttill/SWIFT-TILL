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

## Phase 12 — Production Cleanup

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
