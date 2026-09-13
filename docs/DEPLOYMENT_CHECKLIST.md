# SwiftTill Deployment Checklist

## Local verification

```powershell
cd "E:\swift-till\SWIFT-TILL"
npm install
npm run validate
npm start
```

Open:

```text
http://localhost:5174
```

## Git workflow

```powershell
git checkout -b phase-8-production-foundation
git add .
git commit -m "Phase 8 production foundation"
git push -u origin phase-8-production-foundation
```

## Neon setup

Required:

- Create Neon project.
- Copy pooled connection string.
- Put it in `DATABASE_URL`.
- Use SSL mode required.

## Cloudflare R2 setup

Required:

- Create bucket: `swifttill-media`.
- Create R2 API token with object read/write.
- Set public/custom domain if used.
- Fill R2 variables in `.env`.

## Render/Vercel

Initial simple deployment can use Render web service:

```text
Build command: npm install
Start command: npm start
```

After the frontend/backend split becomes production-grade, Vercel can host web/admin and Render can host API.
