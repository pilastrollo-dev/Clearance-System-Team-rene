const { db } = require('../db');

const COLS = 'u.id, u.role, u.given_name, u.middle_name, u.family_name, u.email, u.email_status, u.student_no, u.employee_id, u.department, ' +
  'u.program_id, u.section_id, u.year_level, u.college, u.office_code, u.is_active, u.is_sample, u.must_change_password, u.created_at, ' +
  "p.code AS program_code, CONCAT(p.code, ' ', sec.year_level, sec.name) AS section_label";
const FROM = ' FROM users u LEFT JOIN programs p ON p.id = u.program_id LEFT JOIN sections sec ON sec.id = u.section_id ';

async function findByEmailWithHash(email) {
  const [rows] = await db.query(
    'SELECT id, role, given_name, family_name, email, password_hash, must_change_password, college, office_code, is_active FROM users WHERE email = ?', [email]);
  return rows[0];
}
async function hashOf(id) {
  const [rows] = await db.query('SELECT password_hash FROM users WHERE id = ?', [id]);
  return rows[0] ? rows[0].password_hash : null;
}
async function findById(id) {
  const [rows] = await db.query('SELECT ' + COLS + FROM + 'WHERE u.id = ?', [id]);
  return rows[0];
}
async function list({ q = '', role = '' } = {}) {
  let sql = 'SELECT ' + COLS + FROM + 'WHERE 1=1';
  const params = [];
  if (role) { sql += ' AND u.role = ?'; params.push(role); }
  if (q) {
    sql += ' AND (u.given_name LIKE ? OR u.family_name LIKE ? OR u.email LIKE ? OR u.student_no LIKE ? OR u.employee_id LIKE ?)';
    const l = '%' + q + '%'; params.push(l, l, l, l, l);
  }
  const [rows] = await db.query(sql + ' ORDER BY u.created_at DESC, u.id DESC LIMIT 300', params);
  return rows;
}

// Returns a Set of the given e-mails that already exist (used for duplicate suggestions).
async function emailsTaken(emails, exceptId = 0) {
  if (!emails.length) return new Set();
  const [rows] = await db.query('SELECT email FROM users WHERE email IN (?) AND id <> ?', [emails, exceptId]);
  return new Set(rows.map((r) => r.email));
}
async function studentNoTaken(v, exceptId = 0) {
  const [r] = await db.query('SELECT id FROM users WHERE student_no = ? AND id <> ?', [v, exceptId]); return r.length > 0;
}
async function employeeIdTaken(v, exceptId = 0) {
  const [r] = await db.query('SELECT id FROM users WHERE employee_id = ? AND id <> ?', [v, exceptId]); return r.length > 0;
}

const FIELDS = ['role', 'given_name', 'middle_name', 'family_name', 'email', 'student_no', 'employee_id', 'department', 'program_id', 'section_id', 'year_level', 'college', 'office_code'];

async function create(u) {
  const [r] = await db.query(
    'INSERT INTO users (' + FIELDS.join(', ') + ', password_hash, must_change_password) VALUES (' + FIELDS.map(() => '?').join(',') + ',?,?)',
    [...FIELDS.map((f) => u[f]), u.password_hash, u.must_change_password ? 1 : 0]);
  return r.insertId;
}
async function update(id, u) {
  const [r] = await db.query('UPDATE users SET ' + FIELDS.map((f) => f + ' = ?').join(', ') + ' WHERE id = ?', [...FIELDS.map((f) => u[f]), id]);
  return r.affectedRows === 1;
}
async function setPassword(id, hash, mustChange) {
  await db.query('UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?', [hash, mustChange ? 1 : 0, id]);
}
async function setEmailStatus(id, status) {
  await db.query('UPDATE users SET email_status = ? WHERE id = ?', [status, id]);
}
async function setActive(id, active) {
  const [r] = await db.query('UPDATE users SET is_active = ? WHERE id = ?', [active ? 1 : 0, id]); return r.affectedRows === 1;
}
async function setSignature(id, dataUrl) {
  await db.query('UPDATE users SET signature_image = ? WHERE id = ?', [dataUrl, id]);
}
async function signatureOf(id) {
  const [rows] = await db.query('SELECT signature_image FROM users WHERE id = ?', [id]);
  return rows[0] ? rows[0].signature_image : null;
}
async function adminIds() {
  const [rows] = await db.query("SELECT id FROM users WHERE role = 'admin' AND is_active = 1"); return rows.map((r) => r.id);
}
async function listByRole(role) {
  const [rows] = await db.query('SELECT id, given_name, family_name, department FROM users WHERE role = ? AND is_active = 1 ORDER BY family_name, given_name', [role]);
  return rows;
}
async function deptHeadIds(college) {
  const [rows] = await db.query("SELECT id FROM users WHERE role = 'staff' AND office_code = 'DEPT' AND is_active = 1 AND college = ?", [college]);
  return rows.map((r) => r.id);
}

// Who is responsible for this approval?  `a` needs office_code, instructor_id, student_college.
async function recipientsFor(a) {
  if (a.office_code === 'INSTRUCTOR') return a.instructor_id ? [a.instructor_id] : [];
  let sql = "SELECT id FROM users WHERE role = 'staff' AND is_active = 1 AND office_code = ?";
  const params = [a.office_code];
  if (a.office_code === 'DEAN') { sql += ' AND college = ?'; params.push(a.student_college); }
  const [rows] = await db.query(sql, params);
  return rows.map((r) => r.id);
}
async function counts() {
  const [rows] = await db.query('SELECT role, COUNT(*) AS n FROM users WHERE is_active = 1 GROUP BY role');
  return Object.fromEntries(rows.map((r) => [r.role, r.n]));
}

module.exports = { setSignature, signatureOf, findByEmailWithHash, hashOf, findById, list, emailsTaken, studentNoTaken, employeeIdTaken, create, update, setPassword, setEmailStatus, setActive, adminIds, listByRole, deptHeadIds, recipientsFor, counts };
