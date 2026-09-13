# SwiftTill POS Production Path

## Phase 1: Local verification
Use the ZIP locally only to test UI, POS flow, admin flow, reports, permissions and print-agent behavior.

## Phase 2: GitHub
Create repository, push the complete monorepo, keep secrets out of code, and use `.env.example` only.

## Phase 3: Neon PostgreSQL
Replace local JSON persistence with PostgreSQL tables for users, roles, permissions, menu, orders, payments, shifts, reports and audit logs.

## Phase 4: Cloudflare R2
Replace local `/uploads` image storage with S3-compatible Cloudflare R2 upload. Save only image key and public URL in database.

## Phase 5: Render/Vercel
Use Render for API/full-stack hosting or Vercel frontend plus Render API if split hosting is needed.

## Phase 6: Client PC app-window + print agent
Install a small Windows launcher/shortcut and the SwiftTill Print Agent once. POS opens in Chrome/Edge app-window mode and sends thermal receipt jobs to the local agent.

## Final direction
Production is online-only. Offline cache is disabled. Printer access is handled by local print agent because browser-only silent thermal printing is unreliable.
