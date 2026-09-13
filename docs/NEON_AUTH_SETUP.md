# Neon + Auth setup

1. Create a Neon project.
2. Copy the pooled PostgreSQL connection string.
3. Put it in `.env` as `DATABASE_URL`.
4. Set a long random `SESSION_SECRET`.
5. Run:

```powershell
npm install
npm run db:generate
npm run db:push
npm run db:seed
npm start
```

Production passwords must be changed from the admin panel after first login.
