const { getPrisma, requirePrisma, hasDatabaseUrl } = require('./adapter');

async function databaseHealth() {
  if (!hasDatabaseUrl()) return { mode: 'local-json', ok: true, note: 'DATABASE_URL not set; local development fallback active.' };
  const prisma = await getPrisma();
  await prisma.$queryRaw`SELECT 1`;
  return { mode: 'postgresql', ok: true };
}

module.exports = { getPrisma, requirePrisma, hasDatabaseUrl, databaseHealth };
