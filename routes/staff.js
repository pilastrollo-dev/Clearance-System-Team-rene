// Signers: instructors and office staff (including Registrar and Dean).
const { Router } = require('express');
const R = require('../lib/rules');
const Academics = require('../models/academics');
const Clearances = require('../models/clearances');
const Users = require('../models/users');
const Service = require('../services/clearanceService');

const router = Router();
const VIEWS = ['action', 'waiting', 'on_hold', 'overdue', 'history', 'all'];
const nf = (res) => res.status(404).render('error', { title: 'Not found', heading: 'Not found', message: 'That request does not exist or is not assigned to you.' });
const num = (v) => Number(v) || 0;

router.get('/', async (req, res, next) => {
  try {
    const u = req.session.user;
    const f = { view: VIEWS.includes(req.query.view) ? req.query.view : 'action', q: String(req.query.q || '').trim().slice(0, 60), subject_id: num(req.query.subject_id), section_id: num(req.query.section_id) };
    const term = await Academics.currentTerm();
    const now = new Date();
    const rows = (await Clearances.queueFor(u, f, now)).map((a) => ({ ...a, overdue: R.isOverdue(a, now) }));
    const assignments = u.role === 'instructor' && term ? await Academics.assignmentsOf(u.id, term.id) : [];
    const subjects = [...new Map(assignments.map((a) => [a.subject_id, { id: a.subject_id, label: a.subject_code }])).values()];
    const sections = u.role === 'instructor' ? [...new Map(assignments.map((a) => [a.section_id, { id: a.section_id, label: a.section_label }])).values()]
      : (await Academics.sections()).map((s) => ({ id: s.id, label: s.label }));
    res.render('staff/inbox', { title: 'Clearance requests', rows, f, assignments, subjects, sections, isDept: u.office_code === 'DEPT' });
  } catch (e) { next(e); }
});

router.get('/students', async (req, res, next) => {
  try {
    const u = req.session.user;
    if (u.role !== 'instructor') return res.redirect('/staff');
    const term = await Academics.currentTerm();
    const f = { q: String(req.query.q || '').trim().slice(0, 60), subject_id: num(req.query.subject_id), section_id: num(req.query.section_id) };
    const assignments = term ? await Academics.assignmentsOf(u.id, term.id) : [];
    const students = term ? await Academics.studentsOfInstructor(u.id, term.id, f) : [];
    res.render('staff/students', { title: 'My students', students, f, assignments,
      subjects: [...new Map(assignments.map((a) => [a.subject_id, { id: a.subject_id, label: a.subject_code }])).values()],
      sections: [...new Map(assignments.map((a) => [a.section_id, { id: a.section_id, label: a.section_label }])).values()] });
  } catch (e) { next(e); }
});

async function renderDetail(res, user, id, status, errors, old) {
  const a = await Clearances.approvalScoped(id, user);
  if (!a) return nf(res);
  const [all, issues] = await Promise.all([Clearances.approvalsFor(a.request_id), Clearances.issuesFor(a.request_id)]);
  res.status(status).render('staff/detail', {
    title: a.reference_no, a, all, issues, errors, old, overdue: R.isOverdue(a),
    blocked: a.status !== 'cleared' ? R.blockedReason(a, all, issues) : null,
    readOnly: user.office_code === 'DEPT' || a.request_status !== 'in_progress',
    laterSigned: all.some((x) => x.stage > a.stage && x.status === 'cleared'),
    hasSignature: !!(await Users.signatureOf(user.id)),
  });
}

router.get('/approvals/:id', (req, res, next) => renderDetail(res, req.session.user, num(req.params.id), 200, {}, { action: '', remarks: '', kind: 'general' }).catch(next));

router.post('/approvals/:id', async (req, res, next) => {
  try {
    const id = num(req.params.id);
    const action = ['clear', 'hold', 'pending'].includes(req.body.action) ? req.body.action : '';
    const remarks = String(req.body.remarks || '').trim().slice(0, 255);
    const kind = String(req.body.kind || 'general');
    const old = { action, remarks, kind };
    if (!action) return renderDetail(res, req.session.user, id, 422, { action: 'Choose what you want to do.' }, old);

    const out = await Service.decide({ approvalId: id, user: req.session.user, action, remarks, kind, password: String(req.body.password || ''), confirm: req.body.confirm, ip: req.ip });
    if (out.notFound) return nf(res);
    if (!out.ok) {
      const field = action === 'hold' ? 'remarks' : action === 'clear' ? 'password' : 'action';
      return renderDetail(res, req.session.user, id, 422, { [field]: out.errors[0] }, old); // reason text is kept; the password never is
    }
    req.session.flash = out.message;
    res.redirect(303, '/staff');
  } catch (e) { next(e); }
});

module.exports = router;
