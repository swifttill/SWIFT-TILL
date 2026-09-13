require('dotenv').config();
const { hashPassword } = require('../auth/src');
const { getPrisma, hasDatabaseUrl } = require('./src/client');

const PERMISSIONS = [
  'pos.view','pos.create','pos.edit','pos.hold','pos.pay','pos.void','pos.refund','pos.transfer_table','pos.payment_correction',
  'reports.view','reports.export','admin.menu','admin.tables','admin.staff','admin.users','admin.roles','admin.settings','admin.payments','admin.printer','admin.branding'
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
  const user = await db.user.upsert({
    where: { email },
    update: { name, branchId, passwordHash: hashPassword(password), pinHash: pin ? hashPassword(pin) : null, active: true },
    create: { id, branchId, name, email, passwordHash: hashPassword(password), pinHash: pin ? hashPassword(pin) : null, active: true }
  });
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
    where: { id: 'org_swifttill_demo' },
    update: { name: 'SwiftTill Demo Restaurant', legalName: 'SwiftTill Demo Restaurant', phone: '03XX-XXXXXXX', address: 'Rawalpindi, Pakistan', city: 'Rawalpindi', country: 'Pakistan', currency: 'PKR' },
    create: { id: 'org_swifttill_demo', name: 'SwiftTill Demo Restaurant', legalName: 'SwiftTill Demo Restaurant', phone: '03XX-XXXXXXX', address: 'Rawalpindi, Pakistan', city: 'Rawalpindi', country: 'Pakistan', currency: 'PKR' }
  });

  const branch = await db.branch.upsert({
    where: { id: 'br_main' },
    update: { organizationId: org.id, name: 'Main Branch', code: 'MAIN', address: 'Rawalpindi, Pakistan', active: true },
    create: { id: 'br_main', organizationId: org.id, name: 'Main Branch', code: 'MAIN', address: 'Rawalpindi, Pakistan', active: true }
  });

  await upsertPermissions(db);
  const admin = await db.role.upsert({ where: { name: 'Admin' }, update: { description: 'Full system control', system: true, active: true }, create: { name: 'Admin', description: 'Full system control', system: true, active: true } });
  const manager = await db.role.upsert({ where: { name: 'Manager' }, update: { description: 'Operations, reports and approvals', system: true, active: true }, create: { name: 'Manager', description: 'Operations, reports and approvals', system: true, active: true } });
  const cashier = await db.role.upsert({ where: { name: 'Cashier' }, update: { description: 'Billing counter access', system: true, active: true }, create: { name: 'Cashier', description: 'Billing counter access', system: true, active: true } });
  await setRolePermissions(db, admin, PERMISSIONS);
  await setRolePermissions(db, manager, MANAGER_PERMS);
  await setRolePermissions(db, cashier, CASHIER_PERMS);

  await upsertUser(db, { id: 'usr_admin', branchId: branch.id, name: 'Admin', email: 'admin@swifttill.local', password: 'admin123', roleId: admin.id, pin: '1234' });
  await upsertUser(db, { id: 'usr_manager', branchId: branch.id, name: 'Manager', email: 'manager@swifttill.local', password: 'manager123', roleId: manager.id, pin: '2222' });
  await upsertUser(db, { id: 'usr_cashier', branchId: branch.id, name: 'Cashier', email: 'cashier@swifttill.local', password: 'cashier123', roleId: cashier.id, pin: '1111' });

  const cats = [
    ['cat_burgers','Burgers',1], ['cat_pizza','Pizza',2], ['cat_sides','Sides',3], ['cat_drinks','Drinks',4], ['cat_desserts','Desserts',5]
  ];
  for (const [id, name, sort] of cats) {
    await db.category.upsert({ where: { id }, update: { branchId: branch.id, name, sort, active: true }, create: { id, branchId: branch.id, name, sort, active: true } });
  }

  const items = [
    ['itm_zinger','Zinger Burger','cat_burgers',650,1,[['Cheese',100],['Extra Patty',220],['Extra Sauce',60]]],
    ['itm_beef','Beef Burger','cat_burgers',750,2,[['Cheese',100],['Extra Patty',260]]],
    ['itm_pizza','Pizza Slice','cat_pizza',450,3,[['Extra Cheese',120]]],
    ['itm_fries','Fries','cat_sides',300,4,[['Mayo Dip',50],['Garlic Dip',70]]],
    ['itm_loaded','Loaded Fries','cat_sides',550,5,[['Extra Cheese',120]]],
    ['itm_coke','Coke','cat_drinks',180,6,[]],
    ['itm_cupcake','Cup Cake','cat_desserts',280,7,[]]
  ];
  for (const [id, name, categoryId, price, sort, modifiers] of items) {
    await db.menuItem.upsert({
      where: { id },
      update: { branchId: branch.id, categoryId, name, price, sort, active: true, soldOut: false },
      create: { id, branchId: branch.id, categoryId, name, price, sort, active: true, soldOut: false }
    });
    for (const [modName, modPrice] of modifiers) {
      const existing = await db.modifier.findFirst({ where: { itemId: id, name: modName } });
      if (existing) await db.modifier.update({ where: { id: existing.id }, data: { price: modPrice, active: true } });
      else await db.modifier.create({ data: { itemId: id, name: modName, price: modPrice, active: true } });
    }
  }

  const deals = [
    ['deal_family','Family Deal','2 Burgers + Fries + 2 Drinks',2100,1,[['itm_zinger',2],['itm_fries',1],['itm_coke',2]]],
    ['deal_lunch','Lunch Combo','Burger + Fries + Drink',950,2,[['itm_zinger',1],['itm_fries',1],['itm_coke',1]]]
  ];
  for (const [id, name, description, price, sort, dealItems] of deals) {
    await db.deal.upsert({ where: { id }, update: { branchId: branch.id, name, description, price, sort, active: true }, create: { id, branchId: branch.id, name, description, price, sort, active: true } });
    await db.dealItem.deleteMany({ where: { dealId: id } });
    for (const [itemId, qty] of dealItems) await db.dealItem.create({ data: { dealId: id, itemId, qty } });
  }

  for (let i = 1; i <= 12; i++) {
    await db.diningTable.upsert({
      where: { id: `tbl_${i}` },
      update: { branchId: branch.id, name: `T${i}`, seats: i < 3 ? 2 : i < 9 ? 4 : 6, floor: 'Ground Floor', sort: i, active: true },
      create: { id: `tbl_${i}`, branchId: branch.id, name: `T${i}`, seats: i < 3 ? 2 : i < 9 ? 4 : 6, floor: 'Ground Floor', sort: i, active: true }
    });
  }

  for (const [id, name] of [['tak_ali','Ali Ahmed'], ['tak_sara','Sara Khan'], ['tak_bilal','Bilal Hassan']]) {
    await db.orderTaker.upsert({ where: { id }, update: { branchId: branch.id, name, active: true }, create: { id, branchId: branch.id, name, active: true } });
  }

  await db.receiptSettings.upsert({
    where: { branchId: branch.id },
    update: { width: '80mm', copies: 1, showLogo: true, headerText: 'Fresh food, fast billing', footerText: 'Thank you. Visit again.' },
    create: { branchId: branch.id, width: '80mm', copies: 1, showLogo: true, headerText: 'Fresh food, fast billing', footerText: 'Thank you. Visit again.' }
  });

  console.log('SwiftTill PostgreSQL seed complete. Demo branch, users, roles, permissions, menu, deals, tables, order takers and receipt settings are ready.');
}

main().catch(e => { console.error(e); process.exit(1); });
