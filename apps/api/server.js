require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');
const { hasR2Config, makeMediaKey, makeBackupKey, publicUrlForKey, keyFromPublicUrl, assertImage, uploadImageToR2, putJsonToR2, deleteObjectFromR2 } = require('../../packages/storage/src/r2');
const { databaseHealth, hasDatabaseUrl, getPrisma } = require('../../packages/db/src/client');

const ROOT = path.resolve(__dirname, '../..');
const PUBLIC_DIR = path.join(ROOT, 'apps', 'web', 'public');
const DATA_DIR = path.join(ROOT, 'data');
const STORAGE_DIR = path.join(ROOT, 'storage', 'uploads');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const PORT = Number(process.env.PORT || 5174);
const TOKENS = new Map();
const APP_VERSION = '23.0.0-professional-pos-reports';
const CLOUD_STATE_KEY = process.env.SWIFTTILL_STATE_KEY || 'swift-till-main';
let cloudStateCache = null;
let cloudStateInitPromise = null;

const PERMISSIONS = [
  'pos.view','pos.create','pos.edit','pos.hold','pos.pay','pos.void','pos.refund','pos.transfer_table','pos.payment_correction',
  'reports.view','reports.export','admin.menu','admin.tables','admin.staff','admin.users','admin.roles','admin.settings','admin.payments','admin.printer','admin.branding','cloud.sync','backup.manage'
];
const CASHIER_PERMS = ['pos.view','pos.create','pos.edit','pos.hold','pos.pay'];
const MANAGER_PERMS = [...CASHIER_PERMS,'reports.view','reports.export','pos.void','pos.refund','pos.transfer_table','pos.payment_correction','admin.menu','admin.tables','admin.staff','admin.payments','admin.printer'];

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
function isHistoricalMediaReference(db, value) {
  const v = String(value || '');
  if (!v) return false;
  // Images are not needed for reports, but keep protection if a future paid receipt starts using them.
  return (db.orders || []).some(o => o.status === 'PAID' && (o.lines || []).some(l => l.imageUrl === v));
}
async function cleanupMediaReference(db, value, reason = 'MEDIA_CLEANUP') {
  const v = String(value || '').trim();
  if (!v) return { ok: true, skipped: true };
  if (publicMediaValues(db).has(v)) return { ok: true, skipped: true, reason: 'still-in-use' };
  if (isHistoricalMediaReference(db, v)) return { ok: true, skipped: true, reason: 'historical-paid-order-reference' };
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
  const defaultAdmin = (db?.users || []).some(u => u.email === 'admin@swifttill.local' && u.password === 'admin123' && u.active);
  if (defaultAdmin) missing.push('changeDefaultAdminPassword');
  return { complete: missing.length === 0, missing, defaultAdminPasswordActive: defaultAdmin, readyForRushHour: missing.length === 0, checklist: { businessProfile: !missing.includes('businessName') && !missing.includes('branchName'), menuPriced: !missing.includes('pricedMenuItems'), categories: !missing.includes('categories'), tables: !missing.includes('tables'), orderTakers: !missing.includes('orderTakers'), passwordChanged: !missing.includes('changeDefaultAdminPassword') } };
}
function printAgentStatus(db) {
  const url = db?.settings?.localAgentUrl || 'http://127.0.0.1:9721/print';
  return { configured: !!url, localAgentUrl: url, mode: db?.settings?.printMode || 'cloud-app-with-local-print-agent', note: 'Browser calls local agent from client PC. Render cannot directly verify a restaurant PC printer.' };
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
  db.backups.unshift(rec);
  const daily = db.backups.filter(b => b.type === 'daily').slice(0, 30);
  const monthly = db.backups.filter(b => b.type === 'monthly').slice(0, 12);
  const manual = db.backups.filter(b => b.type === 'manual').slice(0, 20);
  db.backups = [...manual, ...daily, ...monthly].sort((a,b) => new Date(b.exportedAt)-new Date(a.exportedAt));
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
  if (db.meta.lastBackupDate === today) return;
  db.meta.lastBackupDate = today;
  createBackupSnapshot(db, null, 'daily').catch(e => console.error('Daily backup failed:', e.message));
  if (db.meta.lastMonthlyBackup !== monthKey()) {
    db.meta.lastMonthlyBackup = monthKey();
    createBackupSnapshot(db, null, 'monthly').catch(e => console.error('Monthly backup failed:', e.message));
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
      businessName: '', legalName: '', branchName: '', branchCode: '', phone: '', email: '', website: '', address: '', city: '', country: 'Pakistan', currency: 'PKR', logoUrl: '',
      taxEnabled: false, taxPercent: 0, serviceChargeEnabled: false, serviceChargePercent: 0, defaultDeliveryFee: 0,
      autoPrintReceipt: true, rememberPrintChoice: true, receiptWidth: '80mm', receiptCopies: 1, receiptHeader: '', receiptFooter: '', showLogoOnReceipt: true, showCustomerOnReceipt: true, showOrderTakerOnReceipt: true, showCashierOnReceipt: true, showPaymentBreakdown: true, showReprintLabel: true,
      reportTitle: 'Sales Report', reportFooter: '', reportShowBranding: true, reportPaper: 'A4',
      managerPin: '1234', printerName: '', onlineOnly: true, printMode: 'cloud-app-with-local-print-agent', localAgentUrl: 'http://127.0.0.1:9721/print', appWindowMode: 'pwa-or-edge-app-window',
      r2Mode: 'cloudflare-r2', r2BucketName: process.env.R2_BUCKET_NAME || '', r2PublicUrl: process.env.R2_PUBLIC_URL || '', cloudApiUrl: '', backupTarget: 'cloud-database-r2'
    },
    roles: [
      { id: 'role_admin', name: 'Admin', description: 'Full system control', permissions: PERMISSIONS, system: true, active: true },
      { id: 'role_manager', name: 'Manager', description: 'Operations, reports, menu and approvals', permissions: MANAGER_PERMS, system: true, active: true },
      { id: 'role_cashier', name: 'Cashier', description: 'Billing counter access', permissions: CASHIER_PERMS, system: true, active: true }
    ],
    users: [
      { id: 'usr_admin', name: 'Admin', email: 'admin@swifttill.local', password: 'admin123', roleIds: ['role_admin'], pin: '1234', active: true }
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
    customers: [], orders: [], shifts: [], refunds: [], auditLogs: [], backups: [], mediaTrash: [], counters: { bill: 1000, z: 0 }
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
      await prisma.$executeRawUnsafe('INSERT INTO swifttill_app_state (key, value, updated_at) VALUES ($1, $2::jsonb, NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()', CLOUD_STATE_KEY, JSON.stringify(db));
    }
    migrateDb(db);
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
  return db;
}
async function saveDb(db) {
  if (shouldUseCloudState()) {
    cloudStateCache = db;
    const prisma = await getPrisma();
    await prisma.$executeRawUnsafe('INSERT INTO swifttill_app_state (key, value, updated_at) VALUES ($1, $2::jsonb, NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()', CLOUD_STATE_KEY, JSON.stringify(db));
    maybeCreateDailyBackup(db).catch(e => console.error('Auto backup check failed:', e.message));
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
  if (!db.counters) db.counters = { bill: 1000, z: 0 };
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
  const clean = (Array.isArray(payments) ? payments : []).map(p => ({ method: String(p.method || ''), amount: money(p.amount || 0), received: money(p.received ?? p.amount ?? 0), change: money(p.change || 0), reference: p.reference || '' })).filter(p => p.amount > 0 || p.received > 0);
  if (!clean.length) throw Object.assign(new Error('Payment is required'), { status: 422 });
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
function migrateDb(db) {
  const seed = seedDb();
  removeLegacyHardcodedData(db);
  for (const k of ['settings','paymentMethods','orders','shifts','refunds','auditLogs','backups','mediaTrash','counters','customers']) if (db[k] === undefined) db[k] = seed[k];
  if (!Array.isArray(db.roles)) db.roles = seed.roles;
  if (db.meta) { db.meta.version = APP_VERSION; db.meta.storage = shouldUseCloudState() ? 'postgresql-cloud-state' : 'local-json'; }
  for (const [k,v] of Object.entries(seed.settings)) if (db.settings[k] === undefined) db.settings[k] = v;
  for (const pm of seed.paymentMethods) if (!db.paymentMethods.find(x => x.id === pm.id)) db.paymentMethods.push(pm);
  if (Array.isArray(db.users)) db.users.forEach(u => { if (!Array.isArray(u.roleIds)) u.roleIds = u.role === 'ADMIN' ? ['role_admin'] : u.role === 'MANAGER' ? ['role_manager'] : ['role_cashier']; });
}
function userPermissions(db, user) { const set = new Set(); for (const rid of user.roleIds || []) { const role = db.roles.find(r => r.id === rid && r.active); if (role) (role.permissions || []).forEach(p => set.add(p)); } return [...set]; }
function hasPerm(db, user, perm) { return userPermissions(db, user).includes(perm); }
function requirePerm(db, user, perm) { if (!hasPerm(db, user, perm)) throw Object.assign(new Error(`Permission required: ${perm}`), { status: 403 }); }
function audit(db, user, action, details = {}) { db.auditLogs.unshift({ id: uid('aud'), action, userId: user?.id || 'system', userName: user?.name || 'System', details, createdAt: now() }); db.auditLogs = db.auditLogs.slice(0, 1000); }
function parseBody(req) { return new Promise((resolve, reject) => { let body = ''; req.on('data', c => { body += c; if (body.length > 20 * 1024 * 1024) reject(new Error('Payload too large')); }); req.on('end', () => { if (!body) return resolve({}); try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON body')); } }); }); }
function send(res, status, data, headers = {}) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers }); res.end(JSON.stringify(data, null, 2)); }
function sendText(res, status, text, type = 'text/plain; charset=utf-8', headers = {}) { res.writeHead(status, { 'Content-Type': type, ...headers }); res.end(text); }
function getUserFromReq(req, db) { const h = req.headers.authorization || ''; const token = h.startsWith('Bearer ') ? h.slice(7) : null; const s = token && TOKENS.get(token); return s ? db.users.find(u => u.id === s.userId && u.active) : null; }
function requireAuth(req, db) { const u = getUserFromReq(req, db); if (!u) throw Object.assign(new Error('Unauthorized'), { status: 401 }); return u; }
function requireManager(db, pin) { if (!pin || pin !== db.settings.managerPin) throw Object.assign(new Error('Manager PIN required'), { status: 403 }); }
function totals(order) { const subtotal = money((order.lines || []).reduce((s, l) => s + ((Number(l.price) || 0) + (l.modifiers || []).reduce((a, m) => a + Number(m.price || 0), 0)) * Number(l.qty || 0), 0)); const deliveryFee = money(order.deliveryFee || 0); let discount = 0; if (order.discountType === 'PERCENT') discount = subtotal * Math.max(0, Math.min(100, Number(order.discountValue) || 0)) / 100; if (order.discountType === 'FIXED') discount = Number(order.discountValue) || 0; discount = money(Math.min(Math.max(0, discount), subtotal + deliveryFee)); return { subtotal, deliveryFee, discount, total: money(Math.max(0, subtotal + deliveryFee - discount)) }; }
function orderNumber(db) { db.counters.bill = Number(db.counters.bill || 1000) + 1; return String(db.counters.bill).padStart(6, '0'); }
function activeShift(db) { return db.shifts.find(s => s.status === 'OPEN') || null; }

function positivePrice(v) { return money(v); }
function requirePositivePrice(v, label = 'Price') {
  const n = positivePrice(v);
  if (n <= 0) throw Object.assign(new Error(`${label} must be greater than 0`), { status: 422 });
  return n;
}
function validateAdminRecord(kind, record) {
  if (!record || typeof record !== 'object') throw Object.assign(new Error('Invalid record'), { status: 422 });
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
function tableMap(db) { const open = db.orders.filter(o => ['OPEN','HELD'].includes(o.status) && o.type === 'DINE_IN' && o.tableId && hasBillLines(o)); return db.tables.map(t => { const order = open.find(o => o.tableId === t.id); return { ...t, busy: !!order, orderId: order?.id || null, orderNumber: order?.number || null, occupiedAt: order?.tableOccupiedAt || order?.createdAt || null, guests: order?.guests || 0 }; }); }
function publicUser(db, u) { const permissions = userPermissions(db, u); return { id: u.id, name: u.name, email: u.email, roleIds: u.roleIds || [], roles: (u.roleIds || []).map(id => db.roles.find(r => r.id === id)?.name).filter(Boolean), permissions }; }
function compactState(db, user) { return { user: publicUser(db, user), permissions: userPermissions(db, user), permissionCatalog: PERMISSIONS, settings: db.settings, roles: db.roles, categories: db.categories, items: db.items, deals: db.deals, tables: tableMap(db), orderTakers: db.orderTakers, paymentMethods: db.paymentMethods, users: db.users.map(u => ({ id: u.id, name: u.name, email: u.email, roleIds: u.roleIds || [], pin: u.pin || '', active: u.active })), openOrders: db.orders.filter(o => ['OPEN','HELD'].includes(o.status) && hasBillLines(o)).sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt)), paidOrders: db.orders.filter(o => o.status === 'PAID').slice(-80).reverse(), refunds: db.refunds.slice(-80).reverse(), activeShift: activeShift(db), auditLogs: db.auditLogs.slice(0, 80), backup: backupSummary(db), mediaTrash: (db.mediaTrash || []).slice(0, 50), setup: setupStatus(db), printAgent: printAgentStatus(db) }; }
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
  if (record.system) throw Object.assign(new Error('System record cannot be deleted'), { status: 409 });
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

async function handleApi(req, res, pathname, query) {
  try {
    if (pathname === '/api/health' && req.method === 'GET') return send(res, 200, await runtimeHealth());
    if (pathname === '/api/env-check' && req.method === 'GET') return send(res, 200, { ok: true, environment: { nodeEnv: process.env.NODE_ENV || 'development', databaseUrl: hasDatabaseUrl() ? 'loaded' : 'missing', dataStore: shouldUseCloudState() ? 'postgresql-cloud-state' : 'local-json', r2: hasR2Config() ? 'configured' : 'missing', production: productionMode() }, note: 'Safe status only. No secrets are returned.' });
    const db = await loadDb();
    assertOrderEngineState(db);
    if (pathname === '/api/order-engine/status' && req.method === 'GET') return send(res, 200, { ok: true, version: APP_VERSION, store: shouldUseCloudState() ? 'postgresql-cloud-state' : 'local-json', rules: { oneTableOneActiveDineInOrder: true, paymentChangeCashOnly: true, paidOrdersLocked: true, tableReleasedAfterFullPayment: true, synchronousPersistence: true, hardcodedBusinessData: false, zeroPriceBlocked: true, emptyHoldBlocked: true, unpaidBillPrint: true, printAreaSafe: true, reportsVisible: true, mediaCleanup: true, automaticBackups: true, reportHistoryPreservedAfterItemDelete: true, fastUiNoFullScreenBlock: true, reportsAdminPanelFixed: true, cloudCredentialsHiddenFromClient: true, directPrintAgentDefault: true, softBusyIndicator: true, structuredReports: true, reportSubMenus: true, reportSpecificFilters: true, excelPerReport: true, billStyleReportPrint: true, professionalReports: true, reportTotalsFooters: true, xzCloseoutSections: true, cashDrawerReconciliation: true }, counts: { openOrders: db.orders.filter(o => ['OPEN','HELD'].includes(o.status) && hasBillLines(o)).length, paidOrders: db.orders.filter(o => o.status === 'PAID').length, categories: db.categories.length, items: db.items.length, pricedActiveItems: activePricedItems(db).length, deals: db.deals.length, pricedActiveDeals: activePricedDeals(db).length, tables: db.tables.length } });
    if (pathname === '/api/login' && req.method === 'POST') { const body = await parseBody(req); const user = db.users.find(u => u.email.toLowerCase() === String(body.email || '').toLowerCase() && u.password === body.password && u.active); if (!user) return send(res, 401, { ok: false, error: 'Invalid login' }); const token = crypto.randomBytes(24).toString('hex'); TOKENS.set(token, { userId: user.id, createdAt: Date.now() }); audit(db, user, 'LOGIN', { email: user.email }); await saveDb(db); return send(res, 200, { ok: true, token, user: publicUser(db, user) }); }
    const user = requireAuth(req, db);
    if (pathname === '/api/account/change-password' && req.method === 'POST') { const b = await parseBody(req); const u = db.users.find(x => x.id === user.id); if (!u) throw Object.assign(new Error('User not found'), { status: 404 }); if (!b.currentPassword || b.currentPassword !== u.password) throw Object.assign(new Error('Current password is incorrect'), { status: 403 }); if (!b.newPassword || String(b.newPassword).length < 6) throw Object.assign(new Error('New password must be at least 6 characters'), { status: 422 }); if (b.newPassword === 'admin123' || b.newPassword === 'manager123' || b.newPassword === 'cashier123') throw Object.assign(new Error('Default password is not allowed for production'), { status: 422 }); u.password = String(b.newPassword); audit(db, user, 'PASSWORD_CHANGED', { userId: u.id, email: u.email }); await saveDb(db); return send(res, 200, { ok: true }); }
    if (pathname === '/api/state') return send(res, 200, { ok: true, data: compactState(db, user) });

    if (pathname === '/api/upload-image' && req.method === 'POST') { requirePerm(db, user, 'admin.menu'); const body = await parseBody(req); const match = String(body.dataUrl || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/); if (!match) throw Object.assign(new Error('Invalid image data'), { status: 422 }); const contentType = match[1]; const bytes = Buffer.from(match[2], 'base64'); assertImage({ contentType, bytes }); const ext = contentType.split('/')[1].replace('jpeg', 'jpg').replace('svg+xml', 'svg'); const folder = ['category','item','deal','logo','receipt'].includes(body.folder) ? body.folder : 'uploads'; const fallbackName = `${Date.now()}-${safeName(body.filename || 'image').replace(/\.[a-z0-9]+$/i, '')}.${ext}`; if (hasR2Config()) { const key = makeMediaKey({ tenant: 'swifttill', folder, filename: body.filename || fallbackName }); const uploaded = await uploadImageToR2({ key, body: bytes, contentType }); audit(db, user, 'R2_IMAGE_UPLOADED', { key: uploaded.key, url: uploaded.url, folder }); await saveDb(db); return send(res, 200, { ok: true, storage: 'r2', url: uploaded.url || publicUrlForKey(uploaded.key), key: uploaded.key }); } if (productionMode()) throw Object.assign(new Error('Cloudflare R2 is required for production uploads'), { status: 503 }); ensureDir(path.join(PUBLIC_DIR, 'uploads')); fs.writeFileSync(path.join(PUBLIC_DIR, 'uploads', fallbackName), bytes); audit(db, user, 'LOCAL_IMAGE_UPLOADED_DEV_ONLY', { file: fallbackName, folder }); await saveDb(db); return send(res, 200, { ok: true, storage: 'local-dev', url: `/uploads/${fallbackName}`, key: fallbackName }); }

    if (pathname === '/api/shift/open' && req.method === 'POST') { requirePerm(db, user, 'pos.pay'); const body = await parseBody(req); if (activeShift(db)) throw Object.assign(new Error('A shift is already open'), { status: 409 }); const shift = { id: uid('shf'), number: db.shifts.length + 1, status: 'OPEN', cashierId: user.id, cashierName: user.name, openingCash: money(body.openingCash), openedAt: now() }; db.shifts.push(shift); audit(db, user, 'SHIFT_OPENED', shift); await saveDb(db); return send(res, 200, { ok: true, shift }); }
    if (pathname === '/api/shift/close' && req.method === 'POST') { requirePerm(db, user, 'pos.pay'); const body = await parseBody(req); const shift = activeShift(db); if (!shift) throw Object.assign(new Error('No open shift'), { status: 409 }); const rd = reportData(db, { from: shift.openedAt.slice(0,10), to: now().slice(0,10), shiftId: shift.id }); const cashSales = rd.paymentWise.Cash || 0; shift.status = 'CLOSED'; shift.countedCash = money(body.countedCash); shift.expectedCash = money(Number(shift.openingCash) + cashSales); shift.difference = money(shift.countedCash - shift.expectedCash); shift.closedAt = now(); audit(db, user, 'SHIFT_CLOSED', shift); await saveDb(db); return send(res, 200, { ok: true, shift }); }

    if (pathname === '/api/orders/create' && req.method === 'POST') { requirePerm(db, user, 'pos.create'); const b = await parseBody(req); if (!['DINE_IN','DELIVERY','TAKEAWAY'].includes(b.type)) throw Object.assign(new Error('Invalid order type'), { status: 422 }); if (b.type === 'DINE_IN') { if (!b.tableId) throw Object.assign(new Error('Dine In order requires table selection'), { status: 422 }); const table = db.tables.find(t => t.id === b.tableId && t.active); if (!table) throw Object.assign(new Error('Selected table not found'), { status: 404 }); const busy = db.orders.find(o => ['OPEN','HELD'].includes(o.status) && o.type === 'DINE_IN' && o.tableId === b.tableId && hasBillLines(o)); if (busy) throw Object.assign(new Error('This table already has an active order'), { status: 409 }); } const taker = db.orderTakers.find(t => t.id === b.orderTakerId); const createdAt = now(); const order = { id: uid('ord'), number: orderNumber(db), type: b.type, status: 'OPEN', tableId: b.type === 'DINE_IN' ? b.tableId : null, guests: b.type === 'DINE_IN' ? Number(b.guests || 1) : 0, orderTakerId: b.orderTakerId || null, orderTakerName: taker?.name || '', customerName: b.customerName || '', mobile: b.mobile || '', address: b.address || '', deliveryNotes: b.deliveryNotes || '', deliveryFee: b.type === 'DELIVERY' ? money(b.deliveryFee ?? db.settings.defaultDeliveryFee) : 0, lines: [], discountType: 'NONE', discountValue: 0, createdAt, tableOccupiedAt: b.type === 'DINE_IN' ? createdAt : null, cashierId: user.id, cashierName: user.name, timeline: [{ event: 'CREATED', at: createdAt, by: user.name }] }; db.orders.push(order); audit(db, user, 'ORDER_CREATED', { orderId: order.id, number: order.number, type: order.type }); await saveDb(db); return send(res, 200, { ok: true, order }); }
    if (pathname === '/api/orders/save' && req.method === 'POST') { requirePerm(db, user, 'pos.edit'); const b = await parseBody(req); const order = db.orders.find(o => o.id === b.id); if (!order) throw Object.assign(new Error('Order not found'), { status: 404 }); if (order.status === 'PAID') throw Object.assign(new Error('Paid order cannot be edited'), { status: 409 }); const nextType = b.type || order.type; const nextTableId = b.tableId ?? order.tableId; if (nextType === 'DINE_IN' && !nextTableId) throw Object.assign(new Error('Dine In order requires table selection'), { status: 422 }); const oldTable = order.tableId; if (nextType === 'DINE_IN' && nextTableId && nextTableId !== order.tableId) { const table = db.tables.find(t => t.id === nextTableId && t.active); if (!table) throw Object.assign(new Error('Selected table not found'), { status: 404 }); const busy = db.orders.find(o => o.id !== order.id && ['OPEN','HELD'].includes(o.status) && o.type === 'DINE_IN' && o.tableId === nextTableId); if (busy) throw Object.assign(new Error('Target table is busy'), { status: 409 }); } Object.assign(order, { type: nextType, tableId: nextType === 'DINE_IN' ? nextTableId : null, guests: nextType === 'DINE_IN' ? Number((b.guests ?? order.guests) || 1) : 0, orderTakerId: b.orderTakerId ?? order.orderTakerId, orderTakerName: b.orderTakerName ?? order.orderTakerName, customerName: b.customerName ?? order.customerName, mobile: b.mobile ?? order.mobile, address: b.address ?? order.address, deliveryFee: nextType === 'DELIVERY' ? money(b.deliveryFee ?? order.deliveryFee) : 0, lines: Array.isArray(b.lines) ? normalizeOrderLines(b.lines) : normalizeOrderLines(order.lines), discountType: b.discountType || order.discountType, discountValue: money(b.discountValue ?? order.discountValue), updatedAt: now() }); if (order.type === 'DINE_IN' && order.tableId && !order.tableOccupiedAt && hasBillLines(order)) order.tableOccupiedAt = oldTable && oldTable !== order.tableId ? (order.createdAt || now()) : now(); if (oldTable && oldTable !== order.tableId) order.timeline.push({ event: 'TABLE_TRANSFERRED', at: now(), by: user.name, from: oldTable, to: order.tableId }); if (b.hold) { requirePerm(db, user, 'pos.hold'); requireBillLines(order, 'Add at least one item before Hold'); order.status = 'HELD'; order.heldAt = now(); order.timeline.push({ event: 'HELD', at: now(), by: user.name }); } else { requireBillLines(order, 'Add at least one item before saving order'); order.status = 'OPEN'; } audit(db, user, b.hold ? 'ORDER_HELD' : 'ORDER_SAVED', { orderId: order.id, number: order.number }); await saveDb(db); return send(res, 200, { ok: true, order, totals: totals(order) }); }
    if (pathname === '/api/orders/pay' && req.method === 'POST') { requirePerm(db, user, 'pos.pay'); const b = await parseBody(req); const order = db.orders.find(o => o.id === b.id); if (!order) throw Object.assign(new Error('Order not found'), { status: 404 }); if (order.status === 'PAID') throw Object.assign(new Error('Order already paid'), { status: 409 }); if (order.type === 'DINE_IN' && !order.tableId) throw Object.assign(new Error('Dine In order requires table before payment'), { status: 422 }); if (Array.isArray(b.lines)) order.lines = normalizeOrderLines(b.lines); order.discountType = b.discountType || order.discountType; order.discountValue = money(b.discountValue ?? order.discountValue); order.deliveryFee = order.type === 'DELIVERY' ? money(b.deliveryFee ?? order.deliveryFee) : 0; requireBillLines(order, 'Add at least one item before payment'); snapshotOrderForHistory(db, order); const t = totals(order); if (t.total <= 0) throw Object.assign(new Error('Order total must be greater than 0. Check item/deal price.'), { status: 422 }); const payments = validateAndNormalizePayments(b.payments || [], t.total); order.payments = payments; order.status = 'PAID'; order.paidAt = now(); order.tableReleasedAt = now(); order.timeline.push({ event: 'PAID', at: now(), by: user.name, total: t.total }); audit(db, user, 'ORDER_PAID', { orderId: order.id, number: order.number, total: t.total, payments }); await saveDb(db); return send(res, 200, { ok: true, order, totals: t, receipt: buildReceipt(db, order) }); }
    if (pathname === '/api/orders/void' && req.method === 'POST') { requirePerm(db, user, 'pos.void'); const b = await parseBody(req); requireManager(db, b.managerPin); const order = db.orders.find(o => o.id === b.id); if (!order) throw Object.assign(new Error('Order not found'), { status: 404 }); order.status = 'VOID'; order.voidedAt = now(); order.voidReason = b.reason || 'Manager void'; order.timeline.push({ event: 'VOIDED', at: now(), by: user.name, reason: order.voidReason }); audit(db, user, 'ORDER_VOIDED', { orderId: order.id, number: order.number, reason: order.voidReason }); await saveDb(db); return send(res, 200, { ok: true, order }); }
    if (pathname === '/api/orders/refund' && req.method === 'POST') { requirePerm(db, user, 'pos.refund'); const b = await parseBody(req); requireManager(db, b.managerPin); const order = db.orders.find(o => o.id === b.id); if (!order || order.status !== 'PAID') throw Object.assign(new Error('Paid order not found'), { status: 404 }); const amount = money(b.amount || totals(order).total); if (amount <= 0) throw Object.assign(new Error('Invalid refund amount'), { status: 422 }); const refund = { id: uid('ref'), orderId: order.id, orderNumber: order.number, amount, method: b.method || 'Cash', reason: b.reason || 'Refund', createdAt: now(), by: user.name }; db.refunds.push(refund); order.timeline.push({ event: 'REFUNDED', at: now(), by: user.name, amount }); audit(db, user, 'ORDER_REFUNDED', refund); await saveDb(db); return send(res, 200, { ok: true, refund }); }

    if (pathname === '/api/admin/payment-correction' && req.method === 'POST') {
      requirePerm(db, user, 'pos.payment_correction');
      const b = await parseBody(req);
      requireManager(db, b.managerPin);
      const order = db.orders.find(o => o.id === b.id);
      if (!order || order.status !== 'PAID') throw Object.assign(new Error('Paid order not found'), { status: 404 });
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
      if (order.type === 'DINE_IN' && order.tableId) {
        const busy = db.orders.find(o => o.id !== order.id && ['OPEN','HELD'].includes(o.status) && o.type === 'DINE_IN' && o.tableId === order.tableId);
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

    if (pathname.startsWith('/api/admin/') && req.method === 'POST') { const b = await parseBody(req); const action = pathname.split('/').pop(); if (['category','item','deal'].includes(action)) { requirePerm(db, user, 'admin.menu'); return upsertList(res, db, user, action === 'category' ? 'categories' : action === 'item' ? 'items' : 'deals', b, `${action.toUpperCase()}_SAVED`); } if (action === 'payment') { requirePerm(db, user, 'admin.payments'); return upsertList(res, db, user, 'paymentMethods', b, 'PAYMENT_METHOD_SAVED'); } if (action === 'table') { requirePerm(db, user, 'admin.tables'); return upsertList(res, db, user, 'tables', b, 'TABLE_SAVED'); } if (action === 'taker') { requirePerm(db, user, 'admin.staff'); return upsertList(res, db, user, 'orderTakers', b, 'ORDER_TAKER_SAVED'); } if (action === 'user') { requirePerm(db, user, 'admin.users'); if (!Array.isArray(b.roleIds)) b.roleIds = b.roleId ? [b.roleId] : ['role_cashier']; return upsertList(res, db, user, 'users', b, 'USER_SAVED'); } if (action === 'role') { requirePerm(db, user, 'admin.roles'); b.permissions = Array.isArray(b.permissions) ? b.permissions.filter(p => PERMISSIONS.includes(p)) : []; return upsertList(res, db, user, 'roles', b, 'ROLE_SAVED'); } if (action === 'settings') { requirePerm(db, user, 'admin.settings'); const prevLogo = db.settings.logoUrl || ''; const nextSettings = validateAdminRecord('settings', b); db.settings = { ...db.settings, ...nextSettings }; if (prevLogo && nextSettings.logoUrl && prevLogo !== nextSettings.logoUrl) { const cleaned = await cleanupMediaReference(db, prevLogo, 'SETTINGS_OLD_LOGO_DELETED'); db.mediaTrash = Array.isArray(db.mediaTrash) ? db.mediaTrash : []; db.mediaTrash.unshift({ url: prevLogo, action: 'SETTINGS_OLD_LOGO_CLEANUP', cleaned, at: now(), by: user.name }); } audit(db, user, 'SETTINGS_SAVED', Object.keys(b)); await saveDb(db); return send(res, 200, { ok: true, settings: db.settings }); } }

    if (pathname.startsWith('/api/admin/') && req.method === 'DELETE') { const b = await parseBody(req); const action = pathname.split('/').pop(); if (!b.id) throw Object.assign(new Error('Record id is required'), { status: 422 }); if (['category','item','deal'].includes(action)) { requirePerm(db, user, 'admin.menu'); return deleteListRecord(res, db, user, action === 'category' ? 'categories' : action === 'item' ? 'items' : 'deals', b.id, `${action.toUpperCase()}_DELETED`); } if (action === 'payment') { requirePerm(db, user, 'admin.payments'); return deleteListRecord(res, db, user, 'paymentMethods', b.id, 'PAYMENT_METHOD_DELETED'); } if (action === 'table') { requirePerm(db, user, 'admin.tables'); return deleteListRecord(res, db, user, 'tables', b.id, 'TABLE_DELETED'); } if (action === 'taker') { requirePerm(db, user, 'admin.staff'); return deleteListRecord(res, db, user, 'orderTakers', b.id, 'ORDER_TAKER_DELETED'); } if (action === 'user') { requirePerm(db, user, 'admin.users'); return deleteListRecord(res, db, user, 'users', b.id, 'USER_DELETED'); } if (action === 'role') { requirePerm(db, user, 'admin.roles'); return deleteListRecord(res, db, user, 'roles', b.id, 'ROLE_DELETED'); } }

    if (pathname === '/api/print-agent/sample' && req.method === 'GET') { requirePerm(db, user, 'admin.printer'); const sampleOrder = { number: 'TEST', type: 'TEST', status: 'DRAFT', lines: [{ name: 'Print Test Line', qty: 1, price: 1, modifiers: [] }], payments: [], createdAt: now(), cashierName: user.name }; return send(res, 200, { ok: true, receipt: buildReceipt(db, sampleOrder), printAgent: printAgentStatus(db) }); }
    if (pathname === '/api/reports' && req.method === 'GET') { requirePerm(db, user, 'reports.view'); return send(res, 200, { ok: true, data: reportData(db, query) }); }
    if (pathname === '/api/export' && req.method === 'GET') { requirePerm(db, user, 'reports.export'); const rd = reportData(db, query); const type = String(query.type || 'daily'); let rows; if (type === 'itemwise') rows = [['Item','Category','Qty Sold','Gross','Discount Share','Net Sales']].concat(rd.itemWise.map(i => [i.item,i.category,i.qty,i.gross,i.discountShare,i.net])); else if (type === 'category') rows = [['Category','Qty Sold','Gross Sales','Net Sales']].concat(rd.categoryDetails.map(i => [i.category,i.qty,i.gross,i.net])); else if (type === 'payment') rows = [['Payment Mode','Transactions','Received','Change Returned','Net Revenue']].concat(rd.paymentDetails.map(p => [p.method,p.count,p.received,p.change,p.revenue])); else if (type === 'discount') rows = [['Bill No','Date','Order Type','Cashier','Discount Type','Discount Value','Discount Amount','Bill Total']].concat((rd.discountWise.rows||[]).map(o => [o.number,o.date,o.type,o.cashier,o.discountType,o.discountValue,o.discount,o.total])); else if (type === 'voidrefund') rows = [['Type','Bill','Date','Method/Status','Amount','Reason','By']].concat((rd.refunds||[]).map(r => ['REFUND',r.orderNumber,r.createdAt,r.method,r.amount,r.reason,r.by])).concat((rd.voidOrders||[]).map(o => ['VOID',o.number,o.voidedAt||o.createdAt,o.status,totals(o).total,o.voidReason,o.cashierName])); else if (type === 'ordertype') rows = [['Order Type','Orders','Guests','Gross','Discount','Net','Average Bill']].concat(rd.orderTypeDetails.map(o => [o.type,o.orders,o.guests,o.gross,o.discount,o.net,o.orders?money(o.net/o.orders):0])); else if (type === 'x' || type === 'z') rows = [['Section','Value'],['Report',type.toUpperCase()],['Shift No',rd.shiftSummary.shiftNumber],['Shift Status',rd.shiftSummary.shiftStatus],['Opening Cash',rd.shiftSummary.openingCash],['Cash Sales',rd.shiftSummary.cashSales],['Cash Refunds',rd.shiftSummary.cashRefunds],['Expected Cash',rd.shiftSummary.expectedCash],['Counted Cash',rd.shiftSummary.countedCash ?? ''],['Difference',rd.shiftSummary.difference ?? ''],['Orders',rd.summary.orders],['Gross Sales',rd.summary.gross],['Discounts',rd.summary.discounts],['Refunds',rd.summary.refunds],['Net Sales',rd.summary.net],[],['Payment Mode','Transactions','Received','Change','Revenue']].concat(rd.paymentDetails.map(p=>[p.method,p.count,p.received,p.change,p.revenue])); else rows = [['Bill No','Date','Order Type','Table','Guests','Customer','Mobile','Order Taker','Cashier','Subtotal','Discount','Delivery Fee','Total','Payments']].concat(rd.orders.map(o => [o.number,o.date,o.type,o.table,o.guests,o.customer,o.mobile,o.orderTaker,o.cashier,o.subtotal,o.discount,o.deliveryFee,o.total,o.payments])); const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(',')).join('\n'); return sendText(res, 200, csv, 'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="swifttill-${type}-report-${Date.now()}.csv"` }); }
    if (pathname === '/api/backup/status' && req.method === 'GET') { requirePerm(db, user, 'backup.manage'); return send(res, 200, { ok: true, backup: backupSummary(db) }); }
    if (pathname === '/api/backup/create' && req.method === 'POST') { requirePerm(db, user, 'backup.manage'); const b = await parseBody(req); const rec = await createBackupSnapshot(db, user, b.type || 'manual'); await saveDb(db); return send(res, 200, { ok: true, backup: rec, summary: backupSummary(db) }); }
    if (pathname === '/api/backup/download' && req.method === 'GET') { requirePerm(db, user, 'backup.manage'); const rec = await createBackupSnapshot(db, user, 'manual'); await saveDb(db); return sendText(res, 200, JSON.stringify({ exportedAt: now(), app: 'SwiftTill POS', backup: rec, db }, null, 2), 'application/json; charset=utf-8', { 'Content-Disposition': `attachment; filename="swifttill-backup-${Date.now()}.json"` }); }
    if (pathname === '/api/backup/restore' && req.method === 'POST') { requirePerm(db, user, 'backup.manage'); const b = await parseBody(req); const next = b.db || b; if (!next.settings || !Array.isArray(next.orders) || !Array.isArray(next.items)) throw Object.assign(new Error('Invalid backup'), { status: 422 }); audit(next, user, 'BACKUP_RESTORED', { at: now() }); await saveDb(next); return send(res, 200, { ok: true }); }
    send(res, 404, { ok: false, error: 'API not found' });
  } catch (err) { send(res, err.status || 500, { ok: false, error: err.message || 'Server error' }); }
}
function staticServe(req, res, pathname) { let filePath = pathname === '/' ? path.join(PUBLIC_DIR, 'index.html') : path.join(PUBLIC_DIR, decodeURIComponent(pathname)); if (!filePath.startsWith(PUBLIC_DIR)) return sendText(res, 403, 'Forbidden'); if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) filePath = path.join(PUBLIC_DIR, 'index.html'); const ext = path.extname(filePath).toLowerCase(); const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'application/javascript; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.webmanifest':'application/manifest+json' }; const noStore = ['.html','.js','.css','.webmanifest'].includes(ext); res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': noStore ? 'no-store, max-age=0' : 'public, max-age=3600' }); fs.createReadStream(filePath).pipe(res); }
const server = http.createServer(async (req, res) => { const parsed = url.parse(req.url, true); if (parsed.pathname.startsWith('/api/')) return handleApi(req, res, parsed.pathname, parsed.query); staticServe(req, res, parsed.pathname); });
server.listen(PORT, async () => { ensureDir(path.join(PUBLIC_DIR, 'uploads')); ensureDir(STORAGE_DIR); try { await loadDb(); } catch (e) { console.error('Startup data store check failed:', e.message); if (productionMode()) process.exitCode = 1; } console.log(`SwiftTill POS running: http://localhost:${PORT}`); console.log(`Runtime env: DATABASE_URL=${hasDatabaseUrl() ? 'loaded' : 'missing'}, DATA_STORE=${shouldUseCloudState() ? 'postgresql-cloud-state' : 'local-json'}, R2=${hasR2Config() ? 'configured' : 'missing'}`); console.log('Login: admin@swifttill.local / admin123'); });


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
      const cat = db.categories.find(c => c.id === l.categoryId)?.name || l.categoryName || (l.kind === 'DEAL' ? 'Deals' : 'Uncategorized');
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
  return { range: { from, to }, filters, shiftSummary: { shiftId: shiftForSummary?.id || '', shiftNumber: shiftForSummary?.number || '', shiftStatus: shiftForSummary?.status || '', openingCash: money(openingCashForSummary), cashSales: money(cashSalesForSummary), cashRefunds: money(refunds.filter(r => String(r.method||'Cash')==='Cash').reduce((s,r)=>s+Number(r.amount||0),0)), expectedCash: expectedCashForSummary, countedCash: shiftForSummary?.countedCash ?? null, difference: shiftForSummary?.difference ?? null, openedAt: shiftForSummary?.openedAt || '', closedAt: shiftForSummary?.closedAt || '' }, summary: { orders: paid.length, guests, gross: money(gross), discounts: money(discounts), refunds: money(refundAmount), net: money(net), averageBill: paid.length ? money(net / paid.length) : 0, averageGuest: guests ? money(net / guests) : 0, totalReceived: money(totalReceived), changeReturned }, paymentWise, paymentDetails: Object.values(paymentDetails), itemWise: Object.values(itemWise).sort((a,b) => b.net - a.net), categoryWise, categoryDetails: Object.values(categoryDetails).sort((a,b)=>b.net-a.net), orderTypeWise, orderTypeDetails: Object.values(orderTypeDetails), discountWise: { count: discountRows.length, amount: money(discounts), rows: discountRows }, refunds, voidOrders: db.orders.filter(o => o.status === 'VOID' && between(o.voidedAt || o.createdAt, from, to)), orders };
}
