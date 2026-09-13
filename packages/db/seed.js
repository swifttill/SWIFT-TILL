require('dotenv').config();
const { hashPassword } = require('../auth/src');
const { getPrisma, hasDatabaseUrl } = require('./src/client');

const PERMISSIONS = [
  'pos.view','pos.create','pos.edit','pos.hold','pos.pay','pos.void','pos.refund','pos.transfer_table','pos.payment_correction',
  'reports.view','reports.export','admin.menu','admin.tables','admin.staff','admin.users','admin.roles','admin.settings','admin.payments','admin.printer','admin.branding','cloud.sync','backup.manage'
];
const CASHIER_PERMS = ['pos.view','pos.create','pos.edit','pos.hold','pos.pay'];
const MANAGER_PERMS = [...CASHIER_PERMS,'reports.view','reports.export','pos.void','pos.refund','pos.transfer_table','pos.payment_correction','admin.menu','admin.tables','admin.staff','admin.payments','admin.printer'];

async function upsertPermissions(db) {
  for (const key of PERMISSIONS) {
    await db.permission.upsert({
      where: { key },
      update: { label: key.replace(/\./g, ' ').replace(/_/g, ' '), group: key.split('.')[0] },
      create: { key, label: key.replace(/\./g, ' ').replace(/_/g, ' '), group: key.split('.')[0] }
    });
  }
}

async function setRolePermissions(db, role, keys) {
  const perms = await db.permission.findMany({ where: { key: { in: keys } } });
  for (const p of perms) {
    await db.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: p.id } },
      update: {},
      create: { roleId: role.id, permissionId: p.id }
    });
  }
}

async function upsertUser(db, { id, branchId, name, email, password, roleId, pin }) {
  const existing = await db.user.findUnique({ where: { email } });
  const user = existing
    ? await db.user.update({ where: { email }, data: { name, branchId, active: true } })
    : await db.user.create({ data: { id, branchId, name, email, passwordHash: hashPassword(password), pinHash: pin ? hashPassword(pin) : null, active: true } });
  await db.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId } },
    update: {},
    create: { userId: user.id, roleId }
  });
  return user;
}

async function main() {
  if (!hasDatabaseUrl()) {
    console.log('DATABASE_URL not set. Seed skipped for local JSON fallback.');
    return;
  }

  const db = await getPrisma();

  const org = await db.organization.upsert({
    where: { id: 'org_swifttill' },
    update: { name: 'SwiftTill POS', legalName: '', phone: '', address: '', city: '', country: 'Pakistan', currency: 'PKR' },
    create: { id: 'org_swifttill', name: 'SwiftTill POS', legalName: '', phone: '', address: '', city: '', country: 'Pakistan', currency: 'PKR' }
  });

  const branch = await db.branch.upsert({
    where: { id: 'br_main' },
    update: { organizationId: org.id, name: 'Main Branch', code: 'MAIN', address: '', active: true },
    create: { id: 'br_main', organizationId: org.id, name: 'Main Branch', code: 'MAIN', address: '', active: true }
  });

  await upsertPermissions(db);
  const admin = await db.role.upsert({ where: { name: 'Admin' }, update: { description: 'Full system control', system: true, active: true }, create: { name: 'Admin', description: 'Full system control', system: true, active: true } });
  const manager = await db.role.upsert({ where: { name: 'Manager' }, update: { description: 'Operations, reports and approvals', system: true, active: true }, create: { name: 'Manager', description: 'Operations, reports and approvals', system: true, active: true } });
  const cashier = await db.role.upsert({ where: { name: 'Cashier' }, update: { description: 'Billing counter access', system: true, active: true }, create: { name: 'Cashier', description: 'Billing counter access', system: true, active: true } });
  await setRolePermissions(db, admin, PERMISSIONS);
  await setRolePermissions(db, manager, MANAGER_PERMS);
  await setRolePermissions(db, cashier, CASHIER_PERMS);

  await upsertUser(db, { id: 'usr_admin', branchId: branch.id, name: process.env.ADMIN_SEED_NAME || 'Admin', email: process.env.ADMIN_SEED_EMAIL || 'admin@swifttill.local', password: process.env.ADMIN_SEED_PASSWORD || 'admin123', roleId: admin.id, pin: process.env.ADMIN_SEED_PIN || '1234' });

  // Production seed intentionally does not create menu categories, menu items, deals, tables or order takers.
  // Add all real business data from the Admin panel so Render + Neon + R2 tests are clean.

  await db.receiptSettings.upsert({
    where: { branchId: branch.id },
    update: { width: '80mm', copies: 1, showLogo: true, headerText: '', footerText: '' },
    create: { branchId: branch.id, width: '80mm', copies: 1, showLogo: true, headerText: '', footerText: '' }
  });

  console.log('SwiftTill PostgreSQL seed complete. Bootstrap admin, roles, permissions and empty production setup are ready. Existing user passwords are not reset by seed. Add real menu, tables, order takers and branding from Admin.');
}

main().catch(e => { console.error(e); process.exit(1); });
