const fs = require('fs');
const path = require('path');
const db = path.resolve(__dirname, '..', 'data', 'db.json');
if (fs.existsSync(db)) fs.unlinkSync(db);
console.log('SwiftTill local database reset. It will seed again on next start.');
