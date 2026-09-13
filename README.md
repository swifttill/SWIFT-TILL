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
