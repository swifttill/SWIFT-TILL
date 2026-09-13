'use strict';

const crypto = require('crypto');

function hasR2Config(env = process.env) {
  return Boolean(env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET_NAME);
}

function endpoint(env = process.env) {
  return env.R2_ENDPOINT || (env.R2_ACCOUNT_ID ? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : '');
}

function publicUrlForKey(key, env = process.env) {
  const base = (env.R2_PUBLIC_URL || '').replace(/\/$/, '');
  return base ? `${base}/${String(key).replace(/^\//, '')}` : '';
}

function makeMediaKey({ tenant = 'default', folder = 'uploads', filename = 'file' } = {}) {
  const ext = String(filename).includes('.') ? String(filename).split('.').pop().toLowerCase() : 'bin';
  const safeTenant = String(tenant).replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
  const safeFolder = String(folder).replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
  const safeExt = String(ext).replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin';
  return `${safeTenant}/${safeFolder}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${safeExt}`;
}

function assertImage({ contentType, bytes }) {
  const allowed = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml']);
  if (!allowed.has(String(contentType || '').toLowerCase())) {
    const err = new Error('Only PNG, JPG, WEBP or SVG images are allowed');
    err.status = 422;
    throw err;
  }
  const maxMb = Number(process.env.MAX_IMAGE_MB || 4);
  if (Buffer.byteLength(bytes) > maxMb * 1024 * 1024) {
    const err = new Error(`Image too large. Max ${maxMb}MB`);
    err.status = 413;
    throw err;
  }
}

async function uploadImageToR2({ key, body, contentType }, env = process.env) {
  if (!hasR2Config(env)) {
    const err = new Error('Cloudflare R2 is not configured');
    err.status = 503;
    throw err;
  }
  const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
  const client = new S3Client({
    region: 'auto',
    endpoint: endpoint(env),
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY
    }
  });
  await client.send(new PutObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: key,
    Body: body,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable'
  }));
  return { key, url: publicUrlForKey(key, env) };
}

module.exports = {
  hasR2Config,
  endpoint,
  publicUrlForKey,
  makeMediaKey,
  assertImage,
  uploadImageToR2
};
