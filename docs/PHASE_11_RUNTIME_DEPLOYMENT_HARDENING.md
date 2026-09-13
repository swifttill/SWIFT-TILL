# SwiftTill POS — Phase 11 Runtime Deployment Hardening

Phase 11 locks the deployment foundation after Neon was successfully connected.

## Added

- API server now loads `.env` at startup.
- Startup console shows whether `DATABASE_URL` is loaded.
- Startup console shows whether Cloudflare R2 is configured or local fallback is active.
- `/api/health` endpoint checks application, database and storage mode.
- `/api/env-check` endpoint confirms runtime environment loading without exposing secrets.
- PostgreSQL seed now creates the full demo operating baseline:
  - organization
  - branch
  - permissions
  - Admin / Manager / Cashier roles
  - demo users
  - categories
  - menu items
  - modifiers
  - deals
  - deal items
  - dining tables
  - order takers
  - receipt settings
- Seed is idempotent, so it can be run again safely.

## Local verification

```powershell
cd "E:\swift-till\SWIFT-TILL"
npm install
npm run db:generate
npm run db:push
npm run db:seed
npm start
```

Open:

```text
http://localhost:5174/api/health
http://localhost:5174/api/env-check
http://localhost:5174
```

## Expected startup

```text
SwiftTill POS running: http://localhost:5174
Runtime env: DATABASE_URL=loaded, R2=configured/local fallback
Login: use owner-issued admin credentials; change bootstrap password before client use
```

## Important

This phase verifies production runtime configuration before the next phase connects remaining POS order write flows directly to PostgreSQL.
