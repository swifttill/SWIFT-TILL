# Phase 8 — Production Foundation

This phase preserves the approved V7 POS UI while adding the production foundation for the real SwiftTill cloud project.

## Locked product direction

- Online cloud POS first.
- Local offline mode disabled.
- Local print agent allowed for one-time client PC printer access.
- GitHub source control.
- Neon PostgreSQL production database.
- Cloudflare R2 for uploaded menu/category/deal/logo media.
- Render or Vercel deployment after local verification.

## Phase 8 changes

- Added `.gitignore` for clean source control.
- Added production `.env.example`.
- Added Prisma/PostgreSQL schema draft under `packages/db/prisma/schema.prisma`.
- Added database adapter boundary under `packages/db/src/client.js`.
- Added R2 storage helper boundary under `packages/storage/src/r2.js`.
- Added GitHub Actions validation workflow.
- Added production deployment checklist.
- Kept local JSON runtime working so the UI can still be tested immediately.

## What remains deliberately local in this ZIP

The current API still runs with local JSON data for quick local testing. The new database schema and adapter boundary prepare the next phase where local JSON endpoints are replaced with real Neon-backed API routes.

## Next phase

Phase 9 should implement:

- real password hashing
- real sessions/JWT
- Prisma client integration
- Neon migrations
- CRUD APIs for company, users, roles, menu, deals, tables and reports
- production-safe validations
