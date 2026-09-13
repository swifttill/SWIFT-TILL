const { hashPassword, verifyPassword, createSession, verifyToken } = require('./src');
const hash = hashPassword('admin123');
if (!verifyPassword('admin123', hash)) throw new Error('password verification failed');
const token = createSession({ id: 'usr_admin', email: 'admin@swifttill.local', name: 'Admin' }, ['pos.view']);
if (!verifyToken(token)?.sub) throw new Error('token verification failed');
console.log('auth smoke ok');
