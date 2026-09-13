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

function keyFromPublicUrl(value, env = process.env) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const publicBase = String(env.R2_PUBLIC_URL || '').replace(/\/$/, '');
  if (publicBase && raw.startsWith(publicBase + '/')) return decodeURIComponent(raw.slice(publicBase.length + 1));
  if (!/^https?:\/\//i.test(raw) && !raw.startsWith('/uploads/')) return raw.replace(/^\//, '');
  return '';
}

function makeMediaKey({ tenant = 'default', folder = 'uploads', filename = 'file' } = {}) {
  const ext = String(filename).includes('.') ? String(filename).split('.').pop().toLowerCase() : 'bin';
  const safeTenant = String(tenant).replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
  const safeFolder = String(folder).replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
  const safeExt = String(ext).replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin';
  return `${safeTenant}/${safeFolder}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${safeExt}`;
}

function makeBackupKey({ tenant = 'swifttill', date = new Date(), type = 'daily' } = {}) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const stamp = d.toISOString().replace(/[:.]/g, '-');
  return `${tenant}/backups/${type}/${y}/${m}/${day}/swifttill-${type}-${stamp}.json`;
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

function s3Client(env = process.env) {
  if (!hasR2Config(env)) {
    const err = new Error('Cloudflare R2 is not configured');
    err.status = 503;
    throw err;
  }
  const { S3Client } = require('@aws-sdk/client-s3');
  return new S3Client({
    region: 'auto',
    endpoint: endpoint(env),
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY
    }
  });
}

async function uploadImageToR2({ key, body, contentType }, env = process.env) {
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  await s3Client(env).send(new PutObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: key,
    Body: body,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable'
  }));
  return { key, url: publicUrlForKey(key, env) };
}

async function putJsonToR2({ key, json }, env = process.env) {
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  const body = Buffer.from(JSON.stringify(json, null, 2));
  await s3Client(env).send(new PutObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: key,
    Body: body,
    ContentType: 'application/json; charset=utf-8',
    CacheControl: 'private, max-age=0, no-cache'
  }));
  return { key, url: publicUrlForKey(key, env), bytes: body.length };
}

async function deleteObjectFromR2(key, env = process.env) {
  const cleanKey = String(key || '').replace(/^\//, '');
  if (!cleanKey || !hasR2Config(env)) return { ok: false, skipped: true };
  const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
  await s3Client(env).send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: cleanKey }));
  return { ok: true, key: cleanKey };
}


async function listObjectsFromR2({ prefix = '', maxKeys = 1000 } = {}, env = process.env) {
  if (!hasR2Config(env)) return [];
  const { ListObjectsV2Command } = require('@aws-sdk/client-s3');
  const client = s3Client(env);
  const objects = [];
  let ContinuationToken;
  do {
    const result = await client.send(new ListObjectsV2Command({
      Bucket: env.R2_BUCKET_NAME,
      Prefix: String(prefix || ''),
      MaxKeys: Math.min(Math.max(Number(maxKeys) || 1000, 1), 1000),
      ContinuationToken
    }));
    for (const item of result.Contents || []) {
      if (item && item.Key) objects.push({ key: item.Key, size: item.Size || 0, lastModified: item.LastModified || null });
    }
    ContinuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return objects;
}

async function deleteObjectsFromR2(keys = [], env = process.env) {
  const unique = [...new Set((keys || []).map(k => String(k || '').replace(/^\//, '')).filter(Boolean))];
  const results = [];
  for (const key of unique) {
    try {
      results.push(await deleteObjectFromR2(key, env));
    } catch (e) {
      results.push({ ok: false, key, error: e.message });
    }
  }
  return { ok: results.every(r => r.ok || r.skipped), deleted: results.filter(r => r.ok).length, results };
}

module.exports = {
  hasR2Config,
  endpoint,
  publicUrlForKey,
  keyFromPublicUrl,
  makeMediaKey,
  makeBackupKey,
  assertImage,
  uploadImageToR2,
  putJsonToR2,
  deleteObjectFromR2,
  listObjectsFromR2,
  deleteObjectsFromR2
};
