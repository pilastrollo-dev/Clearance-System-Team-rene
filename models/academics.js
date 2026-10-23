const { db } = require('../db');

let termCache = { at: 0, row: null };

async function currentTerm() {
  if (Date.now() - termCache.at < 30000) return termCache.row;
  const [rows] = await db.query('SELECT id, academic_year, semester FROM terms WHERE is_current = 1 LIMIT 1');
  termCache = { at: Date.now(), row: rows[0] ? { ...rows[0], label: rows[0].semester + ' SY ' + rows[0].academic_year.replace('-', '–') } : null };
  return termCache.row;
}
const termLabel = (t) => t.semester + ' SY ' + String(t.academic_year).replace('-', '–');

async function terms() {
  const [rows] = await db.query('SELECT id, academic_year, semester, is_current FROM terms ORDER BY academic_year DESC, semester');
  return rows.map((t) => ({ ...t, label: termLabel(t) }));
}
async function addTerm(year, sem) { await db.query('INSERT INTO terms (academic_year, semester) VALUES (?,?)', [year, sem]); }
async function setCurrentTerm(id) {
  await db.query('UPDATE terms SET is_current = (id = ?)', [id]); termCache = { at: 0, row: null };
}

async function programs() { const [r] = await db.query('SELECT id, code, name, college FROM programs ORDER BY code'); return r; }
async function addProgram(p) { await db.query('INSERT INTO programs (code, name, college) VALUES (?,?,?)', [p.code, p.name, p.college]); }

async function sections() {
  const [r] = await db.query("SELECT s.id, s.program_id, s.year_level, s.name, CONCAT(p.code, ' ', s.year_level, s.name) AS label FROM sections s JOIN programs p ON p.id = s.program_id ORDER BY p.code, s.year_level, s.name");
  return r;
}
async function addSection(s) { await db.query('INSERT INTO sections (program_id, year_level, name) VALUES (?,?,?)', [s.program_id, s.year_level, s.name]); }

async function subjects() { const [r] = await db.query('SELECT id, code, title FROM subjects ORDER BY code'); return r; }
async function addSubject(s) { await db.query('INSERT INTO subjects (code, title) VALUES (?,?)', [s.code, s.title]); }

async function findSubject(id) { const [r] = await db.query('SELECT id, code, title FROM subjects WHERE id = ?', [id]); return r[0]; }
async function updateSubject(id, s) { const [r] = await db.query('UPDATE subjects SET code = ?, title = ? WHERE id = ?', [s.code, s.title, id]); return r.affectedRows === 1; }
async function subjectUsage(id) {
  const [[r]] = await db.query('SELECT (SELECT COUNT(*) FROM enrollments WHERE subject_id = ?) AS enrollments, (SELECT COUNT(*) FROM teaching_assignments WHERE subject_id = ?) AS assignments, (SELECT COUNT(*) FROM approvals WHERE subject_id = ?) AS approvals', [id, id, id]);
  return r;
}
// Only an unused subject can be deleted (history must stay traceable).
async function deleteSubject(id) {
  const [r] = await db.query('DELETE s FROM subjects s WHERE s.id = ? AND NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.subject_id = s.id) AND NOT EXISTS (SELECT 1 FROM teaching_assignments t WHERE t.subject_id = s.id) AND NOT EXISTS (SELECT 1 FROM approvals a WHERE a.subject_id = s.id)', [id]);
  return r.affectedRows === 1;
}

// ----- bulk import (validation is in lib/importer.js; these only read lookups and write validated rows) -----
async function importContext(termId) {
  const [subs] = await db.query('SELECT id, code FROM subjects');
  const [stus] = await db.query("SELECT id, student_no FROM users WHERE role = 'student' AND student_no IS NOT NULL");
  const [inst] = await db.query("SELECT id, employee_id, email FROM users WHERE role = 'instructor'");
  const [enr] = termId ? await db.query('SELECT student_id, subject_id FROM enrollments WHERE term_id = ?', [termId]) : [[]];
  const [asg] = termId ? await db.query('SELECT instructor_id, subject_id, section_id FROM teaching_assignments WHERE term_id = ?', [termId]) : [[]];
  const instructorsByKey = new Map();
  inst.forEach((i) => { if (i.employee_id) instructorsByKey.set(String(i.employee_id).toLowerCase(), i.id); instructorsByKey.set(String(i.email).toLowerCase(), i.id); });
  return {
    subjectCodes: new Set(subs.map((s) => s.code.toUpperCase())), subjectsByCode: new Map(subs.map((s) => [s.code.toUpperCase(), s.id])),
    studentsByNo: new Map(stus.map((s) => [String(s.student_no).toUpperCase(), s.id])),
    sectionsByKey: new Map((await sections()).map((s) => [s.label.replace(/\s+/g, '').toUpperCase(), s.id])), instructorsByKey,
    enrolledKeys: new Set(enr.map((e) => e.student_id + ':' + e.subject_id)), assignedKeys: new Set(asg.map((a) => a.instructor_id + ':' + a.subject_id + ':' + a.section_id)),
  };
}
async function bulk(sql, rows) {
  const conn = await db.getConnection();
  try { await conn.beginTransaction(); for (const r of rows) await conn.query(sql, r); await conn.commit(); return rows.length; }
  catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}
const importSubjects = (rows) => bulk('INSERT INTO subjects (code, title) VALUES (?,?)', rows.map((r) => [r.code, r.title]));
const importEnrollments = (rows, termId) => bulk('INSERT INTO enrollments (student_id, subject_id, section_id, term_id) VALUES (?,?,?,?)', rows.map((r) => [r.student_id, r.subject_id, r.section_id, termId]));
const importAssignments = (rows, termId) => bulk('INSERT INTO teaching_assignments (instructor_id, subject_id, section_id, term_id) VALUES (?,?,?,?)', rows.map((r) => [r.instructor_id, r.subject_id, r.section_id, termId]));

// ----- enrollment (history is kept: rows are tied to a term and never rewritten) -----
async function enrollmentsFor(studentId, termId) {
  const [r] = await db.query(
    'SELECT e.id, e.subject_id, e.section_id, e.term_id, s.code AS subject_code, s.title, ' +
    "CONCAT(p.code, ' ', sec.year_level, sec.name) AS section_label, " +
    "GROUP_CONCAT(DISTINCT CONCAT(i.given_name, ' ', i.family_name) SEPARATOR ', ') AS instructors " +
    'FROM enrollments e JOIN subjects s ON s.id = e.subject_id JOIN sections sec ON sec.id = e.section_id JOIN programs p ON p.id = sec.program_id ' +
    'LEFT JOIN teaching_assignments t ON t.subject_id = e.subject_id AND t.section_id = e.section_id AND t.term_id = e.term_id ' +
    'LEFT JOIN users i ON i.id = t.instructor_id AND i.is_active = 1 ' +
    'WHERE e.student_id = ? AND e.term_id = ? GROUP BY e.id, e.subject_id, e.section_id, e.term_id, s.code, s.title, p.code, sec.year_level, sec.name ORDER BY s.code',
    [studentId, termId]);
  return r;
}
async function assignmentsForSubjects(termId, subjectIds) {
  if (!subjectIds.length) return [];
  const [r] = await db.query(
    'SELECT t.instructor_id, t.subject_id, t.section_id, t.term_id FROM teaching_assignments t JOIN users u ON u.id = t.instructor_id AND u.is_active = 1 WHERE t.term_id = ? AND t.subject_id IN (?)',
    [termId, subjectIds]);
  return r;
}
async function enroll(studentId, subjectId, sectionId, termId) {
  await db.query('INSERT INTO enrollments (student_id, subject_id, section_id, term_id) VALUES (?,?,?,?)', [studentId, subjectId, sectionId, termId]);
}
async function unenroll(id, studentId) {
  const [r] = await db.query(
    "DELETE e FROM enrollments e WHERE e.id = ? AND e.student_id = ? AND NOT EXISTS (SELECT 1 FROM clearance_requests c WHERE c.student_id = e.student_id AND c.term_id = e.term_id)",
    [id, studentId]);
  return r.affectedRows === 1; // refused once a clearance exists for that term (history must stay traceable)
}

async function assignmentsOf(instructorId, termId) {
  const [r] = await db.query(
    "SELECT t.id, t.subject_id, t.section_id, s.code AS subject_code, s.title, CONCAT(p.code, ' ', sec.year_level, sec.name) AS section_label, sec.year_level, " +
    '(SELECT COUNT(*) FROM enrollments e WHERE e.subject_id = t.subject_id AND e.section_id = t.section_id AND e.term_id = t.term_id) AS students ' +
    'FROM teaching_assignments t JOIN subjects s ON s.id = t.subject_id JOIN sections sec ON sec.id = t.section_id JOIN programs p ON p.id = sec.program_id ' +
    'WHERE t.instructor_id = ? AND t.term_id = ? ORDER BY s.code, sec.name', [instructorId, termId]);
  return r;
}
async function assign(instructorId, subjectId, sectionId, termId) {
  await db.query('INSERT INTO teaching_assignments (instructor_id, subject_id, section_id, term_id) VALUES (?,?,?,?)', [instructorId, subjectId, sectionId, termId]);
}
async function unassign(id, instructorId) {
  const [r] = await db.query(
    'DELETE t FROM teaching_assignments t WHERE t.id = ? AND t.instructor_id = ? AND NOT EXISTS (SELECT 1 FROM approvals a WHERE a.instructor_id = t.instructor_id AND a.subject_id = t.subject_id)',
    [id, instructorId]);
  return r.affectedRows === 1;
}

// Students of an instructor (only through real enrollment) with their latest clearance state.
async function studentsOfInstructor(instructorId, termId, { q = '', subject_id = 0, section_id = 0 } = {}) {
  let sql =
    "SELECT DISTINCT u.id, u.given_name, u.family_name, u.student_no, u.year_level, s.code AS subject_code, CONCAT(p.code, ' ', sec.year_level, sec.name) AS section_label, " +
    "(SELECT r.status FROM clearance_requests r WHERE r.student_id = u.id ORDER BY r.id DESC LIMIT 1) AS clearance_status, " +
    "(SELECT a.status FROM approvals a JOIN clearance_requests r ON r.id = a.request_id WHERE r.student_id = u.id AND r.status = 'in_progress' AND a.instructor_id = t.instructor_id AND a.subject_id = t.subject_id LIMIT 1) AS my_status " +
    'FROM teaching_assignments t JOIN enrollments e ON e.subject_id = t.subject_id AND e.section_id = t.section_id AND e.term_id = t.term_id ' +
    'JOIN users u ON u.id = e.student_id JOIN subjects s ON s.id = t.subject_id JOIN sections sec ON sec.id = t.section_id JOIN programs p ON p.id = sec.program_id ' +
    'WHERE t.instructor_id = ? AND t.term_id = ?';
  const p = [instructorId, termId];
  if (q) { sql += ' AND (u.given_name LIKE ? OR u.family_name LIKE ? OR u.student_no LIKE ?)'; p.push('%' + q + '%', '%' + q + '%', '%' + q + '%'); }
  if (subject_id) { sql += ' AND t.subject_id = ?'; p.push(subject_id); }
  if (section_id) { sql += ' AND t.section_id = ?'; p.push(section_id); }
  const [r] = await db.query(sql + ' ORDER BY u.family_name, u.given_name LIMIT 300', p);
  return r;
}

module.exports = { findSubject, updateSubject, subjectUsage, deleteSubject, importContext, importSubjects, importEnrollments, importAssignments, currentTerm, termLabel, terms, addTerm, setCurrentTerm, programs, addProgram, sections, addSection, subjects, addSubject,
  enrollmentsFor, assignmentsForSubjects, enroll, unenroll, assignmentsOf, assign, unassign, studentsOfInstructor };
