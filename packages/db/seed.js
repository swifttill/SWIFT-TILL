require('dotenv').config();
const { hashPassword } = require('../auth/src');
const { getPrisma, hasDatabaseUrl } = require('./src/client');

const PERMISSIONS = [
  'pos.view','pos.create','pos.edit','pos.hold','pos.pay','pos.void','pos.refund','pos.transfer_table','pos.payment_correction',
  'reports.view','reports.export','admin.menu','admin.tables','admin.staff','admin.users','admin.roles','admin.settings','admin.payments','admin.printer','admin.branding'
];

async function main() {
  if (!hasDatabaseUrl()) {
    console.log('DATABASE_URL not set. Seed skipped for local JSON fallback.');
    return;
  }
  const db = await getPrisma();
  const org = await db.organization.upsert({
    where: { id: 'org_swifttill_demo' },
    update: {},
    create: { id: 'org_swifttill_demo', name: 'SwiftTill Demo Restaurant', legalName: 'SwiftTill Demo Restaurant', phone: '03XX-XXXXXXX', address: 'Rawalpindi, Pakistan', city: 'Rawalpindi', country: 'Pakistan', currency: 'PKR' }
  });
  const branch = await db.branch.upsert({
    where: { id: 'br_main' },
    update: {},
    create: { id: 'br_main', organizationId: org.id, name: 'Main Branch', code: 'MAIN', address: 'Rawalpindi, Pakistan' }
  });
  for (const key of PERMISSIONS) {
    await db.permission.upsert({ where: { key }, update: {}, create: { key, label: key.replace(/\./g, ' ').replace(/_/g, ' '), group: key.split('.')[0] } });
  }
  const admin = await db.role.upsert({ where: { name: 'Admin' }, update: {}, create: { name: 'Admin', description: 'Full system control', system: true } });
  const manager = await db.role.upsert({ where: { name: 'Manager' }, update: {}, create: { name: 'Manager', description: 'Operations and reports', system: true } });
  const cashier = await db.role.upsert({ where: { name: 'Cashier' }, update: {}, create: { name: 'Cashier', description: 'Billing counter access', system: true } });
  const perms = await db.permission.findMany();
  for (const p of perms) await db.rolePermission.upsert({ where: { roleId_permissionId: { roleId: admin.id, permissionId: p.id } }, update: {}, create: { roleId: admin.id, permissionId: p.id } });
  const managerKeys = PERMISSIONS.filter(k => !k.includes('admin.users') && !k.includes('admin.roles') && !k.includes('backup'));
  const cashierKeys = ['pos.view','pos.create','pos.edit','pos.hold','pos.pay'];
  for (const keySet of [[manager, managerKeys], [cashier, cashierKeys]]) {
    const [role, keys] = keySet;
    for (const p of perms.filter(x => keys.includes(x.key))) await db.rolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId: p.id } }, update: {}, create: { roleId: role.id, permissionId: p.id } });
  }
  const users = [
    ['usr_admin','Admin','admin@swifttill.local','admin123',admin.id],
    ['usr_manager','Manager','manager@swifttill.local','manager123',manager.id],
    ['usr_cashier','Cashier','cashier@swifttill.local','cashier123',cashier.id]
  ];
  for (const [id,name,email,password,roleId] of users) {
    await db.user.upsert({ where: { email }, update: { passwordHash: hashPassword(password), active: true }, create: { id, branchId: branch.id, name, email, passwordHash: hashPassword(password), active: true, roles: { create: { roleId } } } });
  }
  console.log('SwiftTill PostgreSQL seed complete.');
}

main().catch(e => { console.error(e); process.exit(1); });
