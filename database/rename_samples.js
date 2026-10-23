// npm run rename-samples -> gives EXISTING sample accounts the names/e-mails from database/sampleUsers.js.
// Keeps passwords, enrollments, assignments and clearances (matched by employee_id). Only rows flagged is_sample are touched.
require('dotenv').config();
const mysql = require('mysql2/promise');
const E = require('../lib/emailGen');
const { people } = require('./sampleUsers');

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME || 'teamrene_clearance',
  });
  let changed = 0;
  for (const x of people().filter((p) => p.employee_id)) {
    const email = E.suggest('staff', { given_name: x.given, family_name: x.family }).email;
    try {
      const [r] = await conn.query("UPDATE users SET given_name = ?, middle_name = NULL, family_name = ?, email = ?, email_status = 'unverified' WHERE employee_id = ? AND is_sample = 1", [x.given, x.family, email, x.employee_id]);
      if (r.affectedRows) { changed++; console.log('  ' + x.employee_id.padEnd(9) + (x.given + ' ' + x.family).padEnd(24) + email); }
      else console.log('  ' + x.employee_id.padEnd(9) + '(no sample user with this employee ID, skipped)');
    } catch (e) { console.log('  ' + x.employee_id + ' FAILED: ' + (e.code || e.message)); }
  }
  console.log(changed + ' sample account(s) renamed. Passwords are unchanged.');
  await conn.end();
})().catch((e) => { console.error('Rename failed:', e.code || e.message || e); process.exit(1); });
