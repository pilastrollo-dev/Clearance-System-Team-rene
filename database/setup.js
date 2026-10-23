// npm run setup -> creates the database, tables and SAMPLE data (only when the users table is empty).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const E = require('../lib/emailGen');

const { COLLEGE, people } = require('./sampleUsers');

(async () => {
  const name = process.env.DB_NAME || 'teamrene_clearance';
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '', multipleStatements: true,
  });
  await conn.query('CREATE DATABASE IF NOT EXISTS `' + name + '` CHARACTER SET utf8mb4');
  await conn.query('USE `' + name + '`');
  await conn.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  // Upgrade older databases in place (keeps all data).
  for (const [table, column] of [['users', 'signature_image'], ['signatures', 'signature_image']]) {
    const [has] = await conn.query('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?', [name, table, column]);
    if (!has.length) { await conn.query('ALTER TABLE `' + table + '` ADD COLUMN `' + column + '` MEDIUMTEXT NULL'); console.log('Added column ' + table + '.' + column); }
  }
  console.log('Tables ready in database "' + name + '".');

  const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM users');
  if (n > 0) { console.log('Users already exist; sample data not added.'); return conn.end(); }

  // --- academics (SAMPLE) ---
  await conn.query("INSERT INTO terms (academic_year, semester, is_current) VALUES ('2026-2027','1st Sem',1)");
  await conn.query('INSERT INTO programs (code, name, college) VALUES (?,?,?)', ['BSIT', 'BS Information Technology', COLLEGE]);
  await conn.query("INSERT INTO sections (program_id, year_level, name) VALUES (1,2,'2C'),(1,2,'2D')");
  await conn.query("INSERT INTO subjects (code, title) VALUES ('CCIT 106','Application Development (sample title)'),('IT 201','Data Structures (sample title)'),('MATH 101','Discrete Math (sample title)')");

  // --- offices, purposes, required signatories ---
  const offs = [['ACCT', 'Accountant III / Accounting Office'], ['GUID', 'Guidance Counselor'], ['SAS', 'Director, Student Affairs and Services Office'],
    ['ALUM', 'Alumni Treasurer'], ['CSC', 'CSC Treasurer'], ['LIB', 'Library'], ['LAB', 'Laboratory / Equipment Office'],
    ['REG', 'College Registrar'], ['DEAN', 'Concerned Dean'], ['DEPT', 'Department Head']];
  for (const o of offs) await conn.query('INSERT INTO offices (code, name) VALUES (?,?)', o);
  await conn.query("INSERT INTO clearance_purposes (name, requires_explanation, deadline_days) VALUES ('Graduation',0,30),('Transfer',0,30),('Leave of Absence',0,30),('Others',1,30)");
  const stage = { ACCT: 1, GUID: 1, SAS: 1, ALUM: 1, CSC: 1, LIB: 1, REG: 2, DEAN: 3 };
  const req = { 1: ['ACCT', 'GUID', 'SAS', 'ALUM', 'CSC', 'LIB', 'REG', 'DEAN'], 2: ['ACCT', 'GUID', 'SAS', 'CSC', 'LIB', 'REG', 'DEAN'],
    3: ['ACCT', 'GUID', 'SAS', 'REG', 'DEAN'], 4: ['ACCT', 'GUID', 'SAS', 'REG', 'DEAN'] };
  for (const [pid, codes] of Object.entries(req)) for (const c of codes) await conn.query('INSERT INTO purpose_signatories (purpose_id, office_code, stage) VALUES (?,?,?)', [pid, c, stage[c]]);
  const defaults = { due_hours: 48, remind_every_hours: 24, escalate_after_hours: 24, due_soon_hours: 24, escalate_to_dept_head: 1, qr_valid_days: 90 };
  for (const [k, v] of Object.entries(defaults)) await conn.query('INSERT INTO settings (key_name, value) VALUES (?,?)', [k, String(v)]);

  // --- users (all SAMPLE) ---
  const [secs] = await conn.query('SELECT s.id, CONCAT(p.code, " ", s.year_level, s.name) AS label, s.program_id, s.year_level FROM sections s JOIN programs p ON p.id = s.program_id');
  const bySection = Object.fromEntries(secs.map((s) => [s.label, s]));
  const byKey = {};   // employee_id or student_no -> new user id
  console.log('SAMPLE accounts created (email / password):');
  for (const x of people()) {
    const email = E.suggest(x.role === 'student' ? 'student' : 'staff', { given_name: x.given, family_name: x.family }).email;
    const sec = x.section ? bySection[x.section] : null;
    const [r] = await conn.query(
      'INSERT INTO users (role, given_name, family_name, email, password_hash, student_no, employee_id, department, program_id, section_id, year_level, college, office_code, is_sample) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)',
      [x.role, x.given, x.family, email, await bcrypt.hash(x.password, 10), x.student_no || null, x.employee_id || null, x.dept || null,
        sec ? sec.program_id : null, sec ? sec.id : null, sec ? sec.year_level : null, x.role === 'student' ? COLLEGE : x.college || null, x.office || null]);
    byKey[x.student_no || x.employee_id] = r.insertId;
    console.log('  ' + (x.office || x.role).padEnd(11) + (x.given + ' ' + x.family).padEnd(24) + email.padEnd(40) + x.password);
  }

  // --- enrollment + teaching assignments (SAMPLE): 2C and 2D have different instructors ---
  const s2C = bySection['BSIT 2C'].id, s2D = bySection['BSIT 2D'].id;
  for (const [stu, sec] of [[byKey['2022-0001'], s2C], [byKey['2022-0002'], s2D]]) for (const sub of [1, 2, 3]) await conn.query('INSERT INTO enrollments (student_id, subject_id, section_id, term_id) VALUES (?,?,?,1)', [stu, sub, sec]);
  const assign = [['EMP-1001', 1, s2C], ['EMP-1003', 2, s2C], ['EMP-1002', 3, s2C], ['EMP-1004', 1, s2D], ['EMP-1005', 2, s2D], ['EMP-1006', 3, s2D]];
  for (const [emp, sub, sec] of assign) await conn.query('INSERT INTO teaching_assignments (instructor_id, subject_id, section_id, term_id) VALUES (?,?,?,1)', [byKey[emp], sub, sec]);
  console.log('Sample enrollment: Pia (BSIT 2C) and Analiza (BSIT 2D) have different instructors for the same subjects.');
  await conn.end();
})().catch((e) => { console.error('Setup failed:', e.code || e.message || e); process.exit(1); });
