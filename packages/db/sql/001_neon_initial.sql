-- SwiftTill POS V9 initial PostgreSQL foundation.
-- Primary schema is Prisma-managed: packages/db/prisma/schema.prisma
-- Use this file as deployment/audit reference when reviewing generated migrations.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Run:
-- npm run db:generate
-- npm run db:push      -- for first Neon dev database
-- npm run db:seed
