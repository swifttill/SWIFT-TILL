# SwiftTill POS Phase 12 — Production Cleanup

Phase 12 removes the confusing production/local boundary for live testing.

## Added

- Public `/api/health` endpoint.
- Public safe `/api/env-check` endpoint with no secret values.
- Production upload enforcement: if `NODE_ENV=production`, media upload requires Cloudflare R2.
- Local upload fallback remains only for local development.
- PostgreSQL cloud-state persistence for the current POS runtime state when `DATABASE_URL` is present in production.
- Startup runtime log now shows database, data-store, and R2 mode.
- Render/Neon/R2 test instructions updated.

## Runtime Modes

### Production Render

Expected:

```text
DATABASE_URL=loaded
DATA_STORE=postgresql-cloud-state
R2=configured
```

### Local Development

Expected:

```text
DATA_STORE=local-json
R2=missing/local-dev-fallback
```

## Required live checks

```text
https://swift-till.onrender.com/api/health
https://swift-till.onrender.com/api/env-check
https://swift-till.onrender.com
```

`/api/env-check` intentionally returns only safe status flags and never returns secret values.
