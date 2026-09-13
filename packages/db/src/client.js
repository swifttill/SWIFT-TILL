'use strict';

/**
 * Production DB adapter boundary.
 * V8 keeps the current local JSON runtime working, but all new backend code
 * must call this boundary so Neon/PostgreSQL can replace local JSON cleanly.
 */
const STORAGE_MODE = process.env.STORAGE_MODE || 'local-json';

function getStorageMode() {
  return STORAGE_MODE;
}

function requireDatabaseUrl() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required when STORAGE_MODE=postgres');
  }
  return process.env.DATABASE_URL;
}

function assertProductionDatabaseReady() {
  if ((process.env.STORAGE_MODE || '').toLowerCase() === 'postgres') {
    requireDatabaseUrl();
  }
  return true;
}

module.exports = {
  getStorageMode,
  requireDatabaseUrl,
  assertProductionDatabaseReady
};
