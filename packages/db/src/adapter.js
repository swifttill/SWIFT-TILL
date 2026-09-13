let prismaClient = null;

function hasDatabaseUrl() {
  return Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('postgres'));
}

async function getPrisma() {
  if (!hasDatabaseUrl()) return null;
  if (prismaClient) return prismaClient;
  try {
    const { PrismaClient } = require('@prisma/client');
    prismaClient = new PrismaClient();
    await prismaClient.$connect();
    return prismaClient;
  } catch (error) {
    error.message = `Prisma database connection failed: ${error.message}`;
    throw error;
  }
}

function requirePrisma() {
  if (!hasDatabaseUrl()) {
    throw new Error('DATABASE_URL is required for production database mode');
  }
  return getPrisma();
}

module.exports = { hasDatabaseUrl, getPrisma, requirePrisma };
