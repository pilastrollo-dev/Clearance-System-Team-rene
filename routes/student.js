const { Router } = require('express');
const R = require('../lib/rules');
const Users = require('../models/users');
const Academics = require('../models/academics');
const Purposes = require('../models/purposes');
const Clearances = require('../models/clearances');
const Certs = require('../models/certificates');
const Service = require('../services/clearanceService');
const QR = require('../services/qr');

const router = Router();
const notFound = (res) => res.status(404).render('error', { title: 'Not found', heading: 'Not found', message: 'That clearance does not exist.' });

router.get('/', async (req, res, next) => {
  try {
    const me = req.session.user;
    const term = await Academics.currentTerm();
    const [profile, list, enrollments] = await Promise.all([
      Users.findById(me.id), Clearances.listByStudent(me.id), term ? Academics.enrollmentsFor(me.id, term.id) : [],
    ]);
    const open = list.find((c) => c.status === 'in_progress');
    res.render('student/dashboard', { title: 'My clearances', profile, list, enrollments, openId: open ? open.id : null });
  } catch (e) { next(e); }
});

async function renderNew(res, me, status, errors, old) {
  const term = await Academics.currentTerm();
  const [purposes, sigs, offices, enrollments] = await Promise.all([
    Purposes.list({ activeOnly: true }), Purposes.allSignatories(), Purposes.offices(), term ? Academics.enrollmentsFor(me.id, term.id) : [],
  ]);
  const names = Object.fromEntries(offices.map((o) => [o.code, o.name]));
  const byPurpose = {};
  sigs.forEach((s) => { (byPurpose[s.purpose_id] = byPurpose[s.purpose_id] || []).push({ name: names[s.office_code] || s.office_code, stage: s.stage }); });
  res.status(status).render('student/new', { title: 'New clearance', errors, old, purposes, byPurpose, enrollments });
}

router.get('/clearances/new', async (req, res, next) => {
  try {
    if (await Clearances.openRequestOf(req.session.user.id)) { req.session.flash = 'You already have a clearance in progress.'; return res.redirect('/student'); }
    await renderNew(res, req.session.user, 200, {}, {});
  } catch (e) { next(e); }
});

router.post('/clearances', async (req, res, next) => {
  try {
    const me = req.session.user;
    const purposeId = Number(req.body.purpose_id) || 0;
    const purposeOther = String(req.body.purpose_other || '').trim();
    const old = { purpose_id: String(purposeId || ''), purpose_other: purposeOther };
    const profile = await Users.findById(me.id);
    const out = await Service.submit({ student: { ...me, student_no: profile.student_no, college: profile.college }, purposeId, purposeOther, ip: req.ip });
    if (!out.ok) return renderNew(res, me, 422, out.errors, old);
    req.session.clearDraft = 'clearance';
    req.session.flash = 'Clearance ' + out.reference + ' submitted. Your signatories were notified.';
    res.redirect(303, '/student/clearances/' + out.id);
  } catch (e) { next(e); }
});

router.get('/clearances/:id', async (req, res, next) => {
  try {
    const request = await Clearances.findOwned(Number(req.params.id), req.session.user.id);
    if (!request) return notFound(res);
    const [all, issues] = await Promise.all([Clearances.approvalsFor(request.id), Clearances.issuesFor(request.id)]);
    const now = new Date();
    const rows = all.map((a) => ({ ...a, overdue: R.isOverdue(a, now), blocked: a.status !== 'cleared' ? R.blockedReason(a, all, issues) : null }));
    let cert = null, qr = null;
    if (request.status === 'completed') { cert = await Certs.findByRequest(request.id); if (cert) qr = await QR.dataUrl(cert.token); }
    res.render('student/detail', {
      title: request.reference_no, request, rows, issues, progress: R.progress(all), cert, certStatus: cert ? R.certStatus(cert) : null, qr,
      verifyUrl: cert ? QR.verifyUrl(cert.token) : null, requestOverdue: request.status === 'in_progress' && request.deadline_at && new Date(request.deadline_at) < now,
    });
  } catch (e) { next(e); }
});

router.post('/clearances/:id/cancel', async (req, res, next) => {
  try {
    const ok = await Clearances.cancel(Number(req.params.id), req.session.user, req.ip);
    req.session.flash = ok ? 'Clearance cancelled.' : 'That clearance cannot be cancelled.';
    res.redirect(303, '/student');
  } catch (e) { next(e); }
});

module.exports = router;
