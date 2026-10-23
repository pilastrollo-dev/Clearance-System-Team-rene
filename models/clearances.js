const crypto = require('crypto');
const { db } = require('../db');
const R = require('../lib/rules');
const Audit = require('./audit');
const Certs = require('./certificates');

const A_SELECT =
  'SELECT a.id, a.request_id, a.office_code, a.instructor_id, a.subject_id, a.subject_label, a.stage, a.status, a.eligible_at, a.due_at, a.acted_at, a.remarks, ' +
  'a.reminder_count, a.last_reminder_at, a.due_soon_notified_at, a.escalated_at, o.name AS office_name, ' +
  "CONCAT(i.given_name, ' ', i.family_name) AS instructor_name FROM approvals a " +
  'LEFT JOIN offices o ON o.code = a.office_code LEFT JOIN users i ON i.id = a.instructor_id ';

const withLabel = (a) => ({ ...a, label: R.labelOf(a) });

async function approvalsFor(requestId, exec = db) {
  const [rows] = await exec.query(A_SELECT + 'WHERE a.request_id = ? ORDER BY a.stage, a.id', [requestId]);
  return rows.map(withLabel);
}
async function issuesFor(requestId, exec = db) {
  const [rows] = await exec.query(
    'SELECT c.id, c.approval_id, c.office_code, c.kind, c.description, c.status, c.raised_at, c.resolved_at FROM compliance_records c WHERE c.request_id = ? ORDER BY c.id', [requestId]);
  return rows;
}

// Which approvals may this signer see / act on?  Enforced inside SQL (never only in the UI).
function scope(user) {
  if (user.role === 'instructor') return { sql: "a.office_code = 'INSTRUCTOR' AND a.instructor_id = ?", params: [user.id] };
  if (user.office_code === 'DEAN') return { sql: "a.office_code = 'DEAN' AND s.college = ?", params: [user.college] };
  if (user.office_code === 'DEPT') return { sql: "a.office_code = 'INSTRUCTOR' AND a.escalated_at IS NOT NULL AND s.college = ?", params: [user.college] };
  return { sql: 'a.office_code = ?', params: [user.office_code] };
}

const QUEUE_SELECT =
  'SELECT a.id, a.request_id, a.office_code, a.instructor_id, a.subject_id, a.subject_label, a.stage, a.status, a.eligible_at, a.due_at, a.acted_at, a.remarks, ' +
  'a.reminder_count, a.last_reminder_at, a.due_soon_notified_at, a.escalated_at, o.name AS office_name, ' +
  "CONCAT(i.given_name, ' ', i.family_name) AS instructor_name, " +
  'r.reference_no, r.status AS request_status, r.created_at AS submitted_at, r.deadline_at, r.purpose_other, p.name AS purpose, r.student_id, ' +
  "s.given_name, s.family_name, s.student_no, s.college AS student_college, s.year_level, CONCAT(pr.code, ' ', sec.year_level, sec.name) AS section_label " +
  'FROM approvals a JOIN clearance_requests r ON r.id = a.request_id JOIN clearance_purposes p ON p.id = r.purpose_id JOIN users s ON s.id = r.student_id ' +
  'LEFT JOIN offices o ON o.code = a.office_code LEFT JOIN users i ON i.id = a.instructor_id LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN programs pr ON pr.id = s.program_id ';

async function approvalScoped(id, user) {
  const sc = scope(user);
  const [rows] = await db.query(QUEUE_SELECT + 'WHERE a.id = ? AND ' + sc.sql, [id, ...sc.params]);
  return rows[0] && withLabel(rows[0]);
}

const FILTERS = {
  action: "a.status IN ('pending','on_hold') AND a.eligible_at IS NOT NULL AND r.status = 'in_progress'",
  waiting: "a.status <> 'cleared' AND a.eligible_at IS NULL AND r.status = 'in_progress'",
  on_hold: "a.status = 'on_hold' AND r.status = 'in_progress'",
  history: "a.status = 'cleared'",
  all: '1=1',
};
async function queueFor(user, { view = 'action', q = '', subject_id = 0, section_id = 0 } = {}, now = new Date()) {
  const sc = scope(user);
  let sql = QUEUE_SELECT + 'WHERE ' + sc.sql;
  const params = [...sc.params];
  if (view === 'overdue') { sql += " AND a.status <> 'cleared' AND a.due_at < ? AND r.status = 'in_progress'"; params.push(now); }
  else sql += ' AND ' + (FILTERS[view] || FILTERS.action);
  if (q) { sql += ' AND (s.given_name LIKE ? OR s.family_name LIKE ? OR s.student_no LIKE ? OR r.reference_no LIKE ?)'; params.push('%' + q + '%', '%' + q + '%', '%' + q + '%', '%' + q + '%'); }
  if (subject_id) { sql += ' AND a.subject_id = ?'; params.push(subject_id); }
  if (section_id) { sql += ' AND s.section_id = ?'; params.push(section_id); }
  const [rows] = await db.query(sql + ' ORDER BY a.due_at IS NULL, a.due_at ASC, a.id DESC LIMIT 300', params);
  return rows.map(withLabel);
}

// ---------- submit ----------
async function createWithApprovals({ student, purposeId, purposeOther, termId, deadlineAt, approvals, dueAt, ip }) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [student.id]); // serialises double-clicks / two tabs
    const [open] = await conn.query("SELECT id FROM clearance_requests WHERE student_id = ? AND status = 'in_progress'", [student.id]);
    if (open.length) { await conn.rollback(); return { duplicate: true }; }

    const ref = 'CLR-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-6) + crypto.randomInt(10, 100);
    const now = new Date();
    const [res] = await conn.query(
      'INSERT INTO clearance_requests (reference_no, student_id, purpose_id, purpose_other, term_id, created_at, deadline_at) VALUES (?,?,?,?,?,?,?)',
      [ref, student.id, purposeId, purposeOther, termId, now, deadlineAt]);
    const minStage = Math.min(...approvals.map((a) => a.stage));
    for (const a of approvals) {
      const first = a.stage === minStage;
      await conn.query(
        'INSERT INTO approvals (request_id, office_code, instructor_id, subject_id, subject_label, stage, eligible_at, due_at) VALUES (?,?,?,?,?,?,?,?)',
        [res.insertId, a.office_code, a.instructor_id || null, a.subject_id || null, a.subject_label || null, a.stage, first ? now : null, first ? dueAt : null]);
    }
    await Audit.log(conn, { actor: student, action: 'submit', entity: 'request', entityId: res.insertId, requestId: res.insertId, details: approvals.length + ' signatories generated', ip });
    await conn.commit();
    return { id: res.insertId, reference: ref };
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}

// ---------- the approval engine ----------
// One transaction per decision. The request row is locked FOR UPDATE, so two signatories acting at the
// same moment are processed one after the other and the rules are checked against the latest state.
async function decideAtomic({ approvalId, actor, action, remarks, kind, ip, dueHours, qrValidDays, signatureImage }) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[ap]] = await conn.query('SELECT request_id FROM approvals WHERE id = ?', [approvalId]);
    if (!ap) { await conn.rollback(); return { ok: false, notFound: true }; }
    const [[req]] = await conn.query('SELECT id, reference_no, student_id, status FROM clearance_requests WHERE id = ? FOR UPDATE', [ap.request_id]);
    if (req.status !== 'in_progress') { await conn.rollback(); return { ok: false, errors: ['This clearance is no longer in progress.'] }; }

    const all = await approvalsFor(req.id, conn);
    const issues = await issuesFor(req.id, conn);
    const error = R.evaluateAction(all, issues, approvalId, action, remarks);
    if (error) { await conn.rollback(); return { ok: false, errors: [error] }; }

    const target = all.find((a) => a.id === approvalId);
    const now = new Date();
    if (action === 'clear') {
      await conn.query("UPDATE approvals SET status = 'cleared', acted_by = ?, acted_at = ?, remarks = ? WHERE id = ?", [actor.id, now, remarks || null, approvalId]);
      await conn.query("UPDATE compliance_records SET status = 'resolved', resolved_by = ?, resolved_at = ? WHERE approval_id = ? AND status = 'open'", [actor.id, now, approvalId]);
      const hash = crypto.createHmac('sha256', process.env.SESSION_SECRET || 'dev-only').update([actor.id, approvalId, req.id, 'cleared', now.toISOString()].join('|')).digest('hex');
      await conn.query('INSERT INTO signatures (approval_id, request_id, user_id, role, office_code, stage, action, remarks, signature_hash, signature_image, ip, signed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        [approvalId, req.id, actor.id, actor.role, target.office_code, target.stage, 'cleared', remarks || null, hash, signatureImage || null, ip || null, now]);
    } else if (action === 'hold') {
      await conn.query("UPDATE approvals SET status = 'on_hold', acted_by = ?, acted_at = ?, remarks = ? WHERE id = ?", [actor.id, now, remarks, approvalId]);
      const [open] = await conn.query("SELECT id FROM compliance_records WHERE approval_id = ? AND status = 'open'", [approvalId]);
      if (open.length) await conn.query('UPDATE compliance_records SET description = ?, kind = ? WHERE id = ?', [remarks, kind, open[0].id]);
      else await conn.query('INSERT INTO compliance_records (request_id, approval_id, office_code, kind, description, raised_by, raised_at) VALUES (?,?,?,?,?,?,?)',
        [req.id, approvalId, target.office_code, kind, remarks, actor.id, now]);
    } else { // reset a cleared item to pending
      await conn.query("UPDATE approvals SET status = 'pending', acted_by = ?, acted_at = ?, remarks = NULL WHERE id = ?", [actor.id, now, approvalId]);
    }
    await Audit.log(conn, { actor, action: 'approval_' + action, entity: 'approval', entityId: approvalId, requestId: req.id, details: target.label + (remarks ? ' — ' + remarks : ''), ip });

    const after = await approvalsFor(req.id, conn);
    const issuesAfter = await issuesFor(req.id, conn);
    let complete = false, newlyEligible = [];
    if (R.isComplete(after) && !issuesAfter.some((i) => i.status === 'open')) {
      await conn.query("UPDATE clearance_requests SET status = 'completed', completed_at = ? WHERE id = ? AND status = 'in_progress'", [now, req.id]);
      await Certs.issueTx(conn, req.id, new Date(now.getTime() + qrValidDays * 86400000));
      await Audit.log(conn, { actor, action: 'completed', entity: 'request', entityId: req.id, requestId: req.id, details: 'Final clearance issued', ip });
      complete = true;
    } else {
      const ids = R.nextEligible(after, issuesAfter);
      if (ids.length) {
        await conn.query('UPDATE approvals SET eligible_at = ?, due_at = ? WHERE id IN (?)', [now, R.dueAt(now, dueHours), ids]);
        newlyEligible = after.filter((a) => ids.includes(a.id));
      }
    }
    await conn.commit();
    return { ok: true, req, target, after, issuesAfter, complete, newlyEligible };
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}

// ---------- student views ----------
async function listByStudent(studentId) {
  const [rows] = await db.query(
    'SELECT r.id, r.reference_no, p.name AS purpose, r.status, r.created_at, r.deadline_at, t.academic_year, t.semester, COUNT(a.id) AS total, SUM(a.status = \'cleared\') AS done ' +
    'FROM clearance_requests r JOIN clearance_purposes p ON p.id = r.purpose_id JOIN terms t ON t.id = r.term_id LEFT JOIN approvals a ON a.request_id = r.id ' +
    'WHERE r.student_id = ? GROUP BY r.id, p.name, t.academic_year, t.semester ORDER BY r.id DESC LIMIT 100', [studentId]);
  return rows;
}
const REQ_COLS = 'r.id, r.reference_no, r.student_id, r.purpose_other, r.status, r.created_at, r.deadline_at, r.completed_at, p.name AS purpose, t.academic_year, t.semester';
async function findOwned(id, studentId) {
  const [rows] = await db.query('SELECT ' + REQ_COLS + ' FROM clearance_requests r JOIN clearance_purposes p ON p.id = r.purpose_id JOIN terms t ON t.id = r.term_id WHERE r.id = ? AND r.student_id = ?', [id, studentId]);
  return rows[0];
}
async function findById(id) {
  const [rows] = await db.query('SELECT ' + REQ_COLS + ' FROM clearance_requests r JOIN clearance_purposes p ON p.id = r.purpose_id JOIN terms t ON t.id = r.term_id WHERE r.id = ?', [id]);
  return rows[0];
}
async function openRequestOf(studentId) {
  const [rows] = await db.query("SELECT id FROM clearance_requests WHERE student_id = ? AND status = 'in_progress'", [studentId]); return rows[0];
}
async function cancel(id, student, ip) {
  const [r] = await db.query("UPDATE clearance_requests SET status = 'cancelled' WHERE id = ? AND student_id = ? AND status = 'in_progress'", [id, student.id]);
  if (r.affectedRows === 1) await Audit.write({ actor: student, action: 'cancel', entity: 'request', entityId: id, requestId: id, ip });
  return r.affectedRows === 1;
}

// Printable form: who may open it?  The student, an admin, or a signatory of that request.
async function canOpenForm(user, requestId) {
  if (user.role === 'admin') return true;
  if (user.role === 'student') { const [r] = await db.query('SELECT id FROM clearance_requests WHERE id = ? AND student_id = ?', [requestId, user.id]); return r.length > 0; }
  const sc = scope(user);
  const [rows] = await db.query('SELECT a.id FROM approvals a JOIN clearance_requests r ON r.id = a.request_id JOIN users s ON s.id = r.student_id WHERE a.request_id = ? AND ' + sc.sql + ' LIMIT 1', [requestId, ...sc.params]);
  return rows.length > 0;
}
async function formData(requestId) {
  const [rows] = await db.query(
    "SELECT s.given_name, s.middle_name, s.family_name, s.student_no, s.year_level, pr.name AS program, CONCAT(pr.code, ' ', sec.year_level, sec.name) AS section_label, s.college " +
    'FROM clearance_requests r JOIN users s ON s.id = r.student_id LEFT JOIN programs pr ON pr.id = s.program_id LEFT JOIN sections sec ON sec.id = s.section_id WHERE r.id = ?', [requestId]);
  const [sigs] = await db.query(
    "SELECT sg.approval_id, sg.signed_at, sg.signature_hash, sg.signature_image, u.given_name, u.family_name FROM signatures sg JOIN users u ON u.id = sg.user_id WHERE sg.request_id = ? AND sg.action = 'cleared' ORDER BY sg.id", [requestId]);
  return { student: rows[0], signatures: Object.fromEntries(sigs.map((s) => [s.approval_id, s])) };
}

// ---------- follow-up ----------
async function overdueCandidates() {
  const [rows] = await db.query(
    QUEUE_SELECT + "WHERE a.status <> 'cleared' AND a.due_at IS NOT NULL AND r.status = 'in_progress'");
  return rows.map(withLabel);
}
async function markReminded(id) { await db.query('UPDATE approvals SET reminder_count = reminder_count + 1, last_reminder_at = ? WHERE id = ?', [new Date(), id]); }
async function markEscalated(id) { await db.query('UPDATE approvals SET escalated_at = ? WHERE id = ?', [new Date(), id]); }
async function markDueSoon(id) { await db.query('UPDATE approvals SET due_soon_notified_at = ? WHERE id = ?', [new Date(), id]); }

// ---------- admin: list, stats, reports ----------
function reqWhere(f, now) {
  const w = ['1=1'], p = [];
  if (f.from) { w.push('r.created_at >= ?'); p.push(f.from); }
  if (f.to) { w.push('r.created_at < ?'); p.push(f.to); }
  if (f.term_id) { w.push('r.term_id = ?'); p.push(f.term_id); }
  if (f.purpose_id) { w.push('r.purpose_id = ?'); p.push(f.purpose_id); }
  if (f.program_id) { w.push('s.program_id = ?'); p.push(f.program_id); }
  if (f.section_id) { w.push('s.section_id = ?'); p.push(f.section_id); }
  if (f.office) { w.push('EXISTS (SELECT 1 FROM approvals x WHERE x.request_id = r.id AND x.office_code = ?)'); p.push(f.office); }
  if (['in_progress', 'completed', 'cancelled'].includes(f.status)) { w.push('r.status = ?'); p.push(f.status); }
  if (f.status === 'on_hold') w.push("r.status = 'in_progress' AND EXISTS (SELECT 1 FROM approvals x WHERE x.request_id = r.id AND x.status = 'on_hold')");
  if (f.status === 'overdue') { w.push("r.status = 'in_progress' AND EXISTS (SELECT 1 FROM approvals x WHERE x.request_id = r.id AND x.status <> 'cleared' AND x.due_at < ?)"); p.push(now); }
  return { where: w.join(' AND '), params: p };
}
const BASE = 'FROM clearance_requests r JOIN users s ON s.id = r.student_id JOIN clearance_purposes p ON p.id = r.purpose_id JOIN terms t ON t.id = r.term_id LEFT JOIN programs pr ON pr.id = s.program_id LEFT JOIN sections sec ON sec.id = s.section_id ';

async function reportRows(f, now = new Date()) {
  const { where, params } = reqWhere(f, now);
  const [rows] = await db.query(
    "SELECT r.id, r.reference_no, r.status, r.created_at, r.completed_at, p.name AS purpose, t.academic_year, t.semester, s.given_name, s.family_name, s.student_no, pr.code AS program, s.year_level, sec.name AS section, " +
    "(SELECT COUNT(*) FROM approvals a WHERE a.request_id = r.id) AS total, (SELECT COUNT(*) FROM approvals a WHERE a.request_id = r.id AND a.status = 'cleared') AS done, " +
    "(SELECT COUNT(*) FROM compliance_records c WHERE c.request_id = r.id AND c.status = 'open') AS open_issues " +
    BASE + 'WHERE ' + where + ' ORDER BY r.id DESC LIMIT 1000', params);
  return rows;
}

async function reportStats(f, now = new Date()) {
  const { where, params } = reqWhere(f, now);
  const ex = (cond) => "r.status = 'in_progress' AND EXISTS (SELECT 1 FROM approvals a WHERE a.request_id = r.id AND " + cond + ')';
  const [[t]] = await db.query(
    'SELECT COUNT(*) AS total, SUM(r.status = \'in_progress\') AS in_progress, SUM(r.status = \'completed\') AS completed, ' +
    'SUM(' + ex("a.status = 'pending'") + ') AS pending, SUM(' + ex("a.status = 'on_hold'") + ') AS on_hold, ' +
    'SUM(' + ex("a.office_code = 'REG' AND a.status <> 'cleared' AND a.eligible_at IS NOT NULL") + ') AS awaiting_registrar, ' +
    'SUM(' + ex("a.office_code = 'DEAN' AND a.status <> 'cleared' AND a.eligible_at IS NOT NULL") + ') AS awaiting_dean, ' +
    'SUM(' + ex("a.status <> 'cleared' AND a.due_at < ?") + ') AS overdue, ' +
    "AVG(CASE WHEN r.status = 'completed' THEN TIMESTAMPDIFF(HOUR, r.created_at, r.completed_at) END) AS avg_hours " +
    BASE + 'WHERE ' + where, [now, ...params]);
  const [[iss]] = await db.query("SELECT COUNT(*) AS n FROM compliance_records c JOIN clearance_requests r ON r.id = c.request_id JOIN users s ON s.id = r.student_id WHERE c.status = 'open' AND " + where, params);
  const [byPurpose] = await db.query('SELECT p.name AS k, COUNT(*) AS n ' + BASE + 'WHERE ' + where + ' GROUP BY p.name ORDER BY n DESC', params);
  const [byTerm] = await db.query('SELECT CONCAT(t.semester, \' \', t.academic_year) AS k, COUNT(*) AS n ' + BASE + 'WHERE ' + where + ' GROUP BY t.id, t.semester, t.academic_year ORDER BY t.id DESC', params);
  const [byGroup] = await db.query("SELECT CONCAT(COALESCE(pr.code, '—'), ' · year ', COALESCE(s.year_level, '?'), ' · ', COALESCE(sec.name, '—')) AS k, COUNT(*) AS n " + BASE + 'WHERE ' + where + ' GROUP BY pr.code, s.year_level, sec.name ORDER BY n DESC LIMIT 20', params);
  const [bySigner] = await db.query(
    "SELECT COALESCE(o.name, 'Instructors') AS k, SUM(a.status = 'pending') AS pending, SUM(a.status = 'on_hold') AS on_hold, SUM(a.status = 'cleared') AS cleared, " +
    "AVG(CASE WHEN a.status = 'cleared' AND a.eligible_at IS NOT NULL THEN TIMESTAMPDIFF(HOUR, a.eligible_at, a.acted_at) END) AS avg_hours " +
    'FROM approvals a JOIN clearance_requests r ON r.id = a.request_id JOIN users s ON s.id = r.student_id LEFT JOIN offices o ON o.code = a.office_code WHERE ' + where +
    ' GROUP BY a.office_code, o.name ORDER BY k', params);
  const [byInstructor] = await db.query(
    "SELECT CONCAT(i.given_name, ' ', i.family_name) AS k, SUM(a.status = 'pending') AS pending, SUM(a.status = 'on_hold') AS on_hold, SUM(a.status = 'cleared') AS cleared " +
    "FROM approvals a JOIN clearance_requests r ON r.id = a.request_id JOIN users s ON s.id = r.student_id JOIN users i ON i.id = a.instructor_id WHERE a.office_code = 'INSTRUCTOR' AND " + where +
    ' GROUP BY i.id, i.given_name, i.family_name ORDER BY k', params);
  return { totals: t, openIssues: iss.n, byPurpose, byTerm, byGroup, bySigner, byInstructor };
}

module.exports = { approvalsFor, issuesFor, approvalScoped, queueFor, createWithApprovals, decideAtomic, listByStudent, findOwned, findById,
  openRequestOf, cancel, canOpenForm, formData, overdueCandidates, markReminded, markEscalated, markDueSoon, reportRows, reportStats };
