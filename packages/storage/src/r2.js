'use strict';

const crypto = require('crypto');

function hasR2Config(env = process.env) {
  return Boolean(env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET_NAME);
}

function publicUrlForKey(key, env = process.env) {
  const base = (env.R2_PUBLIC_URL || '').replace(/\/$/, '');
  return base ? `${base}/${String(key).replace(/^\//, '')}` : '';
}

function makeMediaKey({ tenant = 'default', folder = 'uploads', filename = 'file' } = {}) {
  const ext = String(filename).includes('.') ? String(filename).split('.').pop().toLowerCase() : 'bin';
  const safeTenant = String(tenant).replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
  const safeFolder = String(folder).replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
  return `${safeTenant}/${safeFolder}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
}

module.exports = {
  hasR2Config,
  publicUrlForKey,
  makeMediaKey
};
