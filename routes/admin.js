const crypto = require('crypto');
const { Router } = require('express');
const bcrypt = require('bcryptjs');
const R = require('../lib/rules');
const E = require('../lib/emailGen');
const Users = require('../models/users');
const Academics = require('../models/academics');
const Purposes = require('../models/purposes');
const Clearances = require('../models/clearances');
const Certs = require('../models/certificates');
const Notify = require('../models/notifications');
const Audit = require('../models/audit');
const Settings = require('../models/settings');
const Service = require('../services/clearanceService');
const Scheduler = require('../services/scheduler');

const router = Router();
const ROLES = ['student', 'instructor', 'staff', 'admin'];
const NAME = /^[\p{L}][\p{L} .'\-]{0,79}$/u;
const EMAIL = /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/;
const nf = (res, m = 'That record does not exist.') => res.status(404).render('error', { title: 'Not found', heading: 'Not found', message: m });
const num = (v) => Number(v) || 0;

// ---------- dashboard ----------
router.get('/', async (req, res, next) => {
  try {
    const now = new Date();
    const [counts, stats, cands, settings] = await Promise.all([Users.counts(), Clearances.reportStats({}, now), Clearances.overdueCandidates(), Settings.get()]);
    const overdue = cands.filter((a) => R.isOverdue(a, now)).map((a) => ({ ...a, hours: Math.floor((now - new Date(a.due_at)) / 3600000) }));
    res.render('admin/dashboard', { title: 'Admin dashboard', counts, stats, overdue, settings });
  } catch (e) { next(e); }
});

router.post('/reminders/run', async (req, res, next) => {
  try {
    const r = await Scheduler.runOnce();
    req.session.flash = 'Follow-up check done: ' + r.dueSoon + ' heads-up, ' + r.reminded + ' reminder(s), ' + r.escalated + ' escalation(s).';
    res.redirect(303, '/admin');
  } catch (e) { next(e); }
});

// ---------- users ----------
router.get('/users', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 60);
    const role = ROLES.includes(req.query.role) ? req.query.role : '';
    res.render('admin/users', { title: 'Users', users: await Users.list({ q, role }), q, role, roles: ROLES });
  } catch (e) { next(e); }
});

function readForm(b) {
  const s = (k, n = 120) => String(b[k] || '').trim().slice(0, n);
  return { role: s('role', 12), given_name: s('given_name', 80), middle_name: s('middle_name', 80), family_name: s('family_name', 80), email: s('email').toLowerCase(),
    student_no: s('student_no', 20), employee_id: s('employee_id', 20), department: s('department', 100), program_id: s('program_id', 10), section_id: s('section_id', 10),
    college: s('college', 100), office_code: s('office_code', 10) };
}

async function lists() {
  const [programs, sections, offices] = await Promise.all([Academics.programs(), Academics.sections(), Purposes.offices()]);
  return { programs, sections, offices: offices.filter((o) => o.is_active) };
}

// Collects EVERY problem at once (field -> message) so the form can be redisplayed with everything typed.
async function validate(f, { id = 0, mode, pw, pw2, temp }, L) {
  const errors = {};
  let suggestions = [];
  if (!ROLES.includes(f.role)) errors.role = 'Choose a role.';
  if (!NAME.test(f.given_name)) errors.given_name = 'Enter the first name (letters, spaces, - . \' only).';
  if (f.middle_name && !NAME.test(f.middle_name)) errors.middle_name = 'Letters, spaces, - . \' only.';
  if (!NAME.test(f.family_name)) errors.family_name = 'Enter the surname (letters, spaces, - . \' only).';

  // --- e-mail: unique, institutional domain, generated suggestion when blank/taken ---
  const kind = f.role === 'student' ? 'student' : 'staff';
  const cands = E.candidates(kind, f);
  const taken = await Users.emailsTaken([...cands, f.email].filter(Boolean), id);
  if (!f.email) {
    const s = E.suggest(kind, f, taken);
    if (!s.email) errors.email = 'Enter the first name and surname so an address can be suggested.';
    else if (s.isTaken) { errors.email = s.email + ' is already used. Pick one of the suggestions or type another.'; suggestions = s.alternatives; }
    else f.email = s.email;
  } else if (!EMAIL.test(f.email) || !f.email.endsWith(E.DOMAIN)) {
    errors.email = 'Use an institutional address ending in ' + E.DOMAIN + '.';
  } else if (taken.has(f.email)) {
    errors.email = f.email + ' is already used by another account.';
    suggestions = E.suggest(kind, f, taken).alternatives;
  }

  // --- role specific ---
  const row = { role: f.role, given_name: f.given_name, middle_name: f.middle_name || null, family_name: f.family_name, email: f.email, student_no: null, employee_id: f.employee_id || null,
    department: f.department || null, program_id: null, section_id: null, year_level: null, college: null, office_code: null };
  if (f.role === 'student') {
    if (!/^[A-Za-z0-9-]{4,20}$/.test(f.student_no)) errors.student_no = 'Student number must be 4–20 letters, digits or dashes.';
    else if (await Users.studentNoTaken(f.student_no, id)) errors.student_no = 'That student number already exists.';
    row.student_no = f.student_no; row.employee_id = null; row.department = null;
    const prog = L.programs.find((p) => String(p.id) === f.program_id);
    const sec = L.sections.find((s) => String(s.id) === f.section_id);
    if (!prog) errors.program_id = 'Choose the program.'; else { row.program_id = prog.id; row.college = prog.college; }
    if (!sec) errors.section_id = 'Choose the section.';
    else if (prog && sec.program_id !== prog.id) errors.section_id = 'That section belongs to a different program.';
    else { row.section_id = sec.id; row.year_level = sec.year_level; }
  } else if (f.role) {
    if (f.role !== 'admin' || f.employee_id) {
      if (!/^[A-Za-z0-9-]{3,20}$/.test(f.employee_id)) errors.employee_id = 'Employee ID must be 3–20 letters, digits or dashes.';
      else if (await Users.employeeIdTaken(f.employee_id, id)) errors.employee_id = 'That employee ID already exists.';
    }
    if (f.role === 'staff') {
      if (!L.offices.some((o) => o.code === f.office_code)) errors.office_code = 'Choose the office this person signs for.';
      else row.office_code = f.office_code;
      if (['DEAN', 'DEPT'].includes(f.office_code)) {
        if (!L.programs.some((p) => p.college === f.college)) errors.college = 'Choose the college.'; else row.college = f.college;
      }
    }
  }

  // --- password (never refilled) ---
  if (mode === 'new' ? !temp : (pw || pw2)) {
    const unmet = R.validatePassword(pw);
    if (unmet.length) errors.password = 'Still needed: ' + unmet.join(', ') + '.';
    if (pw !== pw2) errors.password2 = 'Passwords do not match.';
  }
  return { errors, row, suggestions };
}

async function renderForm(res, status, ctx) {
  res.status(status).render('admin/user_form', { title: ctx.mode === 'new' ? 'Add user' : 'Edit user', errors: {}, suggestions: [], userId: 0, target: null, roles: ROLES, ...(await lists()), ...ctx });
}

router.get('/users/new', (req, res, next) => renderForm(res, 200, { mode: 'new', old: { role: 'student' } }).catch(next));

const tempPassword = () => crypto.randomBytes(9).toString('base64url') + '#Aa1';

router.post('/users', async (req, res, next) => {
  try {
    const f = readForm(req.body);
    const pw = String(req.body.password || ''), pw2 = String(req.body.password2 || '');
    const temp = req.body.temp_password === '1';
    const v = await validate(f, { mode: 'new', pw, pw2, temp }, await lists());
    if (Object.keys(v.errors).length) return renderForm(res, 422, { mode: 'new', old: { ...f, temp_password: temp ? '1' : '' }, errors: v.errors, suggestions: v.suggestions });

    const plain = temp ? tempPassword() : pw;
    let id;
    try {
      id = await Users.create({ ...v.row, password_hash: await bcrypt.hash(plain, 10), must_change_password: temp });
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') { // two admins / a double click raced past the checks: the DATABASE still refuses the duplicate
        const field = /email/.test(e.message) ? 'email' : /student_no/.test(e.message) ? 'student_no' : /employee_id/.test(e.message) ? 'employee_id' : 'email';
        return renderForm(res, 422, { mode: 'new', old: { ...f, temp_password: temp ? '1' : '' }, errors: { [field]: 'That value already exists.' } });
      }
      throw e;
    }
    await Audit.write({ actor: req.session.user, action: 'user_created', entity: 'user', entityId: id, details: v.row.role + ' ' + v.row.email, ip: req.ip });
    await Notify.add(id, 'Welcome to CSPC Digital Clearance', 'Your account was created. Log in with your institutional email.');
    res.set('Cache-Control', 'no-store');
    res.locals.clearDraft = 'user-form';
    res.status(201).render('admin/user_created', { title: 'User created', created: { id, ...v.row }, tempPassword: temp ? plain : null });
  } catch (e) { next(e); }
});

router.get('/users/:id/edit', async (req, res, next) => {
  try {
    const u = await Users.findById(num(req.params.id));
    if (!u) return nf(res);
    await renderForm(res, 200, { mode: 'edit', userId: u.id, target: u, old: { ...u, program_id: u.program_id || '', section_id: u.section_id || '' } });
  } catch (e) { next(e); }
});

router.post('/users/:id', async (req, res, next) => {
  try {
    const id = num(req.params.id);
    const existing = await Users.findById(id);
    if (!existing) return nf(res);
    const f = readForm(req.body);
    if (id === req.session.user.id) f.role = existing.role; // never change your own role
    const pw = String(req.body.password || ''), pw2 = String(req.body.password2 || '');
    const v = await validate(f, { id, mode: 'edit', pw, pw2 }, await lists());
    if (Object.keys(v.errors).length) return renderForm(res, 422, { mode: 'edit', userId: id, target: existing, old: f, errors: v.errors, suggestions: v.suggestions });
    try {
      await Users.update(id, v.row);
      if (v.row.email !== existing.email) await Users.setEmailStatus(id, 'unverified'); // a new address is never assumed to be a real mailbox
      if (pw) { await Users.setPassword(id, await bcrypt.hash(pw, 10), false); await Notify.add(id, 'Password changed', 'An administrator changed your password.'); }
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') return renderForm(res, 422, { mode: 'edit', userId: id, target: existing, old: f, errors: { email: 'That email, student number or employee ID already exists.' } });
      throw e;
    }
    await Audit.write({ actor: req.session.user, action: 'user_updated', entity: 'user', entityId: id, details: v.row.email, ip: req.ip });
    req.session.clearDraft = 'user-form';
    req.session.flash = 'Changes saved.';
    res.redirect(303, '/admin/users');
  } catch (e) { next(e); }
});

router.post('/users/:id/toggle', async (req, res, next) => {
  try {
    const id = num(req.params.id);
    if (id === req.session.user.id) { req.session.flash = 'You cannot deactivate your own account.'; return res.redirect(303, '/admin/users'); }
    const u = await Users.findById(id);
    if (u) {
      await Users.setActive(id, !u.is_active);
      await Audit.write({ actor: req.session.user, action: u.is_active ? 'user_deactivated' : 'user_activated', entity: 'user', entityId: id, details: u.email, ip: req.ip });
      req.session.flash = u.given_name + ' ' + u.family_name + (u.is_active ? ' was deactivated.' : ' was reactivated.');
    }
    res.redirect(303, '/admin/users');
  } catch (e) { next(e); }
});

// The system cannot check a real mailbox, so verification is an explicit, audited admin statement.
router.post('/users/:id/email-status', async (req, res, next) => {
  try {
    const id = num(req.params.id), u = await Users.findById(id);
    if (!u) return nf(res);
    const status = req.body.status === 'verified' ? 'verified' : 'unverified';
    await Users.setEmailStatus(id, status);
    await Audit.write({ actor: req.session.user, action: 'email_' + status, entity: 'user', entityId: id, details: u.email + (status === 'verified' ? ' (admin confirmed the mailbox exists)' : ''), ip: req.ip });
    req.session.flash = status === 'verified' ? 'Marked as a confirmed institutional mailbox.' : 'Marked as not verified.';
    res.redirect(303, '/admin/users/' + id + '/edit');
  } catch (e) { next(e); }
});

// ---------- clearances, revocation, audit ----------
router.get('/clearances', async (req, res, next) => {
  try {
    const rows = await Clearances.reportRows({});
    const certs = await Certs.byRequestIds(rows.map((r) => r.id));
    res.render('admin/clearances', { title: 'All clearances', rows: rows.map((r) => ({ ...r, cert: certs[r.id] || null, certStatus: certs[r.id] ? R.certStatus(certs[r.id]) : null })) });
  } catch (e) { next(e); }
});

async function loadCert(token, res) {
  const cert = /^[a-f0-9]{32}$/.test(token) ? await Certs.findByToken(token) : null;
  if (!cert) nf(res, 'That certificate does not exist.');
  return cert;
}
router.get('/certificates/:token/revoke', async (req, res, next) => {
  try { const cert = await loadCert(req.params.token, res); if (cert) res.render('admin/revoke', { title: 'Revoke clearance', cert, errors: {}, old: { reason: '' } }); } catch (e) { next(e); }
});
router.post('/certificates/:token/revoke', async (req, res, next) => {
  try {
    const cert = await loadCert(req.params.token, res);
    if (!cert) return;
    const reason = String(req.body.reason || '').trim().slice(0, 255);
    const errors = {};
    if (reason.length < 5) errors.reason = 'Give a reason (at least 5 characters).';
    if (!errors.reason) {
      const out = await Service.revoke({ cert, reason, admin: req.session.user, password: String(req.body.password || ''), ip: req.ip });
      if (out.ok) { req.session.flash = 'Certificate revoked. The student was notified and the action was logged.'; return res.redirect(303, '/admin/clearances'); }
      Object.assign(errors, out.errors);
    }
    res.status(422).render('admin/revoke', { title: 'Revoke clearance', cert, errors, old: { reason } }); // reason kept, password never
  } catch (e) { next(e); }
});

router.get('/audit', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 60), requestNo = String(req.query.request || '').trim().slice(0, 30);
    res.render('admin/audit', { title: 'Audit log', rows: await Audit.list({ q, requestNo }), q, requestNo });
  } catch (e) { next(e); }
});

// ---------- settings (deadlines, reminders, escalation, QR validity) ----------
const SETTING_FIELDS = [['due_hours', 'Hours a signatory has to act (deadline)', 1, 720], ['due_soon_hours', 'Send a “deadline approaching” notice this many hours before', 1, 720],
  ['remind_every_hours', 'Repeat the overdue reminder every (hours)', 1, 720], ['escalate_after_hours', 'Escalate when overdue by (hours)', 1, 720], ['qr_valid_days', 'QR clearance stays valid for (days)', 1, 3650]];
router.get('/settings', async (req, res, next) => {
  try {
    const s = await Settings.get();
    res.render('admin/settings', { title: 'Settings', fields: SETTING_FIELDS, errors: {}, old: { due_hours: s.dueHours, due_soon_hours: s.dueSoonHours, remind_every_hours: s.remindEveryHours, escalate_after_hours: s.escalateAfterHours, qr_valid_days: s.qrValidDays, escalate_to_dept_head: s.escalateToDeptHead ? '1' : '' } });
  } catch (e) { next(e); }
});
router.post('/settings', async (req, res, next) => {
  try {
    const old = {}, errors = {}, values = {};
    for (const [k, , min, max] of SETTING_FIELDS) {
      old[k] = String(req.body[k] || '').trim();
      const n = Number(old[k]);
      if (!Number.isInteger(n) || n < min || n > max) errors[k] = 'Enter a whole number from ' + min + ' to ' + max + '.'; else values[k] = n;
    }
    old.escalate_to_dept_head = req.body.escalate_to_dept_head === '1' ? '1' : '';
    if (Object.keys(errors).length) return res.status(422).render('admin/settings', { title: 'Settings', fields: SETTING_FIELDS, errors, old });
    values.escalate_to_dept_head = old.escalate_to_dept_head ? 1 : 0;
    await Settings.save(values);
    await Audit.write({ actor: req.session.user, action: 'settings_changed', entity: 'settings', details: JSON.stringify(values), ip: req.ip });
    req.session.flash = 'Settings saved.';
    res.redirect(303, '/admin/settings');
  } catch (e) { next(e); }
});

module.exports = router;
