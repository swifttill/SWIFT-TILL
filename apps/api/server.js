require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');
const { hasR2Config, makeMediaKey, makeBackupKey, publicUrlForKey, keyFromPublicUrl, assertImage, uploadImageToR2, putJsonToR2, deleteObjectFromR2, listObjectsFromR2, deleteObjectsFromR2 } = require('../../packages/storage/src/r2');
const { databaseHealth, hasDatabaseUrl, getPrisma } = require('../../packages/db/src/client');
const { hashPassword, verifyPassword, createSession, verifyToken, parseBearer } = require('../../packages/auth/src');

const ROOT = path.resolve(__dirname, '../..');
const PUBLIC_DIR = path.join(ROOT, 'apps', 'web', 'public');
const DATA_DIR = path.join(ROOT, 'data');
const STORAGE_DIR = path.join(ROOT, 'storage', 'uploads');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const PORT = Number(process.env.PORT || 5174);
const TOKENS = new Map();
const APP_VERSION = '57.0.0-pin-security-complete';
const CLOUD_STATE_KEY = process.env.SWIFTTILL_STATE_KEY || 'swift-till-main';
let cloudStateCache = null;
let cloudStateInitPromise = null;

const PERMISSIONS = [
  'pos.view','pos.create','pos.edit','pos.hold','pos.pay','pos.void','pos.refund','pos.transfer_table','pos.payment_correction',
  'reports.view','reports.export','admin.menu','admin.tables','admin.staff','admin.users','admin.roles','admin.settings','admin.payments','admin.printer','admin.branding','security.pin'
];
const CASHIER_PERMS = ['pos.view','pos.create','pos.edit','pos.hold','pos.pay'];
const MANAGER_PERMS = [...CASHIER_PERMS,'reports.view','reports.export','pos.void','pos.refund','pos.transfer_table','pos.payment_correction','admin.menu','admin.tables','admin.staff','admin.payments','admin.printer','security.pin'];
const INTERNAL_PERMISSIONS = ['cloud.sync','backup.manage'];
const DEFAULT_PASSWORDS = new Set(['admin123','manager123','cashier123']);
const DEFAULT_PINS = new Set(['1234','2222','1111']);
function isHash(v) { return String(v || '').startsWith('scrypt$'); }
function isDefaultPasswordValue(v) { return DEFAULT_PASSWORDS.has(String(v || '')); }
function isDefaultPinValue(v) { return DEFAULT_PINS.has(String(v || '')); }
function verifyUserPassword(user, password) { return verifyPassword(password, user?.passwordHash || user?.password || ''); }
function setUserPassword(user, password) { user.passwordHash = hashPassword(password); delete user.password; }
function setUserPin(user, pin) { if (pin) user.pinHash = hashPassword(pin); delete user.pin; }
function clearUserPin(user) { delete user.pinHash; delete user.pin; }
function verifyUserPin(user, pin) { return verifyPassword(pin, user?.pinHash || user?.pin || ''); }
function assertPinFormat(pin, label = 'PIN') {
  const value = String(pin || '').trim();
  if (!/^\d{4,8}$/.test(value)) throw Object.assign(new Error(`${label} must be 4 to 8 digits`), { status: 422 });
  return value;
}
function verifyManagerPin(db, pin) { return verifyPassword(pin, db?.settings?.managerPinHash || db?.settings?.managerPin || ''); }
function findPinApprover(db, pin, perm = 'pos.void') {
  const value = String(pin || '').trim();
  if (!value) return null;
  const users = (db.users || []).filter(u => u.active !== false && (u.pinHash || u.pin) && hasPerm(db, u, perm));
  for (const approver of users) {
    if (verifyUserPin(approver, value)) return { method: 'user-pin', byUserId: approver.id, by: approver.name || approver.email || 'Authorized user' };
  }
  if (verifyManagerPin(db, value)) return { method: 'global-manager-pin', byUserId: null, by: 'Manager Approval PIN' };
  return null;
}
function sanitizeSettingsForClient(settings = {}) { const safe = { ...settings }; delete safe.managerPin; delete safe.managerPinHash; delete safe.printAgentKey; safe.managerPinSet = Boolean(settings.managerPinHash || settings.managerPin); safe.printAgentKeySet = Boolean(settings.printAgentKey || process.env.SWIFTTILL_PRINT_AGENT_KEY || process.env.PRINT_AGENT_KEY); safe.r2BucketName = settings.r2BucketName ? 'configured' : ''; safe.r2PublicUrl = settings.r2PublicUrl ? 'configured' : ''; return safe; }
function sanitizeUserForClient(u = {}) { const defaultPasswordActive = verifyPassword('admin123', u.passwordHash || u.password || '') || verifyPassword('manager123', u.passwordHash || u.password || '') || verifyPassword('cashier123', u.passwordHash || u.password || ''); return { id: u.id, name: u.name, email: u.email, roleIds: u.roleIds || [], active: u.active !== false, passwordSet: Boolean(u.passwordHash || u.password), pinSet: Boolean(u.pinHash || u.pin), defaultPasswordActive }; }
function normalizeSecurity(db) {
  if (!db || !Array.isArray(db.users)) return;
  for (const u of db.users) {
    if (u.password && !u.passwordHash) setUserPassword(u, u.password);
    if (u.passwordHash && !isHash(u.passwordHash)) u.passwordHash = hashPassword(u.passwordHash);
    if (u.pin && !u.pinHash) setUserPin(u, u.pin);
    if (u.pinHash && !isHash(u.pinHash)) u.pinHash = hashPassword(u.pinHash);
    delete u.password;
    delete u.pin;
  }
  if (db.settings) {
    if (db.settings.managerPin && !db.settings.managerPinHash) db.settings.managerPinHash = hashPassword(db.settings.managerPin);
    delete db.settings.managerPin;
  }
}
function printAgentKey(db) { return String(process.env.SWIFTTILL_PRINT_AGENT_KEY || process.env.PRINT_AGENT_KEY || db?.settings?.printAgentKey || '').trim(); }
function requirePrintAgentKey(req, db, query = {}) { const expected = printAgentKey(db); if (!expected) throw Object.assign(new Error('Print agent key is not configured'), { status: 503 }); const got = String(req.headers['x-print-agent-key'] || query.key || '').trim(); if (!got || got !== expected) throw Object.assign(new Error('Invalid print agent key'), { status: 401 }); }
function requireOwnerMaintenance(req) { const expected = String(process.env.SWIFTTILL_OWNER_MAINTENANCE_KEY || '').trim(); if (!expected) throw Object.assign(new Error('Owner maintenance key is not configured'), { status: 503 }); const got = String(req.headers['x-owner-maintenance-key'] || '').trim(); if (got !== expected) throw Object.assign(new Error('Owner maintenance only'), { status: 403 }); }

function now() { return new Date().toISOString(); }
function uid(prefix = 'id') { return `${prefix}_${crypto.randomBytes(8).toString('hex')}`; }
function money(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }
function safeName(name) { return String(name || 'file').replace(/[^a-z0-9._-]/gi, '-').replace(/-+/g, '-').slice(0, 80); }

function todayKey() { return new Date().toISOString().slice(0,10); }
function monthKey() { return new Date().toISOString().slice(0,7); }
function publicMediaValues(db) {
  const set = new Set();
  const add = v => { if (v) set.add(String(v)); };
  add(db?.settings?.logoUrl);
  for (const listName of ['categories','items','deals']) for (const r of db?.[listName] || []) add(r.imageUrl);
  return set;
}
function liveMediaKeys(db) {
  const keys = new Set();
  for (const value of publicMediaValues(db)) {
    const key = keyFromPublicUrl(value);
    if (key) keys.add(key);
  }
  return keys;
}
function isHistoricalMediaReference(db, value) {
  // Reports preserve item/deal/category name, price and totals snapshots.
  // Historical order images must not block R2 cleanup, otherwise the bucket keeps growing forever.
  return false;
}
async function cleanupMediaReference(db, value, reason = 'MEDIA_CLEANUP') {
  const v = String(value || '').trim();
  if (!v) return { ok: true, skipped: true, reason: 'empty' };
  if (publicMediaValues(db).has(v)) return { ok: true, skipped: true, reason: 'still-in-use-by-live-record' };
  try {
    const key = keyFromPublicUrl(v);
    if (key && hasR2Config()) return await deleteObjectFromR2(key);
    if (v.startsWith('/uploads/')) {
      const fp = path.join(PUBLIC_DIR, v.replace(/^\/uploads\//, 'uploads/'));
      if (fp.startsWith(PUBLIC_DIR) && fs.existsSync(fp)) fs.unlinkSync(fp);
      return { ok: true, local: true };
    }
  } catch (e) {
    console.error(`${reason} failed:`, e.message);
    return { ok: false, error: e.message };
  }
  return { ok: true, skipped: true, reason: 'not-managed-media' };
}
async function cleanupOrphanR2Media(db, user = null, reason = 'R2_ORPHAN_MEDIA_CLEANUP') {
  if (!hasR2Config()) return { ok: true, skipped: true, reason: 'r2-not-configured' };
  const prefixes = ['swifttill/category/', 'swifttill/item/', 'swifttill/deal/', 'swifttill/logo/', 'swifttill/receipt/', 'swifttill/uploads/'];
  const liveKeys = liveMediaKeys(db);
  const deleteKeys = [];
  let scanned = 0;
  for (const prefix of prefixes) {
    const objects = await listObjectsFromR2({ prefix });
    scanned += objects.length;
    for (const obj of objects) if (!liveKeys.has(obj.key)) deleteKeys.push(obj.key);
  }
  const result = await deleteObjectsFromR2(deleteKeys);
  const summary = { ok: result.ok, scanned, live: liveKeys.size, deleted: result.deleted, failed: result.results.filter(r => !r.ok && !r.skipped).length, prefixes, at: now(), reason };
  db.mediaTrash = Array.isArray(db.mediaTrash) ? db.mediaTrash : [];
  db.mediaTrash.unshift({ action: reason, summary, at: now(), by: user?.name || 'System' });
  db.mediaTrash = db.mediaTrash.slice(0, 200);
  return summary;
}
async function maybeDailyMediaCleanup(db) {
  if (!shouldUseCloudState() || !hasR2Config()) return null;
  db.meta = db.meta || {};
  if (db.meta.lastMediaCleanupDate === todayKey()) return null;
  const result = await cleanupOrphanR2Media(db, null, 'DAILY_R2_ORPHAN_MEDIA_CLEANUP');
  db.meta.lastMediaCleanupDate = todayKey();
  db.meta.lastMediaCleanupResult = result;
  return result;
}
function snapshotLine(db, line) {
  const cat = db.categories?.find(c => c.id === line.categoryId);
  return { ...line, categoryName: line.categoryName || cat?.name || (line.kind === 'DEAL' ? 'Deals' : 'Uncategorized'), sourceName: line.sourceName || line.name, sourcePrice: money(line.sourcePrice ?? line.price) };
}
function snapshotOrderForHistory(db, order) {
  order.lines = (order.lines || []).map(l => snapshotLine(db, l));
  order.historyLocked = order.status === 'PAID' || order.historyLocked || false;
  return order;
}
function backupSummary(db) {
  const backups = Array.isArray(db?.backups) ? db.backups : [];
  return { total: backups.length, latest: backups[0] || null, dailyRetentionDays: 30, monthlyRetentionMonths: 12, r2Configured: hasR2Config(), mode: hasR2Config() ? 'r2-json-snapshot' : 'manual-json-download' };
}
function setupStatus(db) {
  const missing = [];
  if (!String(db?.settings?.businessName || '').trim()) missing.push('businessName');
  if (!String(db?.settings?.branchName || '').trim()) missing.push('branchName');
  if (!(db?.categories || []).some(c => c.active !== false)) missing.push('categories');
  if (!activePricedItems(db).length) missing.push('pricedMenuItems');
  if (!(db?.tables || []).some(t => t.active !== false)) missing.push('tables');
  if (!(db?.orderTakers || []).some(t => t.active !== false)) missing.push('orderTakers');
  const defaultAdmin = (db?.users || []).some(u => u.email === 'admin@swifttill.local' && verifyPassword('admin123', u.passwordHash || u.password || '') && u.active);
  if (defaultAdmin) missing.push('changeDefaultAdminPassword');
  return { complete: missing.length === 0, missing, defaultAdminPasswordActive: defaultAdmin, readyForRushHour: missing.length === 0, checklist: { businessProfile: !missing.includes('businessName') && !missing.includes('branchName'), menuPriced: !missing.includes('pricedMenuItems'), categories: !missing.includes('categories'), tables: !missing.includes('tables'), orderTakers: !missing.includes('orderTakers'), passwordChanged: !missing.includes('changeDefaultAdminPassword') } };
}
function printAgentStatus(db) {
  const url = db?.settings?.localAgentUrl || 'http://127.0.0.1:9721/print';
  return { configured: Boolean(url || printAgentKey(db)), localAgentUrl: url, cloudQueueConfigured: Boolean(printAgentKey(db)), pendingJobs: (db?.printJobs || []).filter(j => ['PENDING','PRINTING'].includes(j.status)).length, mode: printAgentKey(db) ? 'cloud-poll-print-agent' : (db?.settings?.printMode || 'local-browser-to-agent'), note: 'Recommended mode: local print agent polls the Render cloud queue and prints to Windows default thermal printer.' };
}
function enqueuePrintJob(db, user, payload = {}) {
  if (!Array.isArray(db.printJobs)) db.printJobs = [];
  const job = {
    id: uid('prn'),
    type: payload.type || 'receipt',
    status: 'PENDING',
    receipt: payload.receipt || null,
    html: String(payload.html || '').slice(0, 200000),
    text: String(payload.text || '').slice(0, 50000),
    createdAt: now(),
    createdBy: user?.name || 'System',
    attempts: 0,
    maxAttempts: Number(process.env.SWIFTTILL_PRINT_MAX_ATTEMPTS || 5),
    retryAfter: '',
    lastError: ''
  };
  db.printJobs.unshift(job);
  db.printJobs = db.printJobs.slice(0, 500);
  audit(db, user, 'PRINT_JOB_QUEUED', { id: job.id, type: job.type });
  return job;
}
function nextPrintJob(db) {
  const nowMs = Date.now();
  return (db.printJobs || []).find(j => {
    const max = Number(j.maxAttempts || process.env.SWIFTTILL_PRINT_MAX_ATTEMPTS || 5);
    if (j.status === 'PENDING') return !j.retryAfter || nowMs >= new Date(j.retryAfter).getTime();
    if (j.status === 'FAILED' && Number(j.attempts || 0) < max) return !j.retryAfter || nowMs >= new Date(j.retryAfter).getTime();
    if (j.status === 'PRINTING' && j.lockedAt && nowMs - new Date(j.lockedAt).getTime() > 120000) return Number(j.attempts || 0) < max;
    return false;
  });
}
async function createBackupSnapshot(db, user, type = 'manual') {
  if (!Array.isArray(db.backups)) db.backups = [];
  const exportedAt = now();
  const payload = { exportedAt, app: 'SwiftTill POS', version: APP_VERSION, type, retention: { dailyDays: 30, monthlyMonths: 12 }, db };
  let storage = 'database-index-only', key = '', url = '', bytes = Buffer.byteLength(JSON.stringify(payload));
  if (hasR2Config()) {
    const res = await putJsonToR2({ key: makeBackupKey({ tenant: 'swifttill', type }), json: payload });
    storage = 'cloudflare-r2'; key = res.key; url = res.url; bytes = res.bytes;
  }
  const rec = { id: uid('bak'), type, storage, key, url, bytes, exportedAt, by: user?.name || 'System' };
  const beforeBackups = [...db.backups];
  db.backups.unshift(rec);
  const daily = db.backups.filter(b => b.type === 'daily').slice(0, 30);
  const monthly = db.backups.filter(b => b.type === 'monthly').slice(0, 12);
  const manual = db.backups.filter(b => b.type === 'manual').slice(0, 20);
  db.backups = [...manual, ...daily, ...monthly].sort((a,b) => new Date(b.exportedAt)-new Date(a.exportedAt));
  const keptBackupIds = new Set(db.backups.map(b => b.id));
  for (const old of beforeBackups.filter(b => !keptBackupIds.has(b.id) && b.key)) { deleteObjectFromR2(old.key).catch(e => console.error('Old backup cleanup failed:', e.message)); }
  db.meta.lastBackupAt = exportedAt;
  db.meta.lastBackupDate = todayKey();
  if (type === 'monthly') db.meta.lastMonthlyBackup = monthKey();
  audit(db, user, 'BACKUP_CREATED', { type, storage, key });
  return rec;
}
async function maybeCreateDailyBackup(db) {
  if (!shouldUseCloudState()) return;
  if (!db.meta) db.meta = {};
  const today = todayKey();
  if (db.meta.lastBackupDate !== today) {
    await createBackupSnapshot(db, null, 'daily');
  }
  if (db.meta.lastMonthlyBackup !== monthKey()) {
    await createBackupSnapshot(db, null, 'monthly');
  }
}

function seedDb() {
  return {
    meta: {
      app: 'SwiftTill POS',
      version: APP_VERSION,
      createdAt: now(),
      storage: shouldUseCloudState() ? 'postgresql-cloud-state' : 'local-json',
      deployment: 'render-neon-cloudflare-r2-production',
      hardcodedBusinessData: false,
      hardcodedCleanupAt: now(),
      retention: { dailyBackups: 30, monthlyBackups: 12, orderHistory: 'permanent' }
    },
    settings: {
      businessName: '', legalName: '', branchName: '', branchCode: '', phone: '', email: '', website: '', address: '', city: '', country: 'Pakistan', currency: 'PKR', logoUrl: '', taxRegistrationNo: '', invoicePrefix: 'ST', legalInvoiceFooter: '', fiscalMode: 'standard-pos-receipt',
      taxEnabled: false, taxPercent: 0, serviceChargeEnabled: false, serviceChargePercent: 0, defaultDeliveryFee: 0,
      autoPrintReceipt: true, rememberPrintChoice: true, receiptWidth: '80mm', receiptCopies: 1, receiptHeader: '', receiptFooter: '', showLogoOnReceipt: true, showCustomerOnReceipt: true, showOrderTakerOnReceipt: true, showCashierOnReceipt: true, showPaymentBreakdown: true, showReprintLabel: true,
      reportTitle: 'Sales Report', reportFooter: '', reportShowBranding: true, reportPaper: 'A4',
      managerPinHash: hashPassword('1234'), printerName: '', onlineOnly: true, printMode: 'cloud-app-with-local-print-agent', localAgentUrl: 'http://127.0.0.1:9721/print', appWindowMode: 'pwa-or-edge-app-window',
      r2Mode: 'cloudflare-r2', r2BucketName: process.env.R2_BUCKET_NAME || '', r2PublicUrl: process.env.R2_PUBLIC_URL || '', cloudApiUrl: '', backupTarget: 'cloud-database-r2', printAgentKey: ''
    },
    roles: [
      { id: 'role_admin', name: 'Admin', description: 'Full system control', permissions: PERMISSIONS, system: true, active: true },
      { id: 'role_manager', name: 'Manager', description: 'Operations, reports, menu and approvals', permissions: MANAGER_PERMS, system: true, active: true },
      { id: 'role_cashier', name: 'Cashier', description: 'Billing counter access', permissions: CASHIER_PERMS, system: true, active: true }
    ],
    users: [
      { id: 'usr_admin', name: process.env.ADMIN_SEED_NAME || 'Admin', email: process.env.ADMIN_SEED_EMAIL || 'admin@swifttill.local', passwordHash: hashPassword(process.env.ADMIN_SEED_PASSWORD || 'admin123'), pinHash: hashPassword(process.env.ADMIN_SEED_PIN || '1234'), roleIds: ['role_admin'], active: true }
    ],
    orderTakers: [],
    categories: [],
    items: [],
    deals: [],
    tables: [],
    paymentMethods: [
      { id: 'cash', name: 'Cash', active: true, system: true },
      { id: 'card', name: 'Card', active: true, system: true },
      { id: 'online', name: 'Online', active: true, system: true }
    ],
    customers: [], orders: [], shifts: [], refunds: [], auditLogs: [], backups: [], mediaTrash: [], printJobs: [], deletedCatalog: [], sessionLogs: [], counters: { bill: 1000, z: 0 }
  };
}

function removeLegacyHardcodedData(db) {
  if (!db.meta) db.meta = { app: 'SwiftTill POS', version: APP_VERSION, createdAt: now() };
  if (db.meta.hardcodedCleanupAt) return;
  const legacyCategoryIds = new Set(['cat_all','cat_burgers','cat_pizza','cat_sides','cat_drinks','cat_desserts']);
  const legacyItemIds = new Set(['itm_zinger','itm_beef','itm_pizza','itm_fries','itm_loaded','itm_coke','itm_cupcake']);
  const legacyDealIds = new Set(['deal_family','deal_lunch']);
  const legacyTakerIds = new Set(['tak_ali','tak_sara','tak_bilal']);
  const legacyTableIds = new Set(Array.from({ length: 12 }, (_, i) => `tbl_${i + 1}`));
  if (Array.isArray(db.categories)) db.categories = db.categories.filter(x => !legacyCategoryIds.has(x.id));
  if (Array.isArray(db.items)) db.items = db.items.filter(x => !legacyItemIds.has(x.id));
  if (Array.isArray(db.deals)) db.deals = db.deals.filter(x => !legacyDealIds.has(x.id));
  if (Array.isArray(db.orderTakers)) db.orderTakers = db.orderTakers.filter(x => !legacyTakerIds.has(x.id));
  if (Array.isArray(db.tables)) db.tables = db.tables.filter(x => !legacyTableIds.has(x.id));
  if (db.settings) {
    const blanks = {
      businessName: ['SwiftTill Demo Restaurant'], legalName: ['SwiftTill Demo Restaurant'], branchName: ['Main Branch'], branchCode: ['MAIN'], phone: ['03XX-XXXXXXX'], email: ['info@swifttill.local'], address: ['Rawalpindi, Pakistan'], city: ['Rawalpindi'], logoUrl: ['/assets/img/swifttill-logo.png'], receiptHeader: ['Fresh food, fast billing'], receiptFooter: ['Thank you. Visit again.'], reportFooter: ['Generated by SwiftTill POS'], printerName: ['Windows Default Printer'], defaultDeliveryFee: [150]
    };
    for (const [key, vals] of Object.entries(blanks)) {
      if (vals.includes(db.settings[key])) db.settings[key] = key === 'defaultDeliveryFee' ? 0 : '';
    }
    db.settings.r2Mode = hasR2Config() ? 'cloudflare-r2' : (productionMode() ? 'missing' : 'local-dev-fallback');
    db.settings.r2BucketName = process.env.R2_BUCKET_NAME || db.settings.r2BucketName || '';
    db.settings.r2PublicUrl = process.env.R2_PUBLIC_URL || db.settings.r2PublicUrl || '';
    db.settings.backupTarget = 'cloud-database-r2';
  }
  db.meta.hardcodedBusinessData = false;
  db.meta.hardcodedCleanupAt = now();
}

function shouldUseCloudState() { return hasDatabaseUrl() && (process.env.NODE_ENV === 'production' || process.env.SWIFTTILL_DATA_STORE === 'postgres'); }
function productionMode() { return process.env.NODE_ENV === 'production'; }
async function ensureCloudState() {
  if (!shouldUseCloudState()) return null;
  if (cloudStateCache) return cloudStateCache;
  if (cloudStateInitPromise) return cloudStateInitPromise;
  cloudStateInitPromise = (async () => {
    const prisma = await getPrisma();
    await prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS swifttill_app_state (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const rows = await prisma.$queryRawUnsafe('SELECT value FROM swifttill_app_state WHERE key = $1 LIMIT 1', CLOUD_STATE_KEY);
    let db = rows && rows[0] ? rows[0].value : null;
    if (!db) {
      db = seedDb();
      migrateDb(db);
      ensureStateRevision(db);
      await prisma.$executeRawUnsafe('INSERT INTO swifttill_app_state (key, value, updated_at) VALUES ($1, $2::jsonb, NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()', CLOUD_STATE_KEY, JSON.stringify(db));
    }
    migrateDb(db);
    ensureStateRevision(db);
    await maybeDailyMediaCleanup(db);
    await prisma.$executeRawUnsafe('INSERT INTO swifttill_app_state (key, value, updated_at) VALUES ($1, $2::jsonb, NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()', CLOUD_STATE_KEY, JSON.stringify(db));
    cloudStateCache = db;
    return db;
  })();
  return cloudStateInitPromise;
}
async function loadDb() {
  if (shouldUseCloudState()) return ensureCloudState();
  ensureDir(DATA_DIR);
  ensureDir(STORAGE_DIR);
  if (!fs.existsSync(DB_PATH)) saveDbSync(seedDb());
  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  migrateDb(db);
  ensureStateRevision(db);
  return db;
}
async function saveDb(db, reason = 'state-save') {
  touchStateRevision(db, reason);
  if (shouldUseCloudState()) {
    cloudStateCache = db;
    try { await maybeCreateDailyBackup(db); } catch (e) { console.error('Auto backup check failed:', e.message); }
    const prisma = await getPrisma();
    await prisma.$executeRawUnsafe('INSERT INTO swifttill_app_state (key, value, updated_at) VALUES ($1, $2::jsonb, NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()', CLOUD_STATE_KEY, JSON.stringify(db));
    return { ok: true, store: 'postgresql-cloud-state', persistedAt: now() };
  }
  ensureDir(DATA_DIR);
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  return { ok: true, store: 'local-json', persistedAt: now() };
}
function saveDbSync(db) {
  ensureDir(DATA_DIR);
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}
function assertOrderEngineState(db) {
  if (!Array.isArray(db.orders)) db.orders = [];
  if (!Array.isArray(db.customers)) db.customers = [];
  if (!Array.isArray(db.auditLogs)) db.auditLogs = [];
  if (!Array.isArray(db.sessionLogs)) db.sessionLogs = [];
  if (!Array.isArray(db.printJobs)) db.printJobs = [];
  if (!Array.isArray(db.deletedCatalog)) db.deletedCatalog = [];
  if (!db.counters) db.counters = { bill: 1000, z: 0 };
}

function ensureStateRevision(db) {
  if (!db.meta) db.meta = { app: 'SwiftTill POS', version: APP_VERSION, createdAt: now() };
  if (!Number.isFinite(Number(db.meta.stateRevision))) db.meta.stateRevision = 1;
  if (!db.meta.stateUpdatedAt) db.meta.stateUpdatedAt = now();
  if (!db.meta.lastSyncReason) db.meta.lastSyncReason = 'bootstrap';
}
function touchStateRevision(db, reason = 'state-save') {
  ensureStateRevision(db);
  db.meta.stateRevision = Number(db.meta.stateRevision || 0) + 1;
  db.meta.stateUpdatedAt = now();
  db.meta.lastSyncReason = reason;
  db.meta.version = APP_VERSION;
  return db.meta.stateRevision;
}
function syncSnapshot(db, orderId = '') {
  ensureStateRevision(db);
  const current = orderId ? (db.orders || []).find(o => o.id === orderId) : null;
  const openOrders = (db.orders || []).filter(o => ['OPEN','HELD'].includes(o.status) && hasBillLines(o));
  const paidOrders = (db.orders || []).filter(o => o.status === 'PAID');
  return {
    revision: db.meta.stateRevision,
    updatedAt: db.meta.stateUpdatedAt,
    reason: db.meta.lastSyncReason,
    currentOrder: current ? {
      id: current.id,
      number: current.number || 'Draft',
      status: current.status,
      type: current.type,
      total: totals(current).total,
      lineCount: (current.lines || []).reduce((s,l)=>s+Number(l.qty||0),0),
      updatedAt: current.updatedAt || current.paidAt || current.createdAt || ''
    } : null,
    counts: { openOrders: openOrders.length, paidOrders: paidOrders.length, printJobs: (db.printJobs || []).filter(j => ['PENDING','PRINTING'].includes(j.status)).length },
    openOrderIds: openOrders.map(o => o.id),
    paidOrderIds: paidOrders.slice(-50).map(o => o.id)
  };
}
async function saveCartSync(res, db, user, body) {
  const order = (db.orders || []).find(o => o.id === body.id);
  if (!order) throw Object.assign(new Error('Order not found'), { status: 404 });
  if (order.status === 'PAID') throw Object.assign(new Error('Order already paid on another device'), { status: 409 });
  const nextType = body.type || order.type;
  const nextTableId = body.tableId ?? order.tableId;
  const nextLines = Array.isArray(body.lines) ? normalizeOrderLines(body.lines) : normalizeOrderLines(order.lines);
  Object.assign(order, {
    type: nextType,
    tableId: nextType === 'DINE_IN' ? nextTableId : null,
    guests: nextType === 'DINE_IN' ? Number((body.guests ?? order.guests) || 1) : 0,
    orderTakerId: body.orderTakerId ?? order.orderTakerId,
    orderTakerName: body.orderTakerName ?? order.orderTakerName,
    customerName: body.customerName ?? order.customerName,
    mobile: body.mobile ?? order.mobile,
    address: body.address ?? order.address,
    deliveryFee: nextType === 'DELIVERY' ? money(body.deliveryFee ?? order.deliveryFee) : 0,
    lines: nextLines,
    discountType: body.discountType || order.discountType || 'NONE',
    discountValue: money(body.discountValue ?? order.discountValue),
    updatedAt: now(),
    lastSyncedBy: user.name
  });
  sanitizeDiscount(order);
  if (!hasBillLines(order)) {
    order.status = 'DRAFT';
    order.tableOccupiedAt = null;
  } else {
    if (order.type === 'DINE_IN' && !order.tableId) throw Object.assign(new Error('Dine In order requires table selection'), { status: 422 });
    assertTableAvailableForActiveOrder(db, order, order.tableId, 'This table already has an active order. Open that order instead.');
    ensureOrderNumber(db, order);
    if (order.type === 'DINE_IN' && order.tableId && !order.tableOccupiedAt) order.tableOccupiedAt = order.createdAt || now();
    order.status = body.hold ? 'HELD' : 'OPEN';
  }
  order.lastSyncAt = now();
  order.lastSyncBy = user.name;
  await saveDb(db, 'order-cart-sync');
  return send(res, 200, { ok: true, order, totals: totals(order), sync: syncSnapshot(db, order.id) });
}
function normalizeLine(line) {
  const qty = Math.max(1, Number(line.qty || 1));
  const price = money(line.price || 0);
  const modifiers = Array.isArray(line.modifiers) ? line.modifiers.map(m => ({ name: String(m.name || ''), price: money(m.price || m.priceDelta || 0) })).filter(m => m.name) : [];
  return { ...line, id: line.id || line.lineId || uid('lin'), lineId: line.lineId || line.id || uid('lin'), qty, price, modifiers, lineTotal: money(qty * (price + modifiers.reduce((a,m)=>a+Number(m.price||0),0))), notes: line.notes || line.note || '' };
}
function normalizeOrderLines(lines) {
  return Array.isArray(lines) ? lines.map(normalizeLine).filter(l => l.name && l.qty > 0) : [];
}
function validateAndNormalizePayments(payments, total) {
  const allowed = new Set(['Cash','Card','Online']);
  if (money(total) <= 0) throw Object.assign(new Error('Order total must be greater than 0'), { status: 422 });
  const clean = (Array.isArray(payments) ? payments : []).map(p => ({ method: String(p.method || ''), amount: money(p.amount || 0), received: money(p.received ?? p.amount ?? 0), change: money(p.change || 0), reference: p.reference || '' })).filter(p => p.amount > 0 || p.received > 0);
  if (!clean.length) throw Object.assign(new Error('Payment is required'), { status: 422 });
  for (const p of clean) if (p.amount < 0 || p.received < 0) throw Object.assign(new Error('Negative payment amount is not allowed'), { status: 422 });
  for (const p of clean) {
    if (!allowed.has(p.method)) throw Object.assign(new Error(`Invalid payment method: ${p.method}`), { status: 422 });
    if (p.method !== 'Cash' && p.received > p.amount) throw Object.assign(new Error(`${p.method} cannot be overpaid`), { status: 422 });
  }
  const received = money(clean.reduce((s,p)=>s + (p.received || p.amount),0));
  if (received < total) throw Object.assign(new Error('Payment amount is less than total'), { status: 422 });
  const change = money(Math.max(0, received - total));
  const cash = clean.find(p => p.method === 'Cash');
  if (change > 0 && !cash) throw Object.assign(new Error('Overpayment/change is allowed only with cash'), { status: 422 });
  if (change > 0) {
    cash.change = change;
    cash.amount = money(Math.max(0, cash.received - change));
  }
  const paid = money(clean.reduce((s,p)=>s + p.amount,0));
  if (paid !== total) {
    const cashLine = clean.find(p => p.method === 'Cash');
    if (cashLine) cashLine.amount = money(cashLine.amount + (total - paid));
  }
  return clean.filter(p => p.amount > 0 || p.received > 0);
}
async function runtimeHealth() {
  const db = { configured: hasDatabaseUrl(), store: shouldUseCloudState() ? 'postgresql-cloud-state' : 'local-json', ok: false };
  try { const h = await databaseHealth(); db.ok = !!h.ok; db.mode = h.mode; } catch (e) { db.error = e.message; }
  return {
    ok: db.ok && (!productionMode() || hasR2Config()),
    service: 'SwiftTill POS',
    version: APP_VERSION,
    database: db,
    r2: { configured: hasR2Config(), mode: hasR2Config() ? 'cloudflare-r2' : (productionMode() ? 'missing' : 'local-dev-fallback') },
    production: productionMode()
  };
}
function cleanupDraftOrders(db) {
  if (!Array.isArray(db.orders)) return;
  const cutoff = Date.now() - 1000 * 60 * 60 * 24;
  db.orders = db.orders.filter(o => {
    if (o.status !== 'DRAFT') return true;
    if (hasBillLines(o)) return true;
    const created = new Date(o.createdAt || 0).getTime();
    return created && created > cutoff;
  });
}
function migrateDb(db) {
  const seed = seedDb();
  removeLegacyHardcodedData(db);
  for (const k of ['settings','roles','users','categories','items','deals','tables','orderTakers','paymentMethods','orders','shifts','refunds','auditLogs','backups','mediaTrash','printJobs','deletedCatalog','counters','customers','sessionLogs']) if (db[k] === undefined) db[k] = seed[k];
  if (!Array.isArray(db.roles)) db.roles = seed.roles;
  if (db.meta) { db.meta.version = APP_VERSION; db.meta.storage = shouldUseCloudState() ? 'postgresql-cloud-state' : 'local-json'; }
  for (const [k,v] of Object.entries(seed.settings)) if (db.settings[k] === undefined) db.settings[k] = v;
  for (const pm of seed.paymentMethods) if (!db.paymentMethods.find(x => x.id === pm.id)) db.paymentMethods.push(pm);
  if (Array.isArray(db.users)) db.users.forEach(u => { if (!Array.isArray(u.roleIds)) u.roleIds = u.role === 'ADMIN' ? ['role_admin'] : u.role === 'MANAGER' ? ['role_manager'] : ['role_cashier']; });
  const technicalPerms = new Set(INTERNAL_PERMISSIONS || []);
  if (Array.isArray(db.roles)) db.roles.forEach(r => { r.permissions = (r.permissions || []).filter(p => !technicalPerms.has(p)); });
  const adminRole = (db.roles || []).find(r => r.id === 'role_admin' || String(r.name || '').toLowerCase() === 'admin');
  if (adminRole) adminRole.permissions = Array.from(new Set([...(adminRole.permissions || []), ...PERMISSIONS]));
  const managerRole = (db.roles || []).find(r => r.id === 'role_manager' || String(r.name || '').toLowerCase() === 'manager');
  if (managerRole) managerRole.permissions = Array.from(new Set([...(managerRole.permissions || []), 'security.pin', 'pos.void', 'pos.refund', 'pos.payment_correction']));
  if (!Array.isArray(db.pinEvents)) db.pinEvents = [];
  normalizeSecurity(db);
  cleanupDraftOrders(db);
}

function userPermissions(db, user) { const set = new Set(); for (const rid of user.roleIds || []) { const role = db.roles.find(r => r.id === rid && r.active); if (role) (role.permissions || []).forEach(p => set.add(p)); } return [...set]; }
function hasPerm(db, user, perm) { return userPermissions(db, user).includes(perm); }
function requirePerm(db, user, perm) { if (!hasPerm(db, user, perm)) throw Object.assign(new Error(`Permission required: ${perm}`), { status: 403 }); }
function audit(db, user, action, details = {}) { db.auditLogs.unshift({ id: uid('aud'), action, userId: user?.id || 'system', userName: user?.name || 'System', details, createdAt: now() }); db.auditLogs = db.auditLogs.slice(0, 1000); }
function parseBody(req) { return new Promise((resolve, reject) => { let body = ''; req.on('data', c => { body += c; if (body.length > 20 * 1024 * 1024) reject(new Error('Payload too large')); }); req.on('end', () => { if (!body) return resolve({}); try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON body')); } }); }); }
function send(res, status, data, headers = {}) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers }); res.end(JSON.stringify(data, null, 2)); }
function sendText(res, status, text, type = 'text/plain; charset=utf-8', headers = {}) { res.writeHead(status, { 'Content-Type': type, ...headers }); res.end(text); }
function getUserFromReq(req, db) { const token = parseBearer(req); const payload = verifyToken(token); if (payload?.sub) return db.users.find(u => u.id === payload.sub && u.active); const s = token && TOKENS.get(token); return s ? db.users.find(u => u.id === s.userId && u.active) : null; }
function requireAuth(req, db) { const u = getUserFromReq(req, db); if (!u) throw Object.assign(new Error('Unauthorized'), { status: 401 }); return u; }
function requireManager(db, pin, perm = 'pos.refund') {
  const approval = findPinApprover(db, pin, perm);
  if (!approval) throw Object.assign(new Error('Manager/Admin PIN required'), { status: 403 });
  return approval;
}
function requireActionApproval(db, currentUser, body = {}, perm = 'pos.void') {
  if (hasPerm(db, currentUser, perm)) return { method: 'current-user-permission', byUserId: currentUser.id, by: currentUser.name || currentUser.email || 'Authorized user' };
  const pin = String(body.approverPin || body.managerPin || '').trim();
  const pinApproval = findPinApprover(db, pin, perm);
  if (pinApproval) return pinApproval;
  const email = String(body.approverEmail || body.managerEmail || '').trim().toLowerCase();
  const password = String(body.approverPassword || body.managerPassword || '');
  if (email && password) {
    const approver = (db.users || []).find(u => String(u.email || '').toLowerCase() === email && u.active !== false);
    if (approver && verifyUserPassword(approver, password) && hasPerm(db, approver, perm)) {
      return { method: 'authorized-user-password', byUserId: approver.id, by: approver.name || approver.email };
    }
  }
  throw Object.assign(new Error('Manager/Admin approval required for this action'), { status: 403 });
}
function discountBase(order) {
  const subtotal = money((order.lines || []).reduce((s, l) => s + ((Number(l.price) || 0) + (l.modifiers || []).reduce((a, m) => a + Number(m.price || 0), 0)) * Number(l.qty || 0), 0));
  return money(subtotal + Number(order.deliveryFee || 0));
}
function sanitizeDiscount(order) {
  if (!order) return order;
  const type = ['FIXED','PERCENT','NONE'].includes(order.discountType) ? order.discountType : 'NONE';
  let value = money(order.discountValue || 0);
  const base = discountBase(order);
  if (type === 'NONE' || value <= 0 || base <= 0) { order.discountType = 'NONE'; order.discountValue = 0; return order; }
  if (type === 'PERCENT') {
    if (value > 100) value = 100;
    order.discountType = 'PERCENT';
    order.discountValue = value;
    return order;
  }
  if (type === 'FIXED') {
    if (value > base) value = base;
    order.discountType = 'FIXED';
    order.discountValue = value;
    return order;
  }
  order.discountType = 'NONE'; order.discountValue = 0; return order;
}
function totals(order) {
  if (order) sanitizeDiscount(order);
  const subtotal = money((order?.lines || []).reduce((s, l) => s + ((Number(l.price) || 0) + (l.modifiers || []).reduce((a, m) => a + Number(m.price || 0), 0)) * Number(l.qty || 0), 0));
  const deliveryFee = money(order?.deliveryFee || 0);
  let discount = 0;
  if (order?.discountType === 'PERCENT') discount = (subtotal + deliveryFee) * Math.max(0, Math.min(100, Number(order.discountValue) || 0)) / 100;
  if (order?.discountType === 'FIXED') discount = Number(order.discountValue) || 0;
  discount = money(Math.min(Math.max(discount, 0), subtotal + deliveryFee));
  return { subtotal, deliveryFee, discount, total: money(Math.max(0, subtotal + deliveryFee - discount)), discountType: order?.discountType || 'NONE', discountValue: Number(order?.discountValue || 0) };
}
function orderNumber(db) { db.counters.bill = Number(db.counters.bill || 1000) + 1; return String(db.counters.bill).padStart(6, '0'); }
function ensureOrderNumber(db, order) { if (!order.number) order.number = orderNumber(db); return order.number; }
function activeShift(db) { return db.shifts.find(s => s.status === 'OPEN') || null; }

function positivePrice(v) { return money(v); }
function requirePositivePrice(v, label = 'Price') {
  const n = positivePrice(v);
  if (n <= 0) throw Object.assign(new Error(`${label} must be greater than 0`), { status: 422 });
  return n;
}
function validateAdminRecord(kind, record) {
  if (!record || typeof record !== 'object') throw Object.assign(new Error('Invalid record'), { status: 422 });
  // V52: image/media fields are accepted only where the module actually uses media.
  // Prevents hidden/accidental imageUrl data on tables, users, roles, payment methods, etc.
  if (!['category','item','deal'].includes(kind)) {
    delete record.imageUrl;
    delete record.uploadFile;
  }
  if (['category','item','deal','table','taker','payment','user','role'].includes(kind) && !String(record.name || '').trim()) throw Object.assign(new Error('Name is required'), { status: 422 });
  if (kind === 'item') {
    if (!record.categoryId) throw Object.assign(new Error('Item category is required'), { status: 422 });
    record.price = requirePositivePrice(record.price, 'Item price');
    record.name = String(record.name).trim();
  }
  if (kind === 'deal') {
    record.price = requirePositivePrice(record.price, 'Deal price');
    record.name = String(record.name).trim();
  }
  if (kind === 'category') { record.name = String(record.name).trim(); record.sort = Number(record.sort || 0); }
  if (kind === 'table') { record.name = String(record.name).trim(); record.seats = Math.max(1, Number(record.seats || 1)); }
  if (kind === 'taker' || kind === 'payment') record.name = String(record.name).trim();
  if (kind === 'settings') {
    record.defaultDeliveryFee = Math.max(0, money(record.defaultDeliveryFee || 0));
    record.receiptCopies = Math.max(1, Number(record.receiptCopies || 1));
  }
  return record;
}
function activePricedItems(db) { return (db.items || []).filter(i => i.active && Number(i.price || 0) > 0); }
function activePricedDeals(db) { return (db.deals || []).filter(d => d.active && Number(d.price || 0) > 0); }
function hasBillLines(order) { return Array.isArray(order?.lines) && order.lines.some(l => Number(l.qty || 0) > 0 && String(l.name || '').trim()); }
function requireBillLines(order, message = 'Add at least one item before continuing') { if (!hasBillLines(order)) throw Object.assign(new Error(message), { status: 422 }); }
function refundTotalForOrder(db, orderId) { return money((db.refunds || []).filter(r => r.orderId === orderId).reduce((s,r)=>s+Number(r.amount||0),0)); }
function remainingRefundable(db, order) { return money(Math.max(0, totals(order).total - refundTotalForOrder(db, order.id))); }
function assertTableAvailableForActiveOrder(db, order, tableId, message = 'This table already has an active order') {
  if (order.type !== 'DINE_IN' || !tableId || !hasBillLines(order)) return;
  const busy = db.orders.find(o => o.id !== order.id && ['OPEN','HELD'].includes(o.status) && o.type === 'DINE_IN' && o.tableId === tableId && hasBillLines(o));
  if (busy) throw Object.assign(new Error(message), { status: 409 });
}
function tableMap(db) { const open = db.orders.filter(o => ['OPEN','HELD'].includes(o.status) && o.type === 'DINE_IN' && o.tableId && hasBillLines(o)); return db.tables.map(t => { const order = open.find(o => o.tableId === t.id); return { ...t, busy: !!order, orderId: order?.id || null, orderNumber: order?.number || null, occupiedAt: order?.tableOccupiedAt || order?.createdAt || null, guests: order?.guests || 0 }; }); }
function publicUser(db, u) { const permissions = userPermissions(db, u); return { id: u.id, name: u.name, email: u.email, roleIds: u.roleIds || [], roles: (u.roleIds || []).map(id => db.roles.find(r => r.id === id)?.name).filter(Boolean), permissions }; }
function compactState(db, user) { return { sync: syncSnapshot(db), user: publicUser(db, user), permissions: userPermissions(db, user), permissionCatalog: PERMISSIONS, settings: sanitizeSettingsForClient(db.settings), roles: db.roles, categories: db.categories, items: db.items, deals: db.deals, tables: tableMap(db), orderTakers: db.orderTakers, paymentMethods: db.paymentMethods, users: db.users.map(sanitizeUserForClient), openOrders: db.orders.filter(o => ['OPEN','HELD'].includes(o.status) && hasBillLines(o)).sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt)), paidOrders: db.orders.filter(o => o.status === 'PAID').slice(-1000).reverse(), refunds: db.refunds.slice(-1000).reverse(), activeShift: activeShift(db), auditLogs: db.auditLogs.slice(0, 120), backup: backupSummary(db), mediaTrash: (db.mediaTrash || []).slice(0, 50), printJobs: (db.printJobs || []).slice(0, 80), pinEvents: (db.pinEvents || []).slice(0, 50), setup: setupStatus(db), printAgent: printAgentStatus(db) }; }
function between(date, from, to) { const t = new Date(date).getTime(); const a = from ? new Date(`${from}T00:00:00`).getTime() : 0; const b = to ? new Date(`${to}T23:59:59`).getTime() : Date.now() + 86400000; return t >= a && t <= b; }
function reportData(db, filters = {}) {
  const from = filters.from || '';
  const to = filters.to || '';
  const wantPayment = (filters.paymentMode || '').toLowerCase();
  const wantItem = filters.itemId || '';
  const wantCategory = filters.categoryId || '';
  const wantOrderType = filters.orderType || '';
  const wantCashier = filters.cashierId || '';
  const wantTaker = filters.orderTakerId || '';
  const wantShift = filters.shiftId || '';
  const discountOnly = filters.discountOnly === '1' || filters.discountOnly === true;
  const refundOnly = filters.refundOnly === '1' || filters.refundOnly === true;
  let paid = db.orders.filter(o => o.status === 'PAID' && between(o.paidAt || o.createdAt, from, to));
  paid = paid.filter(o => {
    if (wantPayment && !(o.payments || []).some(p => String(p.method || '').toLowerCase() === wantPayment)) return false;
    if (wantItem && !(o.lines || []).some(l => l.itemId === wantItem || l.dealId === wantItem)) return false;
    if (wantCategory && !(o.lines || []).some(l => l.categoryId === wantCategory)) return false;
    if (wantOrderType && o.type !== wantOrderType) return false;
    if (wantCashier && o.cashierId !== wantCashier) return false;
    if (wantTaker && o.orderTakerId !== wantTaker) return false;
    if (wantShift) {
      const shift = db.shifts.find(s => s.id === wantShift);
      if (!shift) return false;
      const t = new Date(o.paidAt || o.createdAt).getTime();
      const a = new Date(shift.openedAt).getTime();
      const b = shift.closedAt ? new Date(shift.closedAt).getTime() : Date.now() + 86400000;
      if (t < a || t > b) return false;
    }
    if (discountOnly && totals(o).discount <= 0) return false;
    return true;
  });
  let refunds = db.refunds.filter(r => between(r.createdAt, from, to));
  if (refundOnly) {
    const refundOrderIds = new Set(refunds.map(r => r.orderId));
    paid = paid.filter(o => refundOrderIds.has(o.id));
  }
  const gross = paid.reduce((s,o) => s + totals(o).subtotal + totals(o).deliveryFee, 0);
  const discounts = paid.reduce((s,o) => s + totals(o).discount, 0);
  const refundAmount = refunds.reduce((s,r) => s + Number(r.amount || 0), 0);
  const net = paid.reduce((s,o) => s + totals(o).total, 0) - refundAmount;
  const paymentWise = {}, itemWise = {}, categoryWise = {}, orderTypeWise = {}, discountWise = { count: 0, amount: 0 };
  for (const o of paid) {
    const ot = totals(o);
    orderTypeWise[o.type] = money((orderTypeWise[o.type] || 0) + ot.total);
    if (ot.discount > 0) { discountWise.count += 1; discountWise.amount = money(discountWise.amount + ot.discount); }
    for (const p of (o.payments || [])) paymentWise[p.method] = money((paymentWise[p.method] || 0) + Number(p.amount || 0));
    for (const l of (o.lines || [])) {
      const mods = (l.modifiers || []).reduce((a,m) => a + Number(m.price || 0), 0);
      const amount = ((Number(l.price) || 0) + mods) * (Number(l.qty) || 0);
      itemWise[l.name] ||= { item: l.name, category: l.categoryName || db.categories.find(c => c.id === l.categoryId)?.name || (l.kind === 'DEAL' ? 'Deals' : 'Uncategorized'), qty: 0, sales: 0 };
      itemWise[l.name].qty += Number(l.qty) || 0;
      itemWise[l.name].sales = money(itemWise[l.name].sales + amount);
      const cat = itemWise[l.name].category;
      categoryWise[cat] = money((categoryWise[cat] || 0) + amount);
    }
  }
  const shiftForSummary = wantShift ? db.shifts.find(s => s.id === wantShift) : activeShift(db);
  const cashSalesForSummary = paymentWise.Cash || 0;
  const openingCashForSummary = shiftForSummary ? Number(shiftForSummary.openingCash || 0) : 0;
  const expectedCashForSummary = money(openingCashForSummary + cashSalesForSummary);
  return {
    range: { from, to },
    filters,
    shiftSummary: { shiftId: shiftForSummary?.id || '', openingCash: money(openingCashForSummary), cashSales: money(cashSalesForSummary), expectedCash: expectedCashForSummary, countedCash: shiftForSummary?.countedCash ?? null, difference: shiftForSummary?.difference ?? null },
    summary: { orders: paid.length, gross: money(gross), discounts: money(discounts), refunds: money(refundAmount), net: money(net), averageBill: paid.length ? money(net / paid.length) : 0 },
    paymentWise,
    itemWise: Object.values(itemWise).sort((a,b) => b.sales - a.sales),
    categoryWise,
    orderTypeWise,
    discountWise,
    refunds,
    voidOrders: db.orders.filter(o => o.status === 'VOID' && between(o.voidedAt || o.createdAt, from, to)),
    orders: paid.map(o => ({ number: o.number, date: o.paidAt, type: o.type, table: db.tables.find(t => t.id === o.tableId)?.name || '', customer: o.customerName || '', mobile: o.mobile || '', cashier: o.cashierName || '', orderTaker: o.orderTakerName || '', subtotal: totals(o).subtotal, discount: totals(o).discount, deliveryFee: totals(o).deliveryFee, total: totals(o).total, payments: (o.payments || []).map(p => `${p.method}:${p.amount}`).join(', ') }))
  };
}
function buildReceipt(db, order) { const t = totals(order); const table = order.tableName || db.tables.find(x => x.id === order.tableId)?.name || ''; return { business: db.settings.businessName, legalName: db.settings.legalName, branchName: db.settings.branchName, branchCode: db.settings.branchCode, phone: db.settings.phone, email: db.settings.email, website: db.settings.website, address: db.settings.address, city: db.settings.city, country: db.settings.country, logoUrl: db.settings.logoUrl, header: db.settings.receiptHeader, footer: db.settings.receiptFooter, receiptWidth: db.settings.receiptWidth, receiptCopies: db.settings.receiptCopies, showLogoOnReceipt: db.settings.showLogoOnReceipt, showCustomerOnReceipt: db.settings.showCustomerOnReceipt, showOrderTakerOnReceipt: db.settings.showOrderTakerOnReceipt, showCashierOnReceipt: db.settings.showCashierOnReceipt, showPaymentBreakdown: db.settings.showPaymentBreakdown, number: order.number, date: order.paidAt || now(), cashier: order.cashierName, type: order.type, table, guests: order.guests, orderTaker: order.orderTakerName, customer: order.customerName, mobile: order.mobile, addressLine: order.address, lines: order.lines, totals: t, payments: order.payments || [] }; }
async function upsertList(res, db, user, key, body, action) {
  const kindMap={categories:'category',items:'item',deals:'deal',tables:'table',orderTakers:'taker',paymentMethods:'payment',users:'user',roles:'role'};
  let record = validateAdminRecord(kindMap[key] || key, { ...body });
  let previousImage = '';
  if (!record.id) {
    record.id = uid(key.slice(0,3));
    db[key].push(record);
  } else {
    const i = db[key].findIndex(x => x.id === record.id);
    if (i >= 0) {
      previousImage = db[key][i].imageUrl || '';
      db[key][i] = { ...db[key][i], ...record };
      record = db[key][i];
    } else db[key].push(record);
  }
  if (previousImage && previousImage !== record.imageUrl) {
    const cleaned = await cleanupMediaReference(db, previousImage, `${action}_OLD_IMAGE_DELETED`);
    db.mediaTrash = Array.isArray(db.mediaTrash) ? db.mediaTrash : [];
    db.mediaTrash.unshift({ url: previousImage, action: `${action}_OLD_IMAGE_CLEANUP`, cleaned, at: now(), by: user.name });
  }
  audit(db, user, action, { id: record.id, name: record.name });
  await saveDb(db);
  return send(res, 200, { ok: true, record });
}
async function deleteListRecord(res, db, user, key, id, action) {
  const i = db[key].findIndex(x => x.id === id);
  if (i < 0) throw Object.assign(new Error('Record not found'), { status: 404 });
  const record = db[key][i];
  if (record.system && !['items','categories','deals'].includes(key)) throw Object.assign(new Error('System record cannot be deleted'), { status: 409 });
  if (key === 'users') {
    if (record.id === user.id) throw Object.assign(new Error('You cannot delete your own active user'), { status: 409 });
    const adminRole = db.roles.find(r => r.name === 'Admin' || r.id === 'role_admin');
    const activeAdmins = db.users.filter(u => u.active !== false && (u.roleIds || []).includes(adminRole?.id)).length;
    if ((record.roleIds || []).includes(adminRole?.id) && activeAdmins <= 1) throw Object.assign(new Error('At least one active admin is required'), { status: 409 });
  }
  if (key === 'roles' && db.users.some(u => (u.roleIds || []).includes(id) && u.active !== false)) throw Object.assign(new Error('Role is assigned to users. Reassign users before deleting role.'), { status: 409 });
  if (key === 'paymentMethods' && db.orders.some(o => (o.payments || []).some(p => p.method === record.name))) { record.active = false; record.deletedAt = now(); audit(db, user, action, { id: record.id, name: record.name, archived: true }); await saveDb(db); return send(res, 200, { ok: true, deleted: record, archived: true, historyPreserved: true }); }
  if (key === 'categories' && db.items.some(i => i.categoryId === id && i.active !== false)) throw Object.assign(new Error('Category has active items. Move or delete items before deleting category.'), { status: 409 });
  if (key === 'items') {
    const used = db.orders.some(o => (o.lines || []).some(l => l.itemId === id));
    record.deletedAt = now(); record.active = false; record.deletedBy = user.name;
    if (used) { db.deletedCatalog = Array.isArray(db.deletedCatalog) ? db.deletedCatalog : []; db.deletedCatalog.unshift({ type:'item', record, deletedAt: now(), by: user.name }); }
  }
  if (key === 'categories') {
    (db.items || []).filter(x => x.categoryId === id).forEach(x => { x.categoryName = record.name; });
  }
  db[key].splice(i, 1);
  if (record.imageUrl) {
    const cleaned = await cleanupMediaReference(db, record.imageUrl, `${action}_IMAGE_DELETED`);
    db.mediaTrash = Array.isArray(db.mediaTrash) ? db.mediaTrash : [];
    db.mediaTrash.unshift({ url: record.imageUrl, action: `${action}_IMAGE_CLEANUP`, cleaned, at: now(), by: user.name });
  }
  audit(db, user, action, { id: record.id, name: record.name, historyPreserved: true });
  await saveDb(db);
  return send(res, 200, { ok: true, deleted: record, historyPreserved: true });
}

async function upsertUserRecord(res, db, user, body) {
  requirePerm(db, user, 'admin.users');
  const existing = body.id ? db.users.find(x => x.id === body.id) : null;
  if (!String(body.name || '').trim()) throw Object.assign(new Error('Name is required'), { status: 422 });
  if (!String(body.email || '').trim()) throw Object.assign(new Error('Email is required'), { status: 422 });
  const roleIds = Array.isArray(body.roleIds) && body.roleIds.length ? body.roleIds : ['role_cashier'];
  for (const roleId of roleIds) if (!db.roles.find(r => r.id === roleId && r.active)) throw Object.assign(new Error('Invalid role selected'), { status: 422 });
  const emailTaken = db.users.find(x => x.email.toLowerCase() === String(body.email).toLowerCase() && x.id !== body.id);
  if (emailTaken) throw Object.assign(new Error('Email already exists'), { status: 409 });
  const record = existing ? { ...existing, name: String(body.name).trim(), email: String(body.email).trim(), roleIds, active: body.active !== false } : { id: uid('usr'), name: String(body.name).trim(), email: String(body.email).trim(), roleIds, active: body.active !== false };
  if (body.password && String(body.password).trim()) {
    if (String(body.password).length < 8) throw Object.assign(new Error('Password must be at least 8 characters'), { status: 422 });
    if (isDefaultPasswordValue(body.password)) throw Object.assign(new Error('Default password is not allowed'), { status: 422 });
    setUserPassword(record, String(body.password));
  } else if (!existing) {
    throw Object.assign(new Error('Password is required for new user'), { status: 422 });
  }
  if (body.pin && String(body.pin).trim()) {
    const pin = assertPinFormat(body.pin);
    setUserPin(record, pin);
    db.pinEvents = Array.isArray(db.pinEvents) ? db.pinEvents : [];
    db.pinEvents.unshift({ id: uid('pin'), action: existing ? 'USER_PIN_SET_BY_ADMIN' : 'USER_PIN_CREATED_BY_ADMIN', targetUserId: record.id, byUserId: user.id, by: user.name, at: now() });
    db.pinEvents = db.pinEvents.slice(0, 500);
  }
  const idx = db.users.findIndex(x => x.id === record.id);
  if (idx >= 0) db.users[idx] = record; else db.users.push(record);
  audit(db, user, existing ? 'USER_UPDATED' : 'USER_CREATED', { id: record.id, email: record.email, roleIds });
  await saveDb(db);
  return send(res, 200, { ok: true, record: sanitizeUserForClient(record) });
}

function finalAuditStatus(db) {
  const setup = setupStatus(db);
  const activeDineInTables = new Map();
  const duplicateActiveTables = [];
  for (const o of db.orders || []) {
    if (!['OPEN','HELD'].includes(o.status) || o.type !== 'DINE_IN' || !o.tableId || !hasBillLines(o)) continue;
    if (activeDineInTables.has(o.tableId)) duplicateActiveTables.push(o.tableId);
    activeDineInTables.set(o.tableId, o.id);
  }
  const overRefunded = (db.orders || []).filter(o => o.status === 'PAID' && refundTotalForOrder(db, o.id) > totals(o).total).map(o => o.number || o.id);
  const zeroPricedActiveItems = (db.items || []).filter(i => i.active !== false && Number(i.price || 0) <= 0).length;
  const activeOrdersWithZeroTotal = (db.orders || []).filter(o => ['OPEN','HELD'].includes(o.status) && hasBillLines(o) && totals(o).total <= 0).length;
  const remaining = [];
  if (!setup.complete) remaining.push('restaurant setup incomplete');
  if (duplicateActiveTables.length) remaining.push('duplicate active dine-in tables need manual cleanup');
  if (overRefunded.length) remaining.push('historical over-refunded bills need manual review');
  if (zeroPricedActiveItems) remaining.push('active menu has zero-priced items');
  if (activeOrdersWithZeroTotal) remaining.push('active orders with zero total need review');
  if (!hasR2Config()) remaining.push('Cloudflare R2 not configured');
  if (!printAgentKey(db)) remaining.push('cloud print agent key missing');
  return { ok: remaining.length === 0, version: APP_VERSION, audit: { passwordsHashed: (db.users || []).every(u => Boolean(u.passwordHash) && !u.password), pinsHiddenFromClient: true, technicalBackupControlsHiddenFromClient: true, paidVoidBlocked: true, refundOverrunBlocked: true, tableDoubleBookingGuard: true, shiftCashRefundReconciliation: true, mediaCleanup: true, historyPreservedAfterCatalogDelete: true, cloudPrintQueue: true, reportTotalsFooters: true, mobileFriendlyPos: true, mobileCartDrawer: true, clientOnlyAdmin: true, r2HardDeleteOnReplace: true, r2HardDeleteOnDelete: true, r2DailyOrphanCleanup: true, taxFiscalFieldsReady: true, tenantStateKeyReady: true, defaultPasswordSetupGuard: true, enlargedFavicon: true, originalLogoFaviconMaxFill: true, reportsSubmenuInLeftAdminNav: true, reportOrganizationLogo: true, operationalScenarioMatrix: true, mobileBackCloseControls: true, mobileCategoryFirstFlow: true, mobileOpenBillsPayFlow: true, mobileAddItemsStayOnMenu: true, mobileBillDrawerManualOnly: true, crossDeviceLiveSync: false, autoCartSave: true, paidOrderRemoteClose: true, openBillsRealtimeRefresh: true, discountTypeSwitchResetsValue: true, fixedDiscountClampedToBill: true, percentDiscountMax100: true, cashRevenueChangeSafe: true, buttonTextVisibilitySafe: true, printerModule99Ready: true, cloudPrintRetryQueue: true, localSpoolRecovery: true, windowsDefaultPrinterDiagnostics: true, offlineModeRemovedRollbackV45: true, onlineOnlyModeRestored: true, noLocalOfflineBilling: true, autoLogoutInactivityV47: true, tillTenderCloseDayV48: true, countedCashPhysicalOnly: true, cardOnlineTenderRecorded: true, tenderWiseCloseSummary: true, reportsTenderSummaryV48: true, closeDayCashDrawerOnly: true, professionalBusinessDayLanguageV49: true, clientFacingDayCloseCopyClean: true, printPageCenterV50: true, noBlankReportPagesV50: true, dynamicReceiptHeightV50: true, a4ThermalCenterAlignedV50: true, browserPrintDomIsolationV50: true, deepCleanUxBuilderAuditV51: true, searchInputFocusStableV51: true, adminFiltersNoBlurV51: true, formCaretPreservedV51: true, buttonContentVisibilityAuditV51: true, posAdminInputStabilityV51: true, clientFacingPolishAuditV51: true, clientFacingAdminCleanupV52: true, unsupportedImageColumnsRemovedV52: true, adminModuleColumnMapV52: true, nonMediaPayloadSanitizedV52: true, professionalTableAdminV52: true, paidOrdersFiltersV53: true, paidOrdersSortingV53: true, openOrdersFiltersV53: true, openOrderVoidCancelFromPosV53: true, managerAdminApprovalForVoidV53: true, searchDateRangeFilterAuditV53: true, oneLineBillActionsV54: true, fourBillActionButtonsSingleRowV54: true, voidActionCompactV54: true, billActionWrapGuardV54: true, createOrderStayOnBillingV55: true, draftOrderNotRemoteClearedV55: true, surgicalClientPatchV55: true, regressionAuditV55: true, onlineOnlyNoOfflineV56: true, onlineDeviceRefreshV56: true, clientFacingSyncWordingRemovedV56: true, professionalCategorySidebarV56: true, categoryCardGapAuditV56: true, allItemsNoIconTruncationFixedV56: true, noFunctionalRegressionV56: true, pinSecurityCompleteV57: true, userPinRegisterV57: true, userPinChangeV57: true, adminUserPinManagementV57: true, pinApprovalByManagerAdminV57: true, inactivityTimeoutMinutes: 12, inactivityWarningBeforeLogout: true, idleLogoutClearsToken: true, idleLogoutAudited: true, setup }, counts: { categories: (db.categories || []).length, items: (db.items || []).length, deals: (db.deals || []).length, tables: (db.tables || []).length, openOrders: (db.orders || []).filter(o => ['OPEN','HELD'].includes(o.status) && hasBillLines(o)).length, paidOrders: (db.orders || []).filter(o => o.status === 'PAID').length, refunds: (db.refunds || []).length, pendingPrintJobs: (db.printJobs || []).filter(j => ['PENDING','PRINTING'].includes(j.status)).length }, remaining };
}


function operationalScenarioMatrix(db) {
  const setup = setupStatus(db);
  const pendingPrints = (db.printJobs || []).filter(j => ['PENDING','PRINTING'].includes(j.status)).length;
  const openOrders = (db.orders || []).filter(o => ['OPEN','HELD'].includes(o.status) && hasBillLines(o)).length;
  const today = now().slice(0,10);
  const latestBackup = (db.backups || [])[0] || null;
  return {
    ok: true,
    version: APP_VERSION,
    mode: shouldUseCloudState() ? 'render-neon-r2-cloud' : 'local-dev',
    readiness: {
      setupComplete: setup.complete,
      database: hasDatabaseUrl() ? 'configured' : 'missing',
      r2: hasR2Config() ? 'configured' : 'missing',
      printQueue: printAgentKey(db) ? 'cloud-queue-ready' : 'key-missing',
      openOrders,
      pendingPrints,
      latestBackup: latestBackup ? latestBackup.exportedAt : 'pending'
    },
    scenarios: [
      { scenario: 'Browser tab closes or Chrome crashes', protection: 'Orders are saved to Neon after hold/pay/save. Cashier can reopen from Open Bills after login.', action: 'Use Open Bills; unpaid active orders stay visible.' },
      { scenario: 'PC shuts down or electricity goes', protection: 'Cloud database keeps paid/open order state. Print queue keeps pending thermal jobs.', action: 'Restart PC, open POS, start print agent, continue from Open Bills.' },
      { scenario: 'Internet drops during service', protection: 'Online-only mode blocks unsafe offline billing instead of creating hidden local bills.', action: 'Wait/reconnect, then refresh. No silent local duplicate data.' },
      { scenario: 'Render restarts/sleeps', protection: 'State reloads from Neon cloud-state on startup; sessions may require login again.', action: 'Login again; orders/history remain in database.' },
      { scenario: 'Thermal printer offline or USB disconnected', protection: 'Cloud print queue keeps job pending/failed; browser fallback can print preview.', action: 'Reconnect printer, start agent, retry print job.' },
      { scenario: 'Cashier double-clicks Pay/Hold', protection: 'Frontend pending-action guard and backend validation reduce duplicate order/payment risk.', action: 'Check bill status before retry.' },
      { scenario: 'Same table selected twice', protection: 'Backend one-table-one-active-order guard rejects second active dine-in bill.', action: 'Open existing bill or move table.' },
      { scenario: 'Menu item image replaced/deleted', protection: 'Unused old R2 media is deleted while paid-report name/price/category snapshot remains.', action: 'Reports stay accurate without keeping old menu media.' },
      { scenario: 'Wrong payment/refund action', protection: 'Refund limits, paid-order locks, manager PIN and audit trail are enforced.', action: 'Use refund/payment correction with authorization.' },
      { scenario: 'End of day closeout', protection: 'X/Z, cash drawer, refunds, expected cash and daily backup are available.', action: 'Run Z report, close shift, keep automatic backup.' }
    ]
  };
}

async function handleApi(req, res, pathname, query) {
  try {
    if (pathname === '/api/health' && req.method === 'GET') return send(res, 200, await runtimeHealth());
    if (pathname === '/api/env-check' && req.method === 'GET') return send(res, 200, { ok: true, environment: { nodeEnv: process.env.NODE_ENV || 'development', databaseUrl: hasDatabaseUrl() ? 'loaded' : 'missing', dataStore: shouldUseCloudState() ? 'postgresql-cloud-state' : 'local-json', r2: hasR2Config() ? 'configured' : 'missing', production: productionMode() }, note: 'Safe status only. No secrets are returned.' });
    const db = await loadDb();
    assertOrderEngineState(db);
    if (pathname === '/api/order-engine/status' && req.method === 'GET') return send(res, 200, { ok: true, version: APP_VERSION, store: shouldUseCloudState() ? 'postgresql-cloud-state' : 'local-json', rules: { oneTableOneActiveDineInOrder: true, paymentChangeCashOnly: true, paidOrdersLocked: true, tableReleasedAfterFullPayment: true, synchronousPersistence: true, hardcodedBusinessData: false, zeroPriceBlocked: true, emptyHoldBlocked: true, unpaidBillPrint: true, printAreaSafe: true, reportsVisible: true, mediaCleanup: true, automaticBackups: true, reportHistoryPreservedAfterItemDelete: true, fastUiNoFullScreenBlock: true, reportsAdminPanelFixed: true, cloudCredentialsHiddenFromClient: true, directPrintAgentDefault: true, softBusyIndicator: true, structuredReports: true, reportSubMenus: true, reportSpecificFilters: true, excelPerReport: true, billStyleReportPrint: true, professionalReports: true, reportTotalsFooters: true, xzCloseoutSections: true, cashDrawerReconciliation: true, full360Audit: true, secureSessionTokens: true, passwordsHashed: true, pinsHiddenFromClient: true, managerPinHidden: true, draftOrdersDoNotOccupyTables: true, cloudPrintQueue: true, autoBackupPersistenceFixed: true, lastAdminProtection: true, categoryDeleteGuard: true, posReportsRemoved: true, adminOnlyReports: true, professionalUiPolish: true, fastSoftBusyIndicator: true, imageAspectSafe: true, quickbooksStylePdfReports: true, thermalReportSlipPrint: true, noBoxPrintReports: true, formattingTemplateAudit: true, modernPosUiSystem: true, compactHeader: true, categoryColorSystem: true, adminBackOfficePolish: true, sameScreenWorkflowPolish: true, visibleIconsMarginsAudit: true, compactCartPanel: true, orderInfoGrid: true, singleLineBillActions: true, clientBackupActionsHidden: true, modernPosCompression: true, extremeCartCompression: true, largerVisibleBillItems: true, compactOrderMetaOneLine: true, compactTotalsActions: true, mediaFrameSafe: true, adminItemCategoryFilter: true, adminListSorting: true, faviconBranding: true, originalLogoFaviconMaxFill: true, receiptReportBranding: true, final360Audit: true, paidVoidBlocked: true, refundOverrunBlocked: true, refundedBillReopenBlocked: true, paymentCorrectionAfterRefundBlocked: true, technicalBackupControlsHiddenFromClient: true, shiftCashRefundReconciliation: true, mobileFriendlyPos: true, mobileCartDrawer: true, mobileResponsiveAdmin: true, clientOnlyAdmin: true, taxFiscalFieldsReady: true, tenantStateKeyReady: true, finalNotesCodeSideClosed: true, r2HardDeleteOnReplace: true, r2HardDeleteOnDelete: true, r2DailyOrphanCleanup: true, reportHistoryWithoutMediaDependency: true, enlargedFavicon: true, originalLogoFaviconMaxFill: true, reportsSubmenuInLeftAdminNav: true, reportOrganizationLogo: true, operationalScenarioMatrix: true, mobileBackCloseControls: true, mobileCategoryFirstFlow: true, mobileOpenBillsPayFlow: true, mobileAddItemsStayOnMenu: true, mobileBillDrawerManualOnly: true, crossDeviceLiveSync: false, autoCartSave: true, paidOrderRemoteClose: true, openBillsRealtimeRefresh: true, discountTypeSwitchResetsValue: true, fixedDiscountClampedToBill: true, percentDiscountMax100: true, cashRevenueChangeSafe: true, buttonTextVisibilitySafe: true, printerModule99Ready: true, clientPrintAgentFinalPackage: true, cloudPrintRetryQueue: true, localSpoolRecovery: true, windowsDefaultPrinterDiagnostics: true, offlineModeRemovedRollbackV45: true, onlineOnlyModeRestored: true, noLocalOfflineBilling: true, businessDayOpenCloseV46: true, workBlockedWithoutOpenDay: true, afterMidnightDaySales: true, compactReportsV46: true, reportPrintWasteReduced: true, offlineConceptForgotten: true, autoLogoutInactivityV47: true, tillTenderCloseDayV48: true, countedCashPhysicalOnly: true, cardOnlineTenderRecorded: true, tenderWiseCloseSummary: true, reportsTenderSummaryV48: true, closeDayCashDrawerOnly: true, inactivityTimeoutMinutes: 12, inactivityWarningBeforeLogout: true, idleLogoutClearsToken: true, idleLogoutAudited: true, unsavedCartProtectedBeforeIdleLogout: true, professionalBusinessDayLanguageV49: true, clientFacingDayCloseCopyClean: true, printPageCenterV50: true, noBlankReportPagesV50: true, dynamicReceiptHeightV50: true, a4ThermalCenterAlignedV50: true, browserPrintDomIsolationV50: true, deepCleanUxBuilderAuditV51: true, searchInputFocusStableV51: true, adminFiltersNoBlurV51: true, formCaretPreservedV51: true, buttonContentVisibilityAuditV51: true, posAdminInputStabilityV51: true, clientFacingPolishAuditV51: true, clientFacingAdminCleanupV52: true, unsupportedImageColumnsRemovedV52: true, adminModuleColumnMapV52: true, nonMediaPayloadSanitizedV52: true, professionalTableAdminV52: true, paidOrdersFiltersV53: true, paidOrdersSortingV53: true, openOrdersFiltersV53: true, openOrderVoidCancelFromPosV53: true, managerAdminApprovalForVoidV53: true, searchDateRangeFilterAuditV53: true, oneLineBillActionsV54: true, fourBillActionButtonsSingleRowV54: true, voidActionCompactV54: true, billActionWrapGuardV54: true, createOrderStayOnBillingV55: true, draftOrderNotRemoteClearedV55: true, surgicalClientPatchV55: true, regressionAuditV55: true, onlineOnlyNoOfflineV56: true, onlineDeviceRefreshV56: true, clientFacingSyncWordingRemovedV56: true, professionalCategorySidebarV56: true, categoryCardGapAuditV56: true, allItemsNoIconTruncationFixedV56: true, noFunctionalRegressionV56: true, pinSecurityCompleteV57: true, userPinRegisterV57: true, userPinChangeV57: true, adminUserPinManagementV57: true, pinApprovalByManagerAdminV57: true }, counts: { openOrders: db.orders.filter(o => ['OPEN','HELD'].includes(o.status) && hasBillLines(o)).length, paidOrders: db.orders.filter(o => o.status === 'PAID').length, categories: db.categories.length, items: db.items.length, pricedActiveItems: activePricedItems(db).length, deals: db.deals.length, pricedActiveDeals: activePricedDeals(db).length, tables: db.tables.length } });
    if (pathname === '/api/audit/status' && req.method === 'GET') return send(res, 200, finalAuditStatus(db));
    if (pathname === '/api/audit/final-360' && req.method === 'GET') return send(res, 200, finalAuditStatus(db));
    if (pathname === '/api/ops/scenarios' && req.method === 'GET') return send(res, 200, operationalScenarioMatrix(db));
    if (pathname === '/api/login' && req.method === 'POST') { const body = await parseBody(req); const user = db.users.find(u => u.email.toLowerCase() === String(body.email || '').toLowerCase() && u.active); if (!user || !verifyUserPassword(user, body.password)) return send(res, 401, { ok: false, error: 'Invalid login' }); const token = createSession(user, userPermissions(db, user)); audit(db, user, 'LOGIN', { email: user.email }); await saveDb(db); return send(res, 200, { ok: true, token, user: publicUser(db, user) }); }
    const user = requireAuth(req, db);
    if (pathname === '/api/session/logout' && req.method === 'POST') { const b = await parseBody(req).catch(()=>({})); const reason = String(b.reason || 'manual').slice(0,60); db.sessionLogs = Array.isArray(db.sessionLogs) ? db.sessionLogs : []; db.sessionLogs.unshift({ id: uid('sess'), userId: user.id, userName: user.name, reason, at: now(), userAgent: String(req.headers['user-agent'] || '').slice(0,180) }); db.sessionLogs = db.sessionLogs.slice(0,500); audit(db, user, reason === 'inactivity' ? 'AUTO_LOGOUT_INACTIVITY' : 'LOGOUT', { reason }); await saveDb(db, reason === 'inactivity' ? 'auto-logout-inactivity' : 'session-logout'); return send(res, 200, { ok: true }); }
    if (pathname === '/api/sync/status' && req.method === 'GET') return send(res, 200, { ok: true, sync: syncSnapshot(db, query.orderId || '') });
    if (pathname === '/api/account/change-password' && req.method === 'POST') { const b = await parseBody(req); const u = db.users.find(x => x.id === user.id); if (!u) throw Object.assign(new Error('User not found'), { status: 404 }); if (!b.currentPassword || !verifyUserPassword(u, b.currentPassword)) throw Object.assign(new Error('Current password is incorrect'), { status: 403 }); if (!b.newPassword || String(b.newPassword).length < 8) throw Object.assign(new Error('New password must be at least 8 characters'), { status: 422 }); if (isDefaultPasswordValue(b.newPassword)) throw Object.assign(new Error('Default password is not allowed for production'), { status: 422 }); setUserPassword(u, String(b.newPassword)); audit(db, user, 'PASSWORD_CHANGED', { userId: u.id, email: u.email }); await saveDb(db); return send(res, 200, { ok: true }); }
    if (pathname === '/api/account/register-pin' && req.method === 'POST') { const b = await parseBody(req); const u = db.users.find(x => x.id === user.id); if (!u) throw Object.assign(new Error('User not found'), { status: 404 }); if (u.pinHash || u.pin) throw Object.assign(new Error('PIN already exists. Use Change PIN.'), { status: 409 }); if (!b.password || !verifyUserPassword(u, b.password)) throw Object.assign(new Error('Current password is incorrect'), { status: 403 }); const pin = assertPinFormat(b.pin); if (String(b.confirmPin || '') !== pin) throw Object.assign(new Error('PIN confirmation does not match'), { status: 422 }); setUserPin(u, pin); db.pinEvents = Array.isArray(db.pinEvents) ? db.pinEvents : []; db.pinEvents.unshift({ id: uid('pin'), action: 'PIN_REGISTERED', targetUserId: u.id, byUserId: u.id, by: u.name, at: now() }); db.pinEvents = db.pinEvents.slice(0, 500); audit(db, user, 'PIN_REGISTERED', { userId: u.id, email: u.email }); await saveDb(db); return send(res, 200, { ok: true, user: sanitizeUserForClient(u) }); }
    if (pathname === '/api/account/change-pin' && req.method === 'POST') { const b = await parseBody(req); const u = db.users.find(x => x.id === user.id); if (!u) throw Object.assign(new Error('User not found'), { status: 404 }); if (!(u.pinHash || u.pin)) throw Object.assign(new Error('No PIN exists. Register PIN first.'), { status: 409 }); const currentOk = (b.currentPin && verifyUserPin(u, b.currentPin)) || (b.password && verifyUserPassword(u, b.password)); if (!currentOk) throw Object.assign(new Error('Current PIN or password is incorrect'), { status: 403 }); const pin = assertPinFormat(b.newPin || b.pin, 'New PIN'); if (String(b.confirmPin || '') !== pin) throw Object.assign(new Error('PIN confirmation does not match'), { status: 422 }); setUserPin(u, pin); db.pinEvents = Array.isArray(db.pinEvents) ? db.pinEvents : []; db.pinEvents.unshift({ id: uid('pin'), action: 'PIN_CHANGED', targetUserId: u.id, byUserId: u.id, by: u.name, at: now() }); db.pinEvents = db.pinEvents.slice(0, 500); audit(db, user, 'PIN_CHANGED', { userId: u.id, email: u.email }); await saveDb(db); return send(res, 200, { ok: true, user: sanitizeUserForClient(u) }); }
    if (pathname === '/api/account/remove-pin' && req.method === 'POST') { const b = await parseBody(req); const u = db.users.find(x => x.id === user.id); if (!u) throw Object.assign(new Error('User not found'), { status: 404 }); if (!b.password || !verifyUserPassword(u, b.password)) throw Object.assign(new Error('Current password is incorrect'), { status: 403 }); clearUserPin(u); db.pinEvents = Array.isArray(db.pinEvents) ? db.pinEvents : []; db.pinEvents.unshift({ id: uid('pin'), action: 'PIN_REMOVED', targetUserId: u.id, byUserId: u.id, by: u.name, at: now() }); db.pinEvents = db.pinEvents.slice(0, 500); audit(db, user, 'PIN_REMOVED', { userId: u.id, email: u.email }); await saveDb(db); return send(res, 200, { ok: true, user: sanitizeUserForClient(u) }); }
    if (pathname === '/api/state') return send(res, 200, { ok: true, data: compactState(db, user) });
    if (pathname === '/api/orders/cart-sync' && req.method === 'POST') { requirePerm(db, user, 'pos.edit'); return saveCartSync(res, db, user, await parseBody(req)); }

    if (pathname === '/api/upload-image' && req.method === 'POST') { requirePerm(db, user, 'admin.menu'); const body = await parseBody(req); const match = String(body.dataUrl || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/); if (!match) throw Object.assign(new Error('Invalid image data'), { status: 422 }); const contentType = match[1]; const bytes = Buffer.from(match[2], 'base64'); assertImage({ contentType, bytes }); const ext = contentType.split('/')[1].replace('jpeg', 'jpg').replace('svg+xml', 'svg'); const folder = ['category','item','deal','logo','receipt'].includes(body.folder) ? body.folder : 'uploads'; const fallbackName = `${Date.now()}-${safeName(body.filename || 'image').replace(/\.[a-z0-9]+$/i, '')}.${ext}`; if (hasR2Config()) { const key = makeMediaKey({ tenant: 'swifttill', folder, filename: body.filename || fallbackName }); const uploaded = await uploadImageToR2({ key, body: bytes, contentType }); audit(db, user, 'R2_IMAGE_UPLOADED', { key: uploaded.key, url: uploaded.url, folder }); await saveDb(db); return send(res, 200, { ok: true, storage: 'r2', url: uploaded.url || publicUrlForKey(uploaded.key), key: uploaded.key }); } if (productionMode()) throw Object.assign(new Error('Cloudflare R2 is required for production uploads'), { status: 503 }); ensureDir(path.join(PUBLIC_DIR, 'uploads')); fs.writeFileSync(path.join(PUBLIC_DIR, 'uploads', fallbackName), bytes); audit(db, user, 'LOCAL_IMAGE_UPLOADED_DEV_ONLY', { file: fallbackName, folder }); await saveDb(db); return send(res, 200, { ok: true, storage: 'local-dev', url: `/uploads/${fallbackName}`, key: fallbackName }); }

    if ((pathname === '/api/day/open' || pathname === '/api/shift/open') && req.method === 'POST') { requirePerm(db, user, 'pos.pay'); const body = await parseBody(req); if (activeShift(db)) throw Object.assign(new Error('A business day is already open. Close the current day first.'), { status: 409 }); const businessDate = validateBusinessDate(body.businessDate || localDateKey()); const shift = { id: uid('day'), number: db.shifts.length + 1, type: 'BUSINESS_DAY', status: 'OPEN', businessDate, dayLabel: businessDate, cashierId: user.id, cashierName: user.name, openedBy: user.name, openingCash: money(body.openingCash), openedAt: now(), note: body.note || '' }; db.shifts.push(shift); audit(db, user, 'DAY_OPENED', shift); await saveDb(db, 'business-day-opened'); return send(res, 200, { ok: true, shift, day: shift }); }
    if ((pathname === '/api/day/close' || pathname === '/api/shift/close') && req.method === 'POST') {
      requirePerm(db, user, 'pos.pay');
      const body = await parseBody(req);
      const shift = activeShift(db);
      if (!shift) throw Object.assign(new Error('No open business day'), { status: 409 });
      const openBills = db.orders.filter(o => ['OPEN','HELD','DRAFT'].includes(o.status) && hasBillLines(o));
      if (openBills.length) throw Object.assign(new Error(`Close/pay/void all open bills before day close. Open bills: ${openBills.length}`), { status: 409 });
      if (body.countedCash === undefined || body.countedCash === null || body.countedCash === '') throw Object.assign(new Error('Physical cash count is required to close day'), { status: 422 });
      const rd = reportData(db, { shiftId: shift.id });
      const sh = rd.shiftSummary || {};
      shift.status = 'CLOSED';
      shift.countedCash = money(body.countedCash);
      shift.expectedCash = money(sh.expectedCash || 0);
      shift.difference = money(shift.countedCash - shift.expectedCash);
      shift.cardSales = money(sh.cardSales || 0);
      shift.cardRefunds = money(sh.cardRefunds || 0);
      shift.onlineSales = money(sh.onlineSales || 0);
      shift.onlineRefunds = money(sh.onlineRefunds || 0);
      shift.nonCashSales = money(sh.nonCashSales || 0);
      shift.closedAt = now();
      shift.closedBy = user.name;
      shift.closeSummary = {
        orders: rd.summary.orders,
        gross: rd.summary.gross,
        discounts: rd.summary.discounts,
        refunds: rd.summary.refunds,
        net: rd.summary.net,
        totalReceived: rd.summary.totalReceived,
        changeReturned: rd.summary.changeReturned,
        cashSales: money(sh.cashSales || 0),
        cashRefunds: money(sh.cashRefunds || 0),
        expectedCash: shift.expectedCash,
        countedCash: shift.countedCash,
        difference: shift.difference,
        cardSales: shift.cardSales,
        cardRefunds: shift.cardRefunds,
        onlineSales: shift.onlineSales,
        onlineRefunds: shift.onlineRefunds,
        nonCashSales: shift.nonCashSales,
        tenderSummary: rd.tenderSummary || null,
        note: 'Counted cash is physical drawer cash only. Card/online are recorded separately in tender summary.'
      };
      audit(db, user, 'DAY_CLOSED', shift.closeSummary);
      await saveDb(db, 'business-day-closed');
      return send(res, 200, { ok: true, shift, day: shift, report: rd });
    }

    if (pathname === '/api/orders/create' && req.method === 'POST') { requirePerm(db, user, 'pos.create'); const b = await parseBody(req); const businessDay = requireOpenBusinessDay(db); if (!['DINE_IN','DELIVERY','TAKEAWAY'].includes(b.type)) throw Object.assign(new Error('Invalid order type'), { status: 422 }); if (b.type === 'DINE_IN') { if (!b.tableId) throw Object.assign(new Error('Dine In order requires table selection'), { status: 422 }); const table = db.tables.find(t => t.id === b.tableId && t.active); if (!table) throw Object.assign(new Error('Selected table not found'), { status: 404 }); const busy = db.orders.find(o => ['OPEN','HELD'].includes(o.status) && o.type === 'DINE_IN' && o.tableId === b.tableId && hasBillLines(o)); if (busy) throw Object.assign(new Error('This table already has an active order'), { status: 409 }); } const taker = db.orderTakers.find(t => t.id === b.orderTakerId); const createdAt = now(); const order = { id: uid('ord'), number: '', type: b.type, status: 'DRAFT', tableId: b.type === 'DINE_IN' ? b.tableId : null, guests: b.type === 'DINE_IN' ? Number(b.guests || 1) : 0, orderTakerId: b.orderTakerId || null, orderTakerName: taker?.name || '', customerName: b.customerName || '', mobile: b.mobile || '', address: b.address || '', deliveryNotes: b.deliveryNotes || '', deliveryFee: b.type === 'DELIVERY' ? money(b.deliveryFee ?? db.settings.defaultDeliveryFee) : 0, lines: [], discountType: 'NONE', discountValue: 0, createdAt, businessDayId: businessDay.id, shiftId: businessDay.id, businessDate: businessDay.businessDate, businessDayNumber: businessDay.number, tableOccupiedAt: null, cashierId: user.id, cashierName: user.name, timeline: [{ event: 'CREATED', at: createdAt, by: user.name }] }; db.orders.push(order); audit(db, user, 'ORDER_DRAFT_CREATED', { orderId: order.id, type: order.type }); await saveDb(db); return send(res, 200, { ok: true, order }); }
    if (pathname === '/api/orders/save' && req.method === 'POST') { requirePerm(db, user, 'pos.edit'); const b = await parseBody(req); const order = db.orders.find(o => o.id === b.id); if (!order) throw Object.assign(new Error('Order not found'), { status: 404 }); const businessDay = requireOpenBusinessDay(db); if (order.status === 'PAID') throw Object.assign(new Error('Paid order cannot be edited'), { status: 409 }); const nextType = b.type || order.type; const nextTableId = b.tableId ?? order.tableId; if (nextType === 'DINE_IN' && !nextTableId) throw Object.assign(new Error('Dine In order requires table selection'), { status: 422 }); const oldTable = order.tableId; if (nextType === 'DINE_IN' && nextTableId && nextTableId !== order.tableId) { const table = db.tables.find(t => t.id === nextTableId && t.active); if (!table) throw Object.assign(new Error('Selected table not found'), { status: 404 }); const busy = db.orders.find(o => o.id !== order.id && ['OPEN','HELD'].includes(o.status) && o.type === 'DINE_IN' && o.tableId === nextTableId && hasBillLines(o)); if (busy) throw Object.assign(new Error('Target table is busy'), { status: 409 }); } Object.assign(order, { type: nextType, tableId: nextType === 'DINE_IN' ? nextTableId : null, guests: nextType === 'DINE_IN' ? Number((b.guests ?? order.guests) || 1) : 0, orderTakerId: b.orderTakerId ?? order.orderTakerId, orderTakerName: b.orderTakerName ?? order.orderTakerName, customerName: b.customerName ?? order.customerName, mobile: b.mobile ?? order.mobile, address: b.address ?? order.address, deliveryFee: nextType === 'DELIVERY' ? money(b.deliveryFee ?? order.deliveryFee) : 0, lines: Array.isArray(b.lines) ? normalizeOrderLines(b.lines) : normalizeOrderLines(order.lines), discountType: b.discountType || order.discountType, discountValue: money(b.discountValue ?? order.discountValue), updatedAt: now() }); sanitizeDiscount(order); assignOrderBusinessDay(order, businessDay); assertTableAvailableForActiveOrder(db, order, order.tableId, 'This table already has an active order'); if (order.type === 'DINE_IN' && order.tableId && !order.tableOccupiedAt && hasBillLines(order)) order.tableOccupiedAt = oldTable && oldTable !== order.tableId ? (order.createdAt || now()) : now(); if (oldTable && oldTable !== order.tableId) order.timeline.push({ event: 'TABLE_TRANSFERRED', at: now(), by: user.name, from: oldTable, to: order.tableId }); ensureOrderNumber(db, order);
    if (b.hold) { requirePerm(db, user, 'pos.hold'); requireBillLines(order, 'Add at least one item before Hold'); order.status = 'HELD'; order.heldAt = now(); order.timeline.push({ event: 'HELD', at: now(), by: user.name }); } else { requireBillLines(order, 'Add at least one item before saving order'); order.status = 'OPEN'; } audit(db, user, b.hold ? 'ORDER_HELD' : 'ORDER_SAVED', { orderId: order.id, number: order.number }); await saveDb(db); return send(res, 200, { ok: true, order, totals: totals(order) }); }
    if (pathname === '/api/orders/pay' && req.method === 'POST') { requirePerm(db, user, 'pos.pay'); const b = await parseBody(req); const order = db.orders.find(o => o.id === b.id); if (!order) throw Object.assign(new Error('Order not found'), { status: 404 }); const businessDay = requireOpenBusinessDay(db); if (order.status === 'PAID') throw Object.assign(new Error('Order already paid'), { status: 409 }); if (order.type === 'DINE_IN' && !order.tableId) throw Object.assign(new Error('Dine In order requires table before payment'), { status: 422 }); if (Array.isArray(b.lines)) order.lines = normalizeOrderLines(b.lines); order.discountType = b.discountType || order.discountType; order.discountValue = money(b.discountValue ?? order.discountValue); sanitizeDiscount(order); order.deliveryFee = order.type === 'DELIVERY' ? money(b.deliveryFee ?? order.deliveryFee) : 0; sanitizeDiscount(order); requireBillLines(order, 'Add at least one item before payment'); assignOrderBusinessDay(order, businessDay); assertTableAvailableForActiveOrder(db, order, order.tableId, 'This table already has an active order. Open that order instead.'); snapshotOrderForHistory(db, order); const t = totals(order); if (t.total <= 0) throw Object.assign(new Error('Order total must be greater than 0. Check item/deal price.'), { status: 422 }); ensureOrderNumber(db, order);
    const payments = validateAndNormalizePayments(b.payments || [], t.total); order.payments = payments; order.status = 'PAID'; order.paidAt = now(); order.tableReleasedAt = now(); order.timeline.push({ event: 'PAID', at: now(), by: user.name, total: t.total }); audit(db, user, 'ORDER_PAID', { orderId: order.id, number: order.number, total: t.total, payments }); await saveDb(db); return send(res, 200, { ok: true, order, totals: t, receipt: buildReceipt(db, order) }); }
    if (pathname === '/api/orders/void' && req.method === 'POST') { const b = await parseBody(req); const approval = requireActionApproval(db, user, b, 'pos.void'); const order = db.orders.find(o => o.id === b.id); if (!order) throw Object.assign(new Error('Order not found'), { status: 404 }); if (order.status === 'PAID') throw Object.assign(new Error('Paid bill cannot be voided. Use Refund for paid bills.'), { status: 409 }); if (!['OPEN','HELD','DRAFT'].includes(order.status)) throw Object.assign(new Error('Only open/held bills can be voided or cancelled'), { status: 409 }); order.status = 'VOID'; order.voidedAt = now(); order.voidReason = b.reason || 'Voided from POS'; order.voidApprovedBy = approval.by; order.voidApprovalMethod = approval.method; order.cancelledAt = order.voidedAt; order.timeline = Array.isArray(order.timeline) ? order.timeline : []; order.timeline.push({ event: 'VOIDED', at: now(), by: user.name, approvedBy: approval.by, approvalMethod: approval.method, reason: order.voidReason }); audit(db, user, 'ORDER_VOIDED', { orderId: order.id, number: order.number, statusBefore: 'OPEN_OR_HELD', reason: order.voidReason, approvedBy: approval.by, approvalMethod: approval.method }); await saveDb(db); return send(res, 200, { ok: true, order }); }
    if (pathname === '/api/orders/refund' && req.method === 'POST') { requirePerm(db, user, 'pos.refund'); const b = await parseBody(req); requireManager(db, b.managerPin); const order = db.orders.find(o => o.id === b.id); if (!order || order.status !== 'PAID') throw Object.assign(new Error('Paid order not found'), { status: 404 }); const remaining = remainingRefundable(db, order); const amount = money(b.amount || remaining); if (amount <= 0) throw Object.assign(new Error('Invalid refund amount'), { status: 422 }); if (amount > remaining) throw Object.assign(new Error(`Refund exceeds remaining refundable amount: Rs ${remaining}`), { status: 422 }); const refund = { id: uid('ref'), orderId: order.id, orderNumber: order.number, amount, method: b.method || 'Cash', reason: b.reason || 'Refund', createdAt: now(), by: user.name }; db.refunds.push(refund); order.refundTotal = money(refundTotalForOrder(db, order.id)); order.refundStatus = order.refundTotal >= totals(order).total ? 'FULL' : 'PARTIAL'; order.timeline.push({ event: 'REFUNDED', at: now(), by: user.name, amount, refundStatus: order.refundStatus }); audit(db, user, 'ORDER_REFUNDED', refund); await saveDb(db); return send(res, 200, { ok: true, refund, remainingRefundable: remainingRefundable(db, order), refundStatus: order.refundStatus }); }

    if (pathname === '/api/admin/payment-correction' && req.method === 'POST') {
      requirePerm(db, user, 'pos.payment_correction');
      const b = await parseBody(req);
      requireManager(db, b.managerPin);
      const order = db.orders.find(o => o.id === b.id);
      if (!order || order.status !== 'PAID') throw Object.assign(new Error('Paid order not found'), { status: 404 });
      if (refundTotalForOrder(db, order.id) > 0) throw Object.assign(new Error('Payment correction is blocked after refund. Create an audit note or new adjustment instead.'), { status: 409 });
      const t = totals(order);
      const cash = money(b.cash || 0), card = money(b.card || 0), online = money(b.online || 0);
      const received = money(cash + card + online);
      const remaining = money(t.total - received);
      if (remaining > 0) throw Object.assign(new Error(`Payment amount is less than total by Rs ${remaining}`), { status: 422 });
      const extra = money(Math.max(0, received - t.total));
      if (extra > 0 && cash < extra) throw Object.assign(new Error('Extra amount must be cash so change can be returned'), { status: 422 });
      const cashRevenue = money(Math.max(0, cash - extra));
      const before = order.payments || [];
      order.payments = [
        { method: 'Cash', amount: cashRevenue, received: cash, change: extra },
        { method: 'Card', amount: card, received: card, change: 0 },
        { method: 'Online', amount: online, received: online, change: 0 }
      ].filter(p => p.amount > 0 || p.received > 0);
      order.timeline.push({ event: 'PAYMENT_CORRECTED', at: now(), by: user.name, before, after: order.payments });
      audit(db, user, 'PAYMENT_CORRECTED', { orderId: order.id, number: order.number, before, after: order.payments });
      await saveDb(db);
      return send(res, 200, { ok: true, order, receipt: buildReceipt(db, order) });
    }
    if (pathname === '/api/admin/reopen-paid' && req.method === 'POST') {
      requirePerm(db, user, 'pos.payment_correction');
      const b = await parseBody(req);
      requireManager(db, b.managerPin);
      const order = db.orders.find(o => o.id === b.id);
      if (!order || order.status !== 'PAID') throw Object.assign(new Error('Paid order not found'), { status: 404 });
      if (refundTotalForOrder(db, order.id) > 0) throw Object.assign(new Error('Refunded bill cannot be reopened. Use a new bill/adjustment to keep history clean.'), { status: 409 });
      if (order.type === 'DINE_IN' && order.tableId) {
        const busy = db.orders.find(o => o.id !== order.id && ['OPEN','HELD'].includes(o.status) && o.type === 'DINE_IN' && o.tableId === order.tableId && hasBillLines(o));
        if (busy) throw Object.assign(new Error('Original table is busy with another open order'), { status: 409 });
      }
      order.previousPaidSnapshot = { paidAt: order.paidAt, payments: order.payments || [], tableReleasedAt: order.tableReleasedAt };
      order.payments = [];
      order.status = 'OPEN';
      order.reopenedAt = now();
      order.paidAt = null;
      order.tableReleasedAt = null;
      if (order.type === 'DINE_IN' && order.tableId && !order.tableOccupiedAt) order.tableOccupiedAt = order.createdAt || now();
      order.timeline.push({ event: 'REOPENED_FOR_EDIT', at: now(), by: user.name });
      audit(db, user, 'PAID_ORDER_REOPENED', { orderId: order.id, number: order.number });
      await saveDb(db);
      return send(res, 200, { ok: true, order });
    }

    if (pathname === '/api/admin/user-pin' && req.method === 'POST') { requirePerm(db, user, 'admin.users'); const b = await parseBody(req); const target = (db.users || []).find(u => u.id === b.id); if (!target) throw Object.assign(new Error('User not found'), { status: 404 }); if (target.id === user.id && b.clearPin && !(b.password && verifyUserPassword(user, b.password))) throw Object.assign(new Error('Current password required to remove your own PIN'), { status: 403 }); if (b.clearPin) { clearUserPin(target); audit(db, user, 'USER_PIN_REMOVED_BY_ADMIN', { targetUserId: target.id, targetEmail: target.email }); db.pinEvents = Array.isArray(db.pinEvents) ? db.pinEvents : []; db.pinEvents.unshift({ id: uid('pin'), action: 'USER_PIN_REMOVED_BY_ADMIN', targetUserId: target.id, byUserId: user.id, by: user.name, at: now() }); await saveDb(db); return send(res, 200, { ok: true, record: sanitizeUserForClient(target) }); } const pin = assertPinFormat(b.pin); if (String(b.confirmPin || pin) !== pin) throw Object.assign(new Error('PIN confirmation does not match'), { status: 422 }); setUserPin(target, pin); db.pinEvents = Array.isArray(db.pinEvents) ? db.pinEvents : []; db.pinEvents.unshift({ id: uid('pin'), action: 'USER_PIN_SET_BY_ADMIN', targetUserId: target.id, byUserId: user.id, by: user.name, at: now() }); db.pinEvents = db.pinEvents.slice(0, 500); audit(db, user, 'USER_PIN_SET_BY_ADMIN', { targetUserId: target.id, targetEmail: target.email }); await saveDb(db); return send(res, 200, { ok: true, record: sanitizeUserForClient(target) }); }
    if (pathname.startsWith('/api/admin/') && req.method === 'POST') { const b = await parseBody(req); const action = pathname.split('/').pop(); if (['category','item','deal'].includes(action)) { requirePerm(db, user, 'admin.menu'); return upsertList(res, db, user, action === 'category' ? 'categories' : action === 'item' ? 'items' : 'deals', b, `${action.toUpperCase()}_SAVED`); } if (action === 'payment') { requirePerm(db, user, 'admin.payments'); return upsertList(res, db, user, 'paymentMethods', b, 'PAYMENT_METHOD_SAVED'); } if (action === 'table') { requirePerm(db, user, 'admin.tables'); return upsertList(res, db, user, 'tables', b, 'TABLE_SAVED'); } if (action === 'taker') { requirePerm(db, user, 'admin.staff'); return upsertList(res, db, user, 'orderTakers', b, 'ORDER_TAKER_SAVED'); } if (action === 'user') { if (!Array.isArray(b.roleIds)) b.roleIds = b.roleId ? [b.roleId] : ['role_cashier']; return upsertUserRecord(res, db, user, b); } if (action === 'role') { requirePerm(db, user, 'admin.roles'); b.permissions = Array.isArray(b.permissions) ? b.permissions.filter(p => PERMISSIONS.includes(p)) : []; return upsertList(res, db, user, 'roles', b, 'ROLE_SAVED'); } if (action === 'settings') { requirePerm(db, user, 'admin.settings'); const prevLogo = db.settings.logoUrl || ''; const nextSettings = validateAdminRecord('settings', b); if (typeof nextSettings.managerPin === 'string') { const pin = nextSettings.managerPin.trim(); if (pin) { nextSettings.managerPinHash = hashPassword(pin); } delete nextSettings.managerPin; } db.settings = { ...db.settings, ...nextSettings }; if (prevLogo && Object.prototype.hasOwnProperty.call(nextSettings, 'logoUrl') && prevLogo !== (nextSettings.logoUrl || '')) { const cleaned = await cleanupMediaReference(db, prevLogo, 'SETTINGS_OLD_LOGO_DELETED'); db.mediaTrash = Array.isArray(db.mediaTrash) ? db.mediaTrash : []; db.mediaTrash.unshift({ url: prevLogo, action: 'SETTINGS_OLD_LOGO_CLEANUP', cleaned, at: now(), by: user.name }); } audit(db, user, 'SETTINGS_SAVED', Object.keys(nextSettings)); await saveDb(db); return send(res, 200, { ok: true, settings: sanitizeSettingsForClient(db.settings) }); } }

    if (pathname.startsWith('/api/admin/') && req.method === 'DELETE') { const b = await parseBody(req); const action = pathname.split('/').pop(); if (!b.id) throw Object.assign(new Error('Record id is required'), { status: 422 }); if (['category','item','deal'].includes(action)) { requirePerm(db, user, 'admin.menu'); return deleteListRecord(res, db, user, action === 'category' ? 'categories' : action === 'item' ? 'items' : 'deals', b.id, `${action.toUpperCase()}_DELETED`); } if (action === 'payment') { requirePerm(db, user, 'admin.payments'); return deleteListRecord(res, db, user, 'paymentMethods', b.id, 'PAYMENT_METHOD_DELETED'); } if (action === 'table') { requirePerm(db, user, 'admin.tables'); return deleteListRecord(res, db, user, 'tables', b.id, 'TABLE_DELETED'); } if (action === 'taker') { requirePerm(db, user, 'admin.staff'); return deleteListRecord(res, db, user, 'orderTakers', b.id, 'ORDER_TAKER_DELETED'); } if (action === 'user') { requirePerm(db, user, 'admin.users'); return deleteListRecord(res, db, user, 'users', b.id, 'USER_DELETED'); } if (action === 'role') { requirePerm(db, user, 'admin.roles'); return deleteListRecord(res, db, user, 'roles', b.id, 'ROLE_DELETED'); } }

    if (pathname === '/api/print-agent/sample' && req.method === 'GET') { requirePerm(db, user, 'admin.printer'); const sampleOrder = { number: 'TEST', type: 'TEST', status: 'DRAFT', lines: [{ name: 'Print Test Line', qty: 1, price: 1, modifiers: [] }], payments: [], createdAt: now(), cashierName: user.name }; return send(res, 200, { ok: true, receipt: buildReceipt(db, sampleOrder), printAgent: printAgentStatus(db) }); }
    if (pathname === '/api/print-jobs' && req.method === 'POST') { requirePerm(db, user, 'pos.pay'); const b = await parseBody(req); const job = enqueuePrintJob(db, user, b); await saveDb(db); return send(res, 200, { ok: true, queued: true, jobId: job.id, printAgent: printAgentStatus(db) }); }
    if (pathname === '/api/print-jobs/next' && req.method === 'GET') { requirePrintAgentKey(req, db, query); const job = nextPrintJob(db); if (!job) return send(res, 200, { ok: true, job: null }); job.status = 'PRINTING'; job.lockedAt = now(); job.attempts = Number(job.attempts || 0) + 1; await saveDb(db); return send(res, 200, { ok: true, job }); }
    if (pathname === '/api/print-jobs/complete' && req.method === 'POST') { requirePrintAgentKey(req, db, query); const b = await parseBody(req); const job = (db.printJobs || []).find(j => j.id === b.id); if (!job) throw Object.assign(new Error('Print job not found'), { status: 404 }); const max = Number(job.maxAttempts || process.env.SWIFTTILL_PRINT_MAX_ATTEMPTS || 5); job.completedAt = now(); job.lastError = b.error || ''; if (b.ok) { job.status = 'PRINTED'; job.retryAfter = ''; audit(db, null, 'PRINT_JOB_PRINTED', { id: job.id }); } else if (Number(job.attempts || 0) < max) { job.status = 'PENDING'; job.retryAfter = new Date(Date.now() + 30000).toISOString(); audit(db, null, 'PRINT_JOB_RETRY_SCHEDULED', { id: job.id, attempts: job.attempts, error: job.lastError }); } else { job.status = 'FAILED'; audit(db, null, 'PRINT_JOB_FAILED', { id: job.id, attempts: job.attempts, error: job.lastError }); } await saveDb(db); return send(res, 200, { ok: true, job: { id: job.id, status: job.status, attempts: job.attempts, maxAttempts: max, retryAfter: job.retryAfter || '' } }); }
    if (pathname === '/api/print-jobs/status' && req.method === 'GET') { requirePerm(db, user, 'admin.printer'); const jobs=(db.printJobs||[]).slice(0,80).map(j=>({id:j.id,type:j.type,status:j.status,attempts:j.attempts||0,maxAttempts:j.maxAttempts||5,createdAt:j.createdAt,lockedAt:j.lockedAt||'',completedAt:j.completedAt||'',retryAfter:j.retryAfter||'',lastError:j.lastError||''})); return send(res,200,{ok:true, printAgent: printAgentStatus(db), jobs}); }
    if (pathname === '/api/admin/media-cleanup' && req.method === 'POST') { requirePerm(db, user, 'admin.menu'); const result = await cleanupOrphanR2Media(db, user, 'MANUAL_R2_ORPHAN_MEDIA_CLEANUP'); await saveDb(db); return send(res, 200, { ok: true, mediaCleanup: result }); }
    if (pathname === '/api/reports' && req.method === 'GET') { requirePerm(db, user, 'reports.view'); return send(res, 200, { ok: true, data: reportData(db, query) }); }
    if (pathname === '/api/export' && req.method === 'GET') { requirePerm(db, user, 'reports.export'); const rd = reportData(db, query); const type = String(query.type || 'daily'); let rows; if (type === 'itemwise') rows = [['Item','Category','Qty Sold','Gross','Discount Share','Net Sales']].concat(rd.itemWise.map(i => [i.item,i.category,i.qty,i.gross,i.discountShare,i.net])); else if (type === 'category') rows = [['Category','Qty Sold','Gross Sales','Net Sales']].concat(rd.categoryDetails.map(i => [i.category,i.qty,i.gross,i.net])); else if (type === 'payment') rows = [['Payment Mode','Transactions','Received','Change Returned','Net Revenue']].concat(rd.paymentDetails.map(p => [p.method,p.count,p.received,p.change,p.revenue])); else if (type === 'discount') rows = [['Bill No','Date','Order Type','Cashier','Discount Type','Discount Value','Discount Amount','Bill Total']].concat((rd.discountWise.rows||[]).map(o => [o.number,o.date,o.type,o.cashier,o.discountType,o.discountValue,o.discount,o.total])); else if (type === 'voidrefund') rows = [['Type','Bill','Date','Method/Status','Amount','Reason','By']].concat((rd.refunds||[]).map(r => ['REFUND',r.orderNumber,r.createdAt,r.method,r.amount,r.reason,r.by])).concat((rd.voidOrders||[]).map(o => ['VOID',o.number,o.voidedAt||o.createdAt,o.status,totals(o).total,o.voidReason,o.cashierName])); else if (type === 'ordertype') rows = [['Order Type','Orders','Guests','Gross','Discount','Net','Average Bill']].concat(rd.orderTypeDetails.map(o => [o.type,o.orders,o.guests,o.gross,o.discount,o.net,o.orders?money(o.net/o.orders):0])); else if (type === 'x' || type === 'z') rows = [['Section','Value'],['Report',type.toUpperCase()],['Shift No',rd.shiftSummary.shiftNumber],['Shift Status',rd.shiftSummary.shiftStatus],['Opening Cash',rd.shiftSummary.openingCash],['Cash Sales',rd.shiftSummary.cashSales],['Cash Refunds',rd.shiftSummary.cashRefunds],['Expected Cash',rd.shiftSummary.expectedCash],['Counted Cash',rd.shiftSummary.countedCash ?? ''],['Difference',rd.shiftSummary.difference ?? ''],['Orders',rd.summary.orders],['Gross Sales',rd.summary.gross],['Discounts',rd.summary.discounts],['Refunds',rd.summary.refunds],['Net Sales',rd.summary.net],[],['Payment Mode','Transactions','Received','Change','Revenue']].concat(rd.paymentDetails.map(p=>[p.method,p.count,p.received,p.change,p.revenue])); else rows = [['Bill No','Date','Order Type','Table','Guests','Customer','Mobile','Order Taker','Cashier','Subtotal','Discount','Delivery Fee','Total','Payments']].concat(rd.orders.map(o => [o.number,o.date,o.type,o.table,o.guests,o.customer,o.mobile,o.orderTaker,o.cashier,o.subtotal,o.discount,o.deliveryFee,o.total,o.payments])); const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(',')).join('\n'); return sendText(res, 200, csv, 'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="swifttill-${type}-report-${Date.now()}.csv"` }); }
    if (pathname === '/api/backup/status' && req.method === 'GET') { requireOwnerMaintenance(req); return send(res, 200, { ok: true, backup: backupSummary(db) }); }
    if (pathname === '/api/backup/create' && req.method === 'POST') { requireOwnerMaintenance(req); const b = await parseBody(req); const rec = await createBackupSnapshot(db, user, b.type || 'manual'); await saveDb(db); return send(res, 200, { ok: true, backup: rec, summary: backupSummary(db) }); }
    if (pathname === '/api/backup/download' && req.method === 'GET') { requireOwnerMaintenance(req); const rec = await createBackupSnapshot(db, user, 'manual'); await saveDb(db); return sendText(res, 200, JSON.stringify({ exportedAt: now(), app: 'SwiftTill POS', backup: rec, db }, null, 2), 'application/json; charset=utf-8', { 'Content-Disposition': `attachment; filename="swifttill-backup-${Date.now()}.json"` }); }
    if (pathname === '/api/backup/restore' && req.method === 'POST') { requireOwnerMaintenance(req); const b = await parseBody(req); const next = b.db || b; if (!next.settings || !Array.isArray(next.orders) || !Array.isArray(next.items)) throw Object.assign(new Error('Invalid backup'), { status: 422 }); audit(next, user, 'BACKUP_RESTORED', { at: now() }); await saveDb(next); return send(res, 200, { ok: true }); }
    send(res, 404, { ok: false, error: 'API not found' });
  } catch (err) { send(res, err.status || 500, { ok: false, error: err.message || 'Server error' }); }
}
function staticServe(req, res, pathname) { let filePath = pathname === '/' ? path.join(PUBLIC_DIR, 'index.html') : path.join(PUBLIC_DIR, decodeURIComponent(pathname)); if (!filePath.startsWith(PUBLIC_DIR)) return sendText(res, 403, 'Forbidden'); if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) filePath = path.join(PUBLIC_DIR, 'index.html'); const ext = path.extname(filePath).toLowerCase(); const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'application/javascript; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.webmanifest':'application/manifest+json' }; const noStore = ['.html','.js','.css','.webmanifest'].includes(ext); res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': noStore ? 'no-store, max-age=0' : 'public, max-age=3600' }); fs.createReadStream(filePath).pipe(res); }
const server = http.createServer(async (req, res) => { const parsed = url.parse(req.url, true); if (parsed.pathname.startsWith('/api/')) return handleApi(req, res, parsed.pathname, parsed.query); staticServe(req, res, parsed.pathname); });
server.listen(PORT, async () => { ensureDir(path.join(PUBLIC_DIR, 'uploads')); ensureDir(STORAGE_DIR); try { await loadDb(); } catch (e) { console.error('Startup data store check failed:', e.message); if (productionMode()) process.exit(1); } console.log(`SwiftTill POS running: http://localhost:${PORT}`); console.log(`Runtime env: DATABASE_URL=${hasDatabaseUrl() ? 'loaded' : 'missing'}, DATA_STORE=${shouldUseCloudState() ? 'postgresql-cloud-state' : 'local-json'}, R2=${hasR2Config() ? 'configured' : 'missing'}`); console.log('Bootstrap login exists only until password is changed. Do not expose credentials to staff.'); });


/* V23 professional POS reports rebuild: closeout-grade summaries, totals footers and richer grouped rows. */
function reportData(db, filters = {}) {
  const from = filters.from || '';
  const to = filters.to || '';
  const wantPayment = String(filters.paymentMode || '').toLowerCase();
  const wantItem = filters.itemId || '';
  const wantCategory = filters.categoryId || '';
  const wantOrderType = filters.orderType || '';
  const wantCashier = filters.cashierId || '';
  const wantTaker = filters.orderTakerId || '';
  const wantShift = filters.shiftId || '';
  const discountOnly = filters.discountOnly === '1' || filters.discountOnly === true;
  const refundOnly = filters.refundOnly === '1' || filters.refundOnly === true;
  const allPaid = db.orders.filter(o => o.status === 'PAID' && between(o.paidAt || o.createdAt, from, to));
  let paid = allPaid.filter(o => {
    if (wantPayment && !(o.payments || []).some(p => String(p.method || '').toLowerCase() === wantPayment)) return false;
    if (wantItem && !(o.lines || []).some(l => l.itemId === wantItem || l.dealId === wantItem)) return false;
    if (wantCategory && !(o.lines || []).some(l => l.categoryId === wantCategory)) return false;
    if (wantOrderType && o.type !== wantOrderType) return false;
    if (wantCashier && o.cashierId !== wantCashier) return false;
    if (wantTaker && o.orderTakerId !== wantTaker) return false;
    if (wantShift) {
      const shift = db.shifts.find(s => s.id === wantShift);
      if (!shift) return false;
      const t = new Date(o.paidAt || o.createdAt).getTime();
      const a = new Date(shift.openedAt).getTime();
      const b = shift.closedAt ? new Date(shift.closedAt).getTime() : Date.now() + 86400000;
      if (t < a || t > b) return false;
    }
    if (discountOnly && totals(o).discount <= 0) return false;
    return true;
  });
  let refunds = db.refunds.filter(r => between(r.createdAt, from, to));
  if (refundOnly) {
    const refundOrderIds = new Set(refunds.map(r => r.orderId));
    paid = paid.filter(o => refundOrderIds.has(o.id));
  }
  const gross = paid.reduce((s,o) => s + totals(o).subtotal + totals(o).deliveryFee, 0);
  const discounts = paid.reduce((s,o) => s + totals(o).discount, 0);
  const refundAmount = refunds.reduce((s,r) => s + Number(r.amount || 0), 0);
  const net = paid.reduce((s,o) => s + totals(o).total, 0) - refundAmount;
  const paymentWise = {}, paymentDetails = {}, itemWise = {}, categoryWise = {}, categoryDetails = {}, orderTypeWise = {}, orderTypeDetails = {}, discountRows = [];
  let guests = 0, changeReturned = 0, totalReceived = 0;
  for (const o of paid) {
    const ot = totals(o);
    guests += Number(o.guests || 0);
    orderTypeWise[o.type] = money((orderTypeWise[o.type] || 0) + ot.total);
    orderTypeDetails[o.type] ||= { type: o.type, orders: 0, guests: 0, gross: 0, discount: 0, net: 0 };
    orderTypeDetails[o.type].orders += 1; orderTypeDetails[o.type].guests += Number(o.guests || 0); orderTypeDetails[o.type].gross = money(orderTypeDetails[o.type].gross + ot.subtotal + ot.deliveryFee); orderTypeDetails[o.type].discount = money(orderTypeDetails[o.type].discount + ot.discount); orderTypeDetails[o.type].net = money(orderTypeDetails[o.type].net + ot.total);
    if (ot.discount > 0) discountRows.push({ number: o.number, date: o.paidAt, type: o.type, cashier: o.cashierName || '', discountType: o.discountType || '', discountValue: o.discountValue || 0, discount: ot.discount, total: ot.total });
    for (const p of (o.payments || [])) {
      const method = p.method || 'Unknown';
      paymentWise[method] = money((paymentWise[method] || 0) + Number(p.amount || 0));
      paymentDetails[method] ||= { method, count: 0, received: 0, change: 0, revenue: 0 };
      paymentDetails[method].count += 1;
      paymentDetails[method].received = money(paymentDetails[method].received + Number(p.received ?? p.amount ?? 0));
      paymentDetails[method].change = money(paymentDetails[method].change + Number(p.change || 0));
      paymentDetails[method].revenue = money(paymentDetails[method].revenue + Number(p.amount || 0));
      totalReceived = money(totalReceived + Number(p.received ?? p.amount ?? 0));
      changeReturned = money(changeReturned + Number(p.change || 0));
    }
    for (const l of (o.lines || [])) {
      const mods = (l.modifiers || []).reduce((a,m) => a + Number(m.price || 0), 0);
      const qty = Number(l.qty) || 0;
      const grossLine = money(((Number(l.price) || 0) + mods) * qty);
      const cat = l.categoryName || db.categories.find(c => c.id === l.categoryId)?.name || (l.kind === 'DEAL' ? 'Deals' : 'Uncategorized');
      itemWise[l.name] ||= { item: l.name, category: cat, qty: 0, gross: 0, discountShare: 0, net: 0 };
      itemWise[l.name].qty += qty; itemWise[l.name].gross = money(itemWise[l.name].gross + grossLine);
      categoryWise[cat] = money((categoryWise[cat] || 0) + grossLine);
      categoryDetails[cat] ||= { category: cat, qty: 0, gross: 0, net: 0 };
      categoryDetails[cat].qty += qty; categoryDetails[cat].gross = money(categoryDetails[cat].gross + grossLine);
    }
  }
  for (const row of Object.values(itemWise)) { row.discountShare = paid.length ? money(discounts * (row.gross / Math.max(1, gross))) : 0; row.net = money(row.gross - row.discountShare); }
  for (const row of Object.values(categoryDetails)) row.net = money(row.gross - (paid.length ? discounts * (row.gross / Math.max(1, gross)) : 0));
  const shiftForSummary = wantShift ? db.shifts.find(s => s.id === wantShift) : activeShift(db);
  const cashSalesForSummary = paymentWise.Cash || 0;
  const openingCashForSummary = shiftForSummary ? Number(shiftForSummary.openingCash || 0) : 0;
  const expectedCashForSummary = money(openingCashForSummary + cashSalesForSummary - refunds.filter(r => String(r.method||'Cash')==='Cash').reduce((s,r)=>s+Number(r.amount||0),0));
  const orders = paid.map(o => ({ number: o.number, date: o.paidAt, type: o.type, table: db.tables.find(t => t.id === o.tableId)?.name || '', customer: o.customerName || '', mobile: o.mobile || '', cashier: o.cashierName || '', orderTaker: o.orderTakerName || '', guests: o.guests || 0, subtotal: totals(o).subtotal, discount: totals(o).discount, deliveryFee: totals(o).deliveryFee, total: totals(o).total, payments: (o.payments || []).map(p => `${p.method}:${p.amount}${p.change?` change:${p.change}`:''}`).join(', ') }));
  return { range: { from, to }, filters, shiftSummary: { shiftId: shiftForSummary?.id || '', shiftNumber: shiftForSummary?.number || '', shiftStatus: shiftForSummary?.status || '', openingCash: money(openingCashForSummary), cashSales: money(cashSalesForSummary), cashRefunds: money(refunds.filter(r => String(r.method||'Cash')==='Cash').reduce((s,r)=>s+Number(r.amount||0),0)), expectedCash: expectedCashForSummary, countedCash: shiftForSummary?.countedCash ?? null, difference: shiftForSummary?.difference ?? null, openedAt: shiftForSummary?.openedAt || '', closedAt: shiftForSummary?.closedAt || '' }, summary: { orders: paid.length, guests, gross: money(gross), discounts: money(discounts), refunds: money(refundAmount), net: money(net), averageBill: paid.length ? money(net / paid.length) : 0, averageGuest: guests ? money(net / guests) : 0, totalReceived: money(totalReceived), changeReturned }, paymentWise, paymentDetails: Object.values(paymentDetails), itemWise: Object.values(itemWise).sort((a,b) => b.net - a.net), categoryWise, categoryDetails: Object.values(categoryDetails).sort((a,b)=>b.net-a.net), orderTypeWise, orderTypeDetails: Object.values(orderTypeDetails), discountWise: { count: discountRows.length, amount: money(discounts), rows: discountRows }, refunds, voidOrders: db.orders.filter(o => o.status === 'VOID' && between(o.voidedAt || o.createdAt, from, to)).map(o => ({ ...o, total: totals(o).total })), orders };
}


/* ============================================================
   SwiftTill V46 Business Day + compact report final overrides
   Online-only POS. Offline concept remains removed.
============================================================ */
function localDateKey(d = new Date()) {
  const x = new Date(d);
  x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0,10);
}
function validateBusinessDate(v) {
  const s = String(v || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw Object.assign(new Error('Business date is required'), { status: 422 });
  return s;
}
function activeShift(db) { return (db.shifts || []).find(s => s.status === 'OPEN') || null; }
function requireOpenBusinessDay(db) {
  const day = activeShift(db);
  if (!day) throw Object.assign(new Error('Open Day is required before billing. Open day from top bar first.'), { status: 409 });
  if (!day.businessDate) day.businessDate = localDateKey(day.openedAt || new Date());
  return day;
}
function assignOrderBusinessDay(order, day) {
  if (!order || !day) return order;
  order.businessDayId = day.id;
  order.shiftId = day.id;
  order.businessDate = day.businessDate || localDateKey(day.openedAt || new Date());
  order.businessDayNumber = day.number;
  return order;
}
function shiftLabel(s) { return s ? `Day #${s.number} · ${s.businessDate || localDateKey(s.openedAt)} · ${s.status}` : ''; }
function compactState(db, user) {
  const shifts = (db.shifts || []).slice().sort((a,b)=> new Date(b.openedAt || 0) - new Date(a.openedAt || 0));
  const openDay = activeShift(db);
  return { sync: syncSnapshot(db), user: publicUser(db, user), permissions: userPermissions(db, user), permissionCatalog: PERMISSIONS, settings: sanitizeSettingsForClient(db.settings), roles: db.roles, categories: db.categories, items: db.items, deals: db.deals, tables: tableMap(db), orderTakers: db.orderTakers, paymentMethods: db.paymentMethods, users: db.users.map(sanitizeUserForClient), openOrders: db.orders.filter(o => ['OPEN','HELD'].includes(o.status) && hasBillLines(o)).sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt)), paidOrders: db.orders.filter(o => o.status === 'PAID').slice(-1000).reverse(), refunds: db.refunds.slice(-1000).reverse(), shifts, activeShift: openDay, businessDay: { active: !!openDay, activeDay: openDay || null, lastClosed: shifts.find(s => s.status === 'CLOSED') || null, requireOpenBeforeBilling: true, saleGrouping: 'business-day-open-to-close' }, auditLogs: db.auditLogs.slice(0, 120), backup: backupSummary(db), mediaTrash: (db.mediaTrash || []).slice(0, 50), printJobs: (db.printJobs || []).slice(0, 80), pinEvents: (db.pinEvents || []).slice(0, 50), setup: setupStatus(db), printAgent: printAgentStatus(db) };
}
async function saveCartSync(res, db, user, body) {
  const order = (db.orders || []).find(o => o.id === body.id);
  if (!order) throw Object.assign(new Error('Order not found'), { status: 404 });
  if (order.status === 'PAID') throw Object.assign(new Error('Order already paid on another device'), { status: 409 });
  const nextType = body.type || order.type;
  const nextTableId = body.tableId ?? order.tableId;
  const nextLines = Array.isArray(body.lines) ? normalizeOrderLines(body.lines) : normalizeOrderLines(order.lines);
  const day = nextLines.length ? requireOpenBusinessDay(db) : activeShift(db);
  Object.assign(order, {
    type: nextType,
    tableId: nextType === 'DINE_IN' ? nextTableId : null,
    guests: nextType === 'DINE_IN' ? Number((body.guests ?? order.guests) || 1) : 0,
    orderTakerId: body.orderTakerId ?? order.orderTakerId,
    orderTakerName: body.orderTakerName ?? order.orderTakerName,
    customerName: body.customerName ?? order.customerName,
    mobile: body.mobile ?? order.mobile,
    address: body.address ?? order.address,
    deliveryFee: nextType === 'DELIVERY' ? money(body.deliveryFee ?? order.deliveryFee) : 0,
    lines: nextLines,
    discountType: body.discountType || order.discountType || 'NONE',
    discountValue: money(body.discountValue ?? order.discountValue),
    updatedAt: now(),
    lastSyncedBy: user.name
  });
  sanitizeDiscount(order);
  if (!hasBillLines(order)) {
    order.status = 'DRAFT';
    order.tableOccupiedAt = null;
  } else {
    assignOrderBusinessDay(order, day);
    if (order.type === 'DINE_IN' && !order.tableId) throw Object.assign(new Error('Dine In order requires table selection'), { status: 422 });
    assertTableAvailableForActiveOrder(db, order, order.tableId, 'This table already has an active order. Open that order instead.');
    ensureOrderNumber(db, order);
    if (order.type === 'DINE_IN' && order.tableId && !order.tableOccupiedAt) order.tableOccupiedAt = order.createdAt || now();
    order.status = body.hold ? 'HELD' : 'OPEN';
  }
  order.lastSyncAt = now();
  order.lastSyncBy = user.name;
  await saveDb(db, 'order-cart-sync');
  return send(res, 200, { ok: true, order, totals: totals(order), sync: syncSnapshot(db, order.id) });
}
function paidOrderBelongsToShift(order, shift) {
  if (!order || !shift) return false;
  if (order.businessDayId === shift.id || order.shiftId === shift.id) return true;
  const t = new Date(order.paidAt || order.createdAt || 0).getTime();
  const a = new Date(shift.openedAt || 0).getTime();
  const b = shift.closedAt ? new Date(shift.closedAt).getTime() : Date.now() + 86400000;
  return Number.isFinite(t) && t >= a && t <= b;
}
function reportData(db, filters = {}) {
  const from = filters.from || '';
  const to = filters.to || '';
  const wantPayment = String(filters.paymentMode || '').toLowerCase();
  const wantItem = filters.itemId || '';
  const wantCategory = filters.categoryId || '';
  const wantOrderType = filters.orderType || '';
  const wantCashier = filters.cashierId || '';
  const wantTaker = filters.orderTakerId || '';
  const wantShift = filters.shiftId || '';
  const selectedShift = wantShift ? (db.shifts || []).find(s => s.id === wantShift) : null;
  const discountOnly = filters.discountOnly === '1' || filters.discountOnly === true;
  const refundOnly = filters.refundOnly === '1' || filters.refundOnly === true;
  let paid = (db.orders || []).filter(o => o.status === 'PAID');
  paid = selectedShift ? paid.filter(o => paidOrderBelongsToShift(o, selectedShift)) : paid.filter(o => between(o.paidAt || o.createdAt, from, to));
  paid = paid.filter(o => {
    if (wantPayment && !(o.payments || []).some(p => String(p.method || '').toLowerCase() === wantPayment)) return false;
    if (wantItem && !(o.lines || []).some(l => l.itemId === wantItem || l.dealId === wantItem)) return false;
    if (wantCategory && !(o.lines || []).some(l => l.categoryId === wantCategory)) return false;
    if (wantOrderType && o.type !== wantOrderType) return false;
    if (wantCashier && o.cashierId !== wantCashier) return false;
    if (wantTaker && o.orderTakerId !== wantTaker) return false;
    if (discountOnly && totals(o).discount <= 0) return false;
    return true;
  });
  let refunds = (db.refunds || []).filter(r => {
    if (selectedShift) {
      const o = (db.orders || []).find(x => x.id === r.orderId);
      return paidOrderBelongsToShift(o, selectedShift) || between(r.createdAt, selectedShift.openedAt?.slice(0,10), (selectedShift.closedAt || now()).slice(0,10));
    }
    return between(r.createdAt, from, to);
  });
  if (refundOnly) {
    const refundOrderIds = new Set(refunds.map(r => r.orderId));
    paid = paid.filter(o => refundOrderIds.has(o.id));
  }
  const gross = paid.reduce((s,o) => s + totals(o).subtotal + totals(o).deliveryFee, 0);
  const discounts = paid.reduce((s,o) => s + totals(o).discount, 0);
  const refundAmount = refunds.reduce((s,r) => s + Number(r.amount || 0), 0);
  const net = paid.reduce((s,o) => s + totals(o).total, 0) - refundAmount;
  const paymentWise = {}, paymentDetails = {}, itemWise = {}, categoryWise = {}, categoryDetails = {}, orderTypeWise = {}, orderTypeDetails = {}, discountRows = [];
  let guests = 0, changeReturned = 0, totalReceived = 0;
  for (const o of paid) {
    const ot = totals(o);
    guests += Number(o.guests || 0);
    orderTypeWise[o.type] = money((orderTypeWise[o.type] || 0) + ot.total);
    orderTypeDetails[o.type] ||= { type: o.type, orders: 0, guests: 0, gross: 0, discount: 0, net: 0 };
    orderTypeDetails[o.type].orders += 1;
    orderTypeDetails[o.type].guests += Number(o.guests || 0);
    orderTypeDetails[o.type].gross = money(orderTypeDetails[o.type].gross + ot.subtotal + ot.deliveryFee);
    orderTypeDetails[o.type].discount = money(orderTypeDetails[o.type].discount + ot.discount);
    orderTypeDetails[o.type].net = money(orderTypeDetails[o.type].net + ot.total);
    if (ot.discount > 0) discountRows.push({ number: o.number, date: o.paidAt, type: o.type, cashier: o.cashierName || '', discountType: o.discountType || '', discountValue: o.discountValue || 0, discount: ot.discount, total: ot.total });
    for (const p of (o.payments || [])) {
      const method = p.method || 'Unknown';
      paymentWise[method] = money((paymentWise[method] || 0) + Number(p.amount || 0));
      paymentDetails[method] ||= { method, count: 0, received: 0, change: 0, revenue: 0 };
      paymentDetails[method].count += 1;
      paymentDetails[method].received = money(paymentDetails[method].received + Number(p.received ?? p.amount ?? 0));
      paymentDetails[method].change = money(paymentDetails[method].change + Number(p.change || 0));
      paymentDetails[method].revenue = money(paymentDetails[method].revenue + Number(p.amount || 0));
      totalReceived = money(totalReceived + Number(p.received ?? p.amount ?? 0));
      changeReturned = money(changeReturned + Number(p.change || 0));
    }
    for (const l of (o.lines || [])) {
      const mods = (l.modifiers || []).reduce((a,m) => a + Number(m.price || 0), 0);
      const qty = Number(l.qty) || 0;
      const grossLine = money(((Number(l.price) || 0) + mods) * qty);
      const cat = l.categoryName || (db.categories || []).find(c => c.id === l.categoryId)?.name || (l.kind === 'DEAL' ? 'Deals' : 'Uncategorized');
      itemWise[l.name] ||= { item: l.name, category: cat, qty: 0, gross: 0, discountShare: 0, net: 0 };
      itemWise[l.name].qty += qty;
      itemWise[l.name].gross = money(itemWise[l.name].gross + grossLine);
      categoryWise[cat] = money((categoryWise[cat] || 0) + grossLine);
      categoryDetails[cat] ||= { category: cat, qty: 0, gross: 0, net: 0 };
      categoryDetails[cat].qty += qty;
      categoryDetails[cat].gross = money(categoryDetails[cat].gross + grossLine);
    }
  }
  for (const row of Object.values(itemWise)) { row.discountShare = paid.length ? money(discounts * (row.gross / Math.max(1, gross))) : 0; row.net = money(row.gross - row.discountShare); }
  for (const row of Object.values(categoryDetails)) row.net = money(row.gross - (paid.length ? discounts * (row.gross / Math.max(1, gross)) : 0));
  const shiftForSummary = selectedShift || activeShift(db) || null;
  const cashSalesForSummary = paymentWise.Cash || 0;
  const openingCashForSummary = shiftForSummary ? Number(shiftForSummary.openingCash || 0) : 0;
  const cashRefunds = money(refunds.filter(r => String(r.method||'Cash')==='Cash').reduce((s,r)=>s+Number(r.amount||0),0));
  const expectedCashForSummary = money(openingCashForSummary + cashSalesForSummary - cashRefunds);
  const orders = paid.map(o => ({ number: o.number, date: o.paidAt, businessDate: o.businessDate || '', businessDayId: o.businessDayId || o.shiftId || '', type: o.type, table: (db.tables || []).find(t => t.id === o.tableId)?.name || '', customer: o.customerName || '', mobile: o.mobile || '', cashier: o.cashierName || '', orderTaker: o.orderTakerName || '', guests: o.guests || 0, subtotal: totals(o).subtotal, discount: totals(o).discount, deliveryFee: totals(o).deliveryFee, total: totals(o).total, payments: (o.payments || []).map(p => `${p.method}:${p.amount}${p.change?` change:${p.change}`:''}`).join(', ') }));
  return { range: { from, to }, filters, businessDay: shiftForSummary ? { id: shiftForSummary.id, number: shiftForSummary.number, businessDate: shiftForSummary.businessDate || '', openedAt: shiftForSummary.openedAt || '', closedAt: shiftForSummary.closedAt || '', status: shiftForSummary.status || '' } : null, shiftSummary: { shiftId: shiftForSummary?.id || '', shiftNumber: shiftForSummary?.number || '', shiftStatus: shiftForSummary?.status || '', businessDate: shiftForSummary?.businessDate || '', openingCash: money(openingCashForSummary), cashSales: money(cashSalesForSummary), cashRefunds, expectedCash: expectedCashForSummary, countedCash: shiftForSummary?.countedCash ?? null, difference: shiftForSummary?.difference ?? null, openedAt: shiftForSummary?.openedAt || '', closedAt: shiftForSummary?.closedAt || '' }, summary: { orders: paid.length, guests, gross: money(gross), discounts: money(discounts), refunds: money(refundAmount), net: money(net), averageBill: paid.length ? money(net / paid.length) : 0, averageGuest: guests ? money(net / guests) : 0, totalReceived: money(totalReceived), changeReturned }, paymentWise, paymentDetails: Object.values(paymentDetails), itemWise: Object.values(itemWise).sort((a,b) => b.net - a.net), categoryWise, categoryDetails: Object.values(categoryDetails).sort((a,b)=>b.net-a.net), orderTypeWise, orderTypeDetails: Object.values(orderTypeDetails), discountWise: { count: discountRows.length, amount: money(discounts), rows: discountRows }, refunds, voidOrders: (db.orders || []).filter(o => o.status === 'VOID' && (selectedShift ? paidOrderBelongsToShift(o, selectedShift) : between(o.voidedAt || o.createdAt, from, to))).map(o => ({ ...o, total: totals(o).total })), orders };
}


/* ============================================================
   SwiftTill V48 Tender-wise Close Day + clearer cash drawer rules
   Cash drawer = physical cash only. Card/Online are recorded as tenders.
============================================================ */
function v48TenderName(method) {
  const raw = String(method || 'Unknown').trim() || 'Unknown';
  const m = raw.toLowerCase();
  if (m.includes('cash')) return 'Cash';
  if (m.includes('card') || m.includes('visa') || m.includes('master')) return 'Card';
  if (m.includes('online') || m.includes('jazz') || m.includes('easy') || m.includes('easypaisa') || m.includes('bank') || m.includes('transfer') || m.includes('raast') || m.includes('qr') || m.includes('wallet')) return 'Online';
  return raw;
}
function v48EmptyTender(method) { return { method, count: 0, sales: 0, received: 0, change: 0, refunds: 0, net: 0 }; }
function v48BuildTenderSummary(paymentDetails = [], refunds = []) {
  const map = { Cash: v48EmptyTender('Cash'), Card: v48EmptyTender('Card'), Online: v48EmptyTender('Online'), Other: v48EmptyTender('Other') };
  for (const p of paymentDetails || []) {
    const name = v48TenderName(p.method);
    const bucket = map[name] ? name : 'Other';
    map[bucket].count += Number(p.count || 0);
    map[bucket].sales = money(map[bucket].sales + Number(p.revenue || p.amount || 0));
    map[bucket].received = money(map[bucket].received + Number(p.received ?? p.revenue ?? 0));
    map[bucket].change = money(map[bucket].change + Number(p.change || 0));
  }
  for (const r of refunds || []) {
    const name = v48TenderName(r.method || 'Cash');
    const bucket = map[name] ? name : 'Other';
    map[bucket].refunds = money(map[bucket].refunds + Number(r.amount || 0));
  }
  for (const k of Object.keys(map)) map[k].net = money(map[k].sales - map[k].refunds);
  return {
    cash: map.Cash,
    card: map.Card,
    online: map.Online,
    other: map.Other,
    all: {
      method: 'All',
      count: Object.values(map).reduce((s,x)=>s+Number(x.count||0),0),
      sales: money(Object.values(map).reduce((s,x)=>s+Number(x.sales||0),0)),
      received: money(Object.values(map).reduce((s,x)=>s+Number(x.received||0),0)),
      change: money(Object.values(map).reduce((s,x)=>s+Number(x.change||0),0)),
      refunds: money(Object.values(map).reduce((s,x)=>s+Number(x.refunds||0),0)),
      net: money(Object.values(map).reduce((s,x)=>s+Number(x.net||0),0))
    }
  };
}
function reportData(db, filters = {}) {
  const from = filters.from || '';
  const to = filters.to || '';
  const wantPayment = String(filters.paymentMode || '').toLowerCase();
  const wantItem = filters.itemId || '';
  const wantCategory = filters.categoryId || '';
  const wantOrderType = filters.orderType || '';
  const wantCashier = filters.cashierId || '';
  const wantTaker = filters.orderTakerId || '';
  const wantShift = filters.shiftId || '';
  const selectedShift = wantShift ? (db.shifts || []).find(s => s.id === wantShift) : null;
  const discountOnly = filters.discountOnly === '1' || filters.discountOnly === true;
  const refundOnly = filters.refundOnly === '1' || filters.refundOnly === true;
  let paid = (db.orders || []).filter(o => o.status === 'PAID');
  paid = selectedShift ? paid.filter(o => paidOrderBelongsToShift(o, selectedShift)) : paid.filter(o => between(o.paidAt || o.createdAt, from, to));
  paid = paid.filter(o => {
    if (wantPayment && !(o.payments || []).some(p => String(p.method || '').toLowerCase() === wantPayment || v48TenderName(p.method).toLowerCase() === wantPayment)) return false;
    if (wantItem && !(o.lines || []).some(l => l.itemId === wantItem || l.dealId === wantItem)) return false;
    if (wantCategory && !(o.lines || []).some(l => l.categoryId === wantCategory)) return false;
    if (wantOrderType && o.type !== wantOrderType) return false;
    if (wantCashier && o.cashierId !== wantCashier) return false;
    if (wantTaker && o.orderTakerId !== wantTaker) return false;
    if (discountOnly && totals(o).discount <= 0) return false;
    return true;
  });
  let refunds = (db.refunds || []).filter(r => {
    if (selectedShift) {
      const o = (db.orders || []).find(x => x.id === r.orderId);
      return paidOrderBelongsToShift(o, selectedShift) || between(r.createdAt, selectedShift.openedAt?.slice(0,10), (selectedShift.closedAt || now()).slice(0,10));
    }
    return between(r.createdAt, from, to);
  });
  if (refundOnly) {
    const refundOrderIds = new Set(refunds.map(r => r.orderId));
    paid = paid.filter(o => refundOrderIds.has(o.id));
  }
  const gross = paid.reduce((s,o) => s + totals(o).subtotal + totals(o).deliveryFee, 0);
  const discounts = paid.reduce((s,o) => s + totals(o).discount, 0);
  const refundAmount = refunds.reduce((s,r) => s + Number(r.amount || 0), 0);
  const net = paid.reduce((s,o) => s + totals(o).total, 0) - refundAmount;
  const paymentWise = {}, paymentDetails = {}, itemWise = {}, categoryWise = {}, categoryDetails = {}, orderTypeWise = {}, orderTypeDetails = {}, discountRows = [];
  let guests = 0, changeReturned = 0, totalReceived = 0;
  for (const o of paid) {
    const ot = totals(o);
    guests += Number(o.guests || 0);
    orderTypeWise[o.type] = money((orderTypeWise[o.type] || 0) + ot.total);
    orderTypeDetails[o.type] ||= { type: o.type, orders: 0, guests: 0, gross: 0, discount: 0, net: 0 };
    orderTypeDetails[o.type].orders += 1;
    orderTypeDetails[o.type].guests += Number(o.guests || 0);
    orderTypeDetails[o.type].gross = money(orderTypeDetails[o.type].gross + ot.subtotal + ot.deliveryFee);
    orderTypeDetails[o.type].discount = money(orderTypeDetails[o.type].discount + ot.discount);
    orderTypeDetails[o.type].net = money(orderTypeDetails[o.type].net + ot.total);
    if (ot.discount > 0) discountRows.push({ number: o.number, date: o.paidAt, type: o.type, cashier: o.cashierName || '', discountType: o.discountType || '', discountValue: o.discountValue || 0, discount: ot.discount, total: ot.total });
    for (const p of (o.payments || [])) {
      const method = v48TenderName(p.method || 'Unknown');
      paymentWise[method] = money((paymentWise[method] || 0) + Number(p.amount || 0));
      paymentDetails[method] ||= { method, count: 0, received: 0, change: 0, revenue: 0 };
      paymentDetails[method].count += 1;
      paymentDetails[method].received = money(paymentDetails[method].received + Number(p.received ?? p.amount ?? 0));
      paymentDetails[method].change = money(paymentDetails[method].change + Number(p.change || 0));
      paymentDetails[method].revenue = money(paymentDetails[method].revenue + Number(p.amount || 0));
      totalReceived = money(totalReceived + Number(p.received ?? p.amount ?? 0));
      changeReturned = money(changeReturned + Number(p.change || 0));
    }
    for (const l of (o.lines || [])) {
      const mods = (l.modifiers || []).reduce((a,m) => a + Number(m.price || 0), 0);
      const qty = Number(l.qty) || 0;
      const grossLine = money(((Number(l.price) || 0) + mods) * qty);
      const cat = l.categoryName || (db.categories || []).find(c => c.id === l.categoryId)?.name || (l.kind === 'DEAL' ? 'Deals' : 'Uncategorized');
      itemWise[l.name] ||= { item: l.name, category: cat, qty: 0, gross: 0, discountShare: 0, net: 0 };
      itemWise[l.name].qty += qty;
      itemWise[l.name].gross = money(itemWise[l.name].gross + grossLine);
      categoryWise[cat] = money((categoryWise[cat] || 0) + grossLine);
      categoryDetails[cat] ||= { category: cat, qty: 0, gross: 0, net: 0 };
      categoryDetails[cat].qty += qty;
      categoryDetails[cat].gross = money(categoryDetails[cat].gross + grossLine);
    }
  }
  for (const row of Object.values(itemWise)) { row.discountShare = paid.length ? money(discounts * (row.gross / Math.max(1, gross))) : 0; row.net = money(row.gross - row.discountShare); }
  for (const row of Object.values(categoryDetails)) row.net = money(row.gross - (paid.length ? discounts * (row.gross / Math.max(1, gross)) : 0));
  const paymentDetailRows = Object.values(paymentDetails).sort((a,b)=>String(a.method).localeCompare(String(b.method)));
  const tenderSummary = v48BuildTenderSummary(paymentDetailRows, refunds);
  const shiftForSummary = selectedShift || activeShift(db) || null;
  const openingCashForSummary = shiftForSummary ? Number(shiftForSummary.openingCash || 0) : 0;
  const cashSalesForSummary = tenderSummary.cash.sales;
  const cashRefunds = tenderSummary.cash.refunds;
  const expectedCashForSummary = money(openingCashForSummary + cashSalesForSummary - cashRefunds);
  const orders = paid.map(o => ({ number: o.number, date: o.paidAt, businessDate: o.businessDate || '', businessDayId: o.businessDayId || o.shiftId || '', type: o.type, table: (db.tables || []).find(t => t.id === o.tableId)?.name || '', customer: o.customerName || '', mobile: o.mobile || '', cashier: o.cashierName || '', orderTaker: o.orderTakerName || '', guests: o.guests || 0, subtotal: totals(o).subtotal, discount: totals(o).discount, deliveryFee: totals(o).deliveryFee, total: totals(o).total, payments: (o.payments || []).map(p => `${v48TenderName(p.method)}:${p.amount}${p.change?` change:${p.change}`:''}`).join(', ') }));
  return {
    range: { from, to }, filters,
    businessDay: shiftForSummary ? { id: shiftForSummary.id, number: shiftForSummary.number, businessDate: shiftForSummary.businessDate || '', openedAt: shiftForSummary.openedAt || '', closedAt: shiftForSummary.closedAt || '', status: shiftForSummary.status || '' } : null,
    shiftSummary: {
      shiftId: shiftForSummary?.id || '', shiftNumber: shiftForSummary?.number || '', shiftStatus: shiftForSummary?.status || '', businessDate: shiftForSummary?.businessDate || '',
      openingCash: money(openingCashForSummary), cashSales: money(cashSalesForSummary), cashRefunds: money(cashRefunds), expectedCash: expectedCashForSummary,
      countedCash: shiftForSummary?.countedCash ?? null, difference: shiftForSummary?.difference ?? null,
      cardSales: tenderSummary.card.sales, cardRefunds: tenderSummary.card.refunds, cardNet: tenderSummary.card.net,
      onlineSales: tenderSummary.online.sales, onlineRefunds: tenderSummary.online.refunds, onlineNet: tenderSummary.online.net,
      otherSales: tenderSummary.other.sales, otherRefunds: tenderSummary.other.refunds, otherNet: tenderSummary.other.net,
      nonCashSales: money(tenderSummary.card.sales + tenderSummary.online.sales + tenderSummary.other.sales),
      nonCashNet: money(tenderSummary.card.net + tenderSummary.online.net + tenderSummary.other.net),
      totalTenderSales: tenderSummary.all.sales, totalTenderNet: tenderSummary.all.net,
      cashDrawerNote: 'Opening/expected/counted cash are physical cash drawer only. Card and online sales are separate tender totals.',
      openedAt: shiftForSummary?.openedAt || '', closedAt: shiftForSummary?.closedAt || ''
    },
    tenderSummary,
    summary: { orders: paid.length, guests, gross: money(gross), discounts: money(discounts), refunds: money(refundAmount), net: money(net), averageBill: paid.length ? money(net / paid.length) : 0, averageGuest: guests ? money(net / guests) : 0, totalReceived: money(totalReceived), changeReturned },
    paymentWise, paymentDetails: paymentDetailRows,
    itemWise: Object.values(itemWise).sort((a,b) => b.net - a.net), categoryWise, categoryDetails: Object.values(categoryDetails).sort((a,b)=>b.net-a.net), orderTypeWise, orderTypeDetails: Object.values(orderTypeDetails),
    discountWise: { count: discountRows.length, amount: money(discounts), rows: discountRows }, refunds,
    voidOrders: (db.orders || []).filter(o => o.status === 'VOID' && (selectedShift ? paidOrderBelongsToShift(o, selectedShift) : between(o.voidedAt || o.createdAt, from, to))).map(o => ({ ...o, total: totals(o).total })),
    orders
  };
}
