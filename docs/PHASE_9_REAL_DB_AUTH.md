# Phase 9 — Real Database + Auth

Phase 9 converts SwiftTill from a local JSON prototype foundation toward real production authentication and Neon PostgreSQL.

## Added

- `packages/auth` with password hashing and signed token sessions.
- `packages/db/src/adapter.js` with Prisma/Neon connection boundary.
- `packages/db/seed.js` for organization, branch, permissions, roles and first users.
- Production `.env.example` with Neon, session and R2 variables.
- Database scripts in root `package.json`.
- SQL deployment reference under `packages/db/sql/`.

## Auth rules

Default users are seeded only for development. Production must change passwords immediately.

- Admin: full control.
- Manager: POS operations, approvals, reports, menu/table/payment/printer controls.
- Cashier: POS billing only; no reports/admin.

## Local mode

If `DATABASE_URL` is missing, the app can still run with current local fallback for UI testing.

## Production mode

Set `DATABASE_URL` to Neon, then run:

```powershell
npm install
npm run db:generate
npm run db:push
npm run db:seed
npm start
```

## Next Phase

Phase 10 should wire all Admin CRUD and image uploads to PostgreSQL + Cloudflare R2 instead of local JSON/storage fallback.
