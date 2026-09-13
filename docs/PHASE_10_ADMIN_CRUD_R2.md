# Phase 10 — Admin CRUD + Cloudflare R2 Images

This phase converts media handling from local-only placeholders to a production R2-ready boundary and improves admin CRUD operations.

## Added

- Cloudflare R2 upload implementation using the S3-compatible SDK.
- Image validation for PNG, JPG, WEBP and SVG.
- File size control through `MAX_IMAGE_MB`.
- R2 key generation with tenant/folder pathing.
- Admin delete API for categories, menu items, deals, tables, order takers, payment methods, users and roles.
- Admin delete UI buttons with permission-protected backend enforcement.
- Seed script `.env` loading fix using `dotenv`.
- Production environment variable checklist for Neon and R2.

## Media flow

Admin uploads image → API validates payload → if R2 env is configured, upload to Cloudflare R2 → save public URL/key → frontend displays R2 public URL.

If R2 is not configured in local development, uploads fall back to `apps/web/public/uploads`.

## Required R2 env

```env
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=swifttill-media
R2_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
R2_PUBLIC_URL=https://pub-xxxxx.r2.dev
MAX_IMAGE_MB=4
```

## Admin CRUD

Create/update/delete is available for operational setup records. System records cannot be deleted.

## Next

Phase 11 should wire live Prisma-backed persistence into operational APIs instead of JSON fallback.
