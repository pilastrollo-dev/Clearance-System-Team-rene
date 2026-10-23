// Admin: academic structure, enrollment, teaching assignments, clearance purposes and required signatories.
const { Router } = require('express');
const Users = require('../models/users');
const Academics = require('../models/academics');
const Purposes = require('../models/purposes');
const Audit = require('../models/audit');
const I = require('../lib/importer');
const { pdfToText } = require('../services/pdfText');

const router = Router();
const num = (v) => Number(v) || 0;
const str = (v, n = 120) => String(v || '').trim().slice(0, n);
const nf = (res, m = 'That record does not exist.') => res.status(404).render('error', { title: 'Not found', heading: 'Not found', message: m });
const isDup = (e) => e && e.code === 'ER_DUP_ENTRY';
const audit = (req, action, entity, details) => Audit.write({ actor: req.session.user, action, entity, details, ip: req.ip });

// ---------- academic structure ----------
async function page(res, status, form = '', errors = {}, old = {}) {
  const [terms, programs, sections, subjects] = await Promise.all([Academics.terms(), Academics.programs(), Academics.sections(), Academics.subjects()]);
  res.status(status).render('admin/academics', { title: 'Academics', terms, programs, sections, subjects, form, errors, old });
}
router.get('/academics', (req, res, next) => page(res, 200).catch(next));

router.post('/academics/programs', async (req, res, next) => {
  try {
    const o = { code: str(req.body.code, 20).toUpperCase(), name: str(req.body.name), college: str(req.body.college, 100) }, e = {};
    if (!/^[A-Z0-9-]{2,20}$/.test(o.code)) e.code = 'Use 2–20 capital letters or digits (e.g. BSIT).';
    if (o.name.length < 3) e.name = 'Enter the program name.';
    if (o.college.length < 3) e.college = 'Enter the college.';
    if (Object.keys(e).length) return page(res, 422, 'program', e, o);
    try { await Academics.addProgram(o); } catch (x) { if (isDup(x)) return page(res, 422, 'program', { code: 'That program code already exists.' }, o); throw x; }
    await audit(req, 'program_added', 'program', o.code);
    req.session.flash = 'Program added.'; res.redirect(303, '/admin/academics');
  } catch (e) { next(e); }
});
router.post('/academics/sections', async (req, res, next) => {
  try {
    const o = { program_id: str(req.body.program_id, 10), year_level: str(req.body.year_level, 2), name: str(req.body.name, 10).toUpperCase() }, e = {};
    if (!(await Academics.programs()).some((p) => String(p.id) === o.program_id)) e.program_id = 'Choose the program.';
    if (!/^[1-6]$/.test(o.year_level)) e.year_level = 'Year level must be 1 to 6.';
    if (!/^[A-Z0-9]{1,10}$/.test(o.name)) e.name = 'Use letters/digits, e.g. A or 2C.';
    if (Object.keys(e).length) return page(res, 422, 'section', e, o);
    try { await Academics.addSection({ program_id: Number(o.program_id), year_level: Number(o.year_level), name: o.name }); } catch (x) { if (isDup(x)) return page(res, 422, 'section', { name: 'That section already exists.' }, o); throw x; }
    await audit(req, 'section_added', 'section', o.name);
    req.session.flash = 'Section added.'; res.redirect(303, '/admin/academics');
  } catch (e) { next(e); }
});
router.post('/academics/subjects', async (req, res, next) => {
  try {
    const o = { code: str(req.body.code, 20).toUpperCase(), title: str(req.body.title) }, e = {};
    if (!/^[A-Z0-9 -]{2,20}$/.test(o.code)) e.code = 'Use 2–20 characters, e.g. CCIT 106.';
    if (o.title.length < 3) e.title = 'Enter the subject title.';
    if (Object.keys(e).length) return page(res, 422, 'subject', e, o);
    try { await Academics.addSubject(o); } catch (x) { if (isDup(x)) return page(res, 422, 'subject', { code: 'That subject code already exists.' }, o); throw x; }
    await audit(req, 'subject_added', 'subject', o.code);
    req.session.flash = 'Subject added.'; res.redirect(303, '/admin/academics');
  } catch (e) { next(e); }
});
router.post('/academics/terms', async (req, res, next) => {
  try {
    const o = { academic_year: str(req.body.academic_year, 9), semester: str(req.body.semester, 8) }, e = {};
    const m = /^(\d{4})-(\d{4})$/.exec(o.academic_year);
    if (!m || Number(m[2]) !== Number(m[1]) + 1) e.academic_year = 'Use the form 2026-2027.';
    if (!['1st Sem', '2nd Sem', 'Summer'].includes(o.semester)) e.semester = 'Choose the semester.';
    if (Object.keys(e).length) return page(res, 422, 'term', e, o);
    try { await Academics.addTerm(o.academic_year, o.semester); } catch (x) { if (isDup(x)) return page(res, 422, 'term', { academic_year: 'That term already exists.' }, o); throw x; }
    await audit(req, 'term_added', 'term', o.semester + ' ' + o.academic_year);
    req.session.flash = 'Term added.'; res.redirect(303, '/admin/academics');
  } catch (e) { next(e); }
});
router.post('/academics/terms/:id/current', async (req, res, next) => {
  try { await Academics.setCurrentTerm(num(req.params.id)); await audit(req, 'term_current', 'term', String(req.params.id)); req.session.flash = 'Current term updated.'; res.redirect(303, '/admin/academics'); } catch (e) { next(e); }
});

// ---------- enrollment (students) and teaching assignments (instructors) ----------
async function loadPerson(req, res, role) {
  const u = await Users.findById(num(req.params.id));
  if (!u || u.role !== role) { nf(res, 'That ' + role + ' does not exist.'); return null; }
  return u;
}
async function enrollPage(res, status, u, errors = {}, old = {}) {
  const term = await Academics.currentTerm();
  const [subjects, sections] = await Promise.all([Academics.subjects(), Academics.sections()]);
  res.status(status).render('admin/enrollment', { title: 'Enrollment', person: u, currentTerm: term, items: term ? await Academics.enrollmentsFor(u.id, term.id) : [], subjects, sections, errors, old });
}
router.get('/users/:id/enrollment', async (req, res, next) => { try { const u = await loadPerson(req, res, 'student'); if (u) await enrollPage(res, 200, u); } catch (e) { next(e); } });
router.post('/users/:id/enrollment', async (req, res, next) => {
  try {
    const u = await loadPerson(req, res, 'student'); if (!u) return;
    const term = await Academics.currentTerm();
    const o = { subject_id: str(req.body.subject_id, 10), section_id: str(req.body.section_id, 10) }, e = {};
    if (!term) e._form = 'Set a current term first.';
    if (!(await Academics.subjects()).some((s) => String(s.id) === o.subject_id)) e.subject_id = 'Choose the subject.';
    if (!(await Academics.sections()).some((s) => String(s.id) === o.section_id)) e.section_id = 'Choose the section.';
    if (Object.keys(e).length) return enrollPage(res, 422, u, e, o);
    try { await Academics.enroll(u.id, Number(o.subject_id), Number(o.section_id), term.id); }
    catch (x) { if (isDup(x)) return enrollPage(res, 422, u, { subject_id: 'The student is already enrolled in that subject this term.' }, o); throw x; }
    await audit(req, 'enrolled', 'user', u.email + ' subject ' + o.subject_id);
    req.session.flash = 'Enrolled.'; res.redirect(303, '/admin/users/' + u.id + '/enrollment');
  } catch (e) { next(e); }
});
router.post('/users/:id/enrollment/:eid/remove', async (req, res, next) => {
  try {
    const u = await loadPerson(req, res, 'student'); if (!u) return;
    const ok = await Academics.unenroll(num(req.params.eid), u.id);
    if (ok) await audit(req, 'unenrolled', 'user', u.email);
    req.session.flash = ok ? 'Enrollment removed.' : 'Cannot remove: a clearance already exists for this term, so the record must stay traceable.';
    res.redirect(303, '/admin/users/' + u.id + '/enrollment');
  } catch (e) { next(e); }
});

async function assignPage(res, status, u, errors = {}, old = {}) {
  const term = await Academics.currentTerm();
  const [subjects, sections] = await Promise.all([Academics.subjects(), Academics.sections()]);
  res.status(status).render('admin/assignments', { title: 'Teaching assignments', person: u, currentTerm: term, items: term ? await Academics.assignmentsOf(u.id, term.id) : [], subjects, sections, errors, old });
}
router.get('/users/:id/assignments', async (req, res, next) => { try { const u = await loadPerson(req, res, 'instructor'); if (u) await assignPage(res, 200, u); } catch (e) { next(e); } });
router.post('/users/:id/assignments', async (req, res, next) => {
  try {
    const u = await loadPerson(req, res, 'instructor'); if (!u) return;
    const term = await Academics.currentTerm();
    const o = { subject_id: str(req.body.subject_id, 10), section_id: str(req.body.section_id, 10) }, e = {};
    if (!term) e._form = 'Set a current term first.';
    if (!(await Academics.subjects()).some((s) => String(s.id) === o.subject_id)) e.subject_id = 'Choose the subject.';
    if (!(await Academics.sections()).some((s) => String(s.id) === o.section_id)) e.section_id = 'Choose the section.';
    if (Object.keys(e).length) return assignPage(res, 422, u, e, o);
    try { await Academics.assign(u.id, Number(o.subject_id), Number(o.section_id), term.id); }
    catch (x) { if (isDup(x)) return assignPage(res, 422, u, { subject_id: 'Already assigned to that subject and section.' }, o); throw x; }
    await audit(req, 'assigned', 'user', u.email + ' subject ' + o.subject_id);
    req.session.flash = 'Assignment added.'; res.redirect(303, '/admin/users/' + u.id + '/assignments');
  } catch (e) { next(e); }
});
router.post('/users/:id/assignments/:aid/remove', async (req, res, next) => {
  try {
    const u = await loadPerson(req, res, 'instructor'); if (!u) return;
    const ok = await Academics.unassign(num(req.params.aid), u.id);
    if (ok) await audit(req, 'unassigned', 'user', u.email);
    req.session.flash = ok ? 'Assignment removed.' : 'Cannot remove: this instructor already has clearance approvals for that subject.';
    res.redirect(303, '/admin/users/' + u.id + '/assignments');
  } catch (e) { next(e); }
});

// ---------- purposes & required signatories ----------
async function purposesPage(res, status, errPurpose = 0, errors = {}, oldP = null, newErr = null) {
  const [purposes, sigs, offices] = await Promise.all([Purposes.list(), Purposes.allSignatories(), Purposes.offices()]);
  const view = purposes.map((p) => {
    const stages = {}; sigs.filter((s) => s.purpose_id === p.id).forEach((s) => { stages[s.office_code] = s.stage; });
    return errPurpose === p.id && oldP ? { ...p, ...oldP.fields, stages: oldP.stages } : { ...p, stages };
  });
  res.status(status).render('admin/purposes', { title: 'Clearance purposes', purposes: view, offices, errPurpose, errors, newErr });
}
router.get('/purposes', (req, res, next) => purposesPage(res, 200).catch(next));

function readPurpose(b, offices) {
  const fields = { name: str(b.name, 60), requires_explanation: b.requires_explanation === '1' ? 1 : 0, is_active: b.is_active === '1' ? 1 : 0,
    instructor_stage: str(b.instructor_stage, 2), deadline_days: str(b.deadline_days, 3) };
  const stages = {}, e = {};
  offices.filter((o) => o.is_active).forEach((o) => { const v = str(b['stage_' + o.code], 2); if (v !== '') stages[o.code] = v; });
  if (fields.name.length < 2) e.name = 'Enter a name.';
  if (fields.instructor_stage !== '' && !/^[1-9]$/.test(fields.instructor_stage)) e.instructor_stage = 'Stage must be 1–9, or blank.';
  if (fields.deadline_days !== '' && !/^\d{1,3}$/.test(fields.deadline_days)) e.deadline_days = 'Enter days or leave blank.';
  for (const [c, v] of Object.entries(stages)) if (!/^[1-9]$/.test(v)) e['stage_' + c] = 'Stage must be 1–9, or blank.';
  if (!Object.keys(stages).length && fields.instructor_stage === '') e.signatories = 'Require at least one office or the instructors.';
  return { fields, stages, errors: e };
}
const toDb = (r) => ({ name: r.fields.name, requires_explanation: r.fields.requires_explanation, is_active: r.fields.is_active, instructor_stage: r.fields.instructor_stage === '' ? null : Number(r.fields.instructor_stage), deadline_days: r.fields.deadline_days === '' ? null : Number(r.fields.deadline_days) });

router.post('/purposes', async (req, res, next) => {
  try {
    const name = str(req.body.name, 60);
    if (name.length < 2) return purposesPage(res, 422, 0, {}, null, { name, error: 'Enter a name for the new purpose.' });
    try { await Purposes.create({ name, requires_explanation: req.body.requires_explanation === '1', instructor_stage: 1, deadline_days: 30 }); }
    catch (x) { if (isDup(x)) return purposesPage(res, 422, 0, {}, null, { name, error: 'That purpose already exists.' }); throw x; }
    await audit(req, 'purpose_added', 'purpose', name);
    req.session.flash = 'Purpose added. Now choose its required signatories below.'; res.redirect(303, '/admin/purposes');
  } catch (e) { next(e); }
});
router.post('/purposes/:id', async (req, res, next) => {
  try {
    const id = num(req.params.id);
    if (!(await Purposes.find(id))) return nf(res);
    const offices = await Purposes.offices();
    const r = readPurpose(req.body, offices);
    if (Object.keys(r.errors).length) return purposesPage(res, 422, id, r.errors, r);
    const stages = Object.fromEntries(Object.entries(r.stages).map(([c, v]) => [c, Number(v)]));
    try { await Purposes.save(id, toDb(r), stages); } catch (x) { if (isDup(x)) return purposesPage(res, 422, id, { name: 'Another purpose already uses that name.' }, r); throw x; }
    await audit(req, 'purpose_saved', 'purpose', r.fields.name + ' ' + JSON.stringify(stages));
    req.session.flash = 'Saved. New requests use this configuration; existing requests are unchanged.'; res.redirect(303, '/admin/purposes');
  } catch (e) { next(e); }
});
router.post('/offices', async (req, res, next) => {
  try {
    const code = str(req.body.code, 10).toUpperCase(), name = str(req.body.name, 120);
    if (!/^[A-Z]{2,10}$/.test(code) || code === 'INSTRUCTOR' || name.length < 3) return purposesPage(res, 422, 0, {}, null, { code, name, error: 'Use a 2–10 letter code (not INSTRUCTOR) and a name.' });
    try { await Purposes.addOffice(code, name); } catch (x) { if (isDup(x)) return purposesPage(res, 422, 0, {}, null, { code, name, error: 'That office code already exists.' }); throw x; }
    await audit(req, 'office_added', 'office', code);
    req.session.flash = 'Office added. Create a staff account with this office, then require it on a purpose.'; res.redirect(303, '/admin/purposes');
  } catch (e) { next(e); }
});

// ---------- edit / delete a subject (fix a wrong entry) ----------
function readSubject(b) {
  const o = { code: str(b.code, 20).toUpperCase().replace(/\s+/g, ' '), title: str(b.title) }, e = {};
  if (!/^[A-Z0-9 -]{2,20}$/.test(o.code)) e.code = 'Use 2–20 characters, e.g. CCIT 106.';
  if (o.title.length < 3) e.title = 'Enter the subject title.';
  return { o, e };
}
async function subjectPage(res, status, subject, errors = {}, old = null) {
  res.status(status).render('admin/subject_edit', { title: 'Edit subject', subject, usage: await Academics.subjectUsage(subject.id), errors, old: old || subject });
}
router.get('/academics/subjects/:id/edit', async (req, res, next) => {
  try { const s = await Academics.findSubject(num(req.params.id)); if (!s) return nf(res); await subjectPage(res, 200, s); } catch (e) { next(e); }
});
router.post('/academics/subjects/:id', async (req, res, next) => {
  try {
    const s = await Academics.findSubject(num(req.params.id)); if (!s) return nf(res);
    const { o, e } = readSubject(req.body);
    if (Object.keys(e).length) return subjectPage(res, 422, s, e, o);
    try { await Academics.updateSubject(s.id, o); } catch (x) { if (isDup(x)) return subjectPage(res, 422, s, { code: 'Another subject already uses that code.' }, o); throw x; }
    await audit(req, 'subject_edited', 'subject', s.code + ' → ' + o.code + ' / ' + o.title);
    req.session.flash = 'Subject updated. Past clearances keep the code they were created with.'; res.redirect(303, '/admin/academics');
  } catch (e) { next(e); }
});
router.post('/academics/subjects/:id/delete', async (req, res, next) => {
  try {
    const s = await Academics.findSubject(num(req.params.id)); if (!s) return nf(res);
    const ok = await Academics.deleteSubject(s.id);
    if (ok) await audit(req, 'subject_deleted', 'subject', s.code);
    req.session.flash = ok ? 'Subject ' + s.code + ' deleted.' : 'Cannot delete ' + s.code + ': it is used by enrollments, teaching assignments or clearances. Edit it instead.';
    res.redirect(303, '/admin/academics');
  } catch (e) { next(e); }
});

// ---------- bulk import: CSV (subjects, enrollments, assignments) and PDF (subjects) ----------
const KIND_KEYS = Object.keys(I.KINDS);
const importPage = (res, status, ctx = {}) => res.status(status).render('admin/import', { title: 'Bulk import', kinds: I.KINDS, kind: 'subjects', text: '', results: null, summary: null, info: '', error: '', ...ctx });

router.get('/import', (req, res) => importPage(res, 200, { kind: KIND_KEYS.includes(req.query.kind) ? req.query.kind : 'subjects' }));
router.get('/import/template/:kind', (req, res) => {
  if (!I.TEMPLATES[req.params.kind]) return nf(res);
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="' + req.params.kind + '-template.csv"' }).send(I.TEMPLATES[req.params.kind]);
});

async function validateUpload(kind, text, term) {
  const ctx = await Academics.importContext(term ? term.id : 0);
  const results = I.validateRows(kind, I.parseCsv(text), ctx);
  return { results, summary: I.summarize(results) };
}

router.post('/import/check', async (req, res, next) => {
  try {
    const kind = KIND_KEYS.includes(req.body.kind) ? req.body.kind : 'subjects';
    let text = String(req.body.csv_text || '').slice(0, 2000000), info = '';
    const term = await Academics.currentTerm();
    if (kind !== 'subjects' && !term) return importPage(res, 422, { kind, text, error: 'Set a current term first (Academics).' });
    if (req.body.pdf_base64) {
      if (kind !== 'subjects') return importPage(res, 422, { kind, text, error: 'PDF reading is only available for subject lists.' });
      let pdfText;
      try { pdfText = await pdfToText(req.body.pdf_base64); } catch (x) { return importPage(res, 422, { kind, text, error: x.message }); }
      const rows = I.rowsFromPdfText(pdfText);
      if (!rows.length) return importPage(res, 422, { kind, text, error: 'No subject lines were found. The PDF may be a scan (pictures of text) or laid out differently. Use the CSV template instead.' });
      text = I.toCsv([['code', 'title'], ...rows]);
      info = 'Read ' + rows.length + ' subject line(s) from the PDF. Check every row below: PDF text is not always read correctly. Fix the text box and press Check again if needed.';
    }
    if (!text.trim()) return importPage(res, 422, { kind, text, error: 'Choose a file or paste the rows first.' });
    const v = await validateUpload(kind, text, term);
    if (!v.results.length) return importPage(res, 422, { kind, text, error: 'No data rows were found.' });
    importPage(res, 200, { kind, text, info, ...v });
  } catch (e) { next(e); }
});

router.post('/import/commit', async (req, res, next) => {
  try {
    const kind = KIND_KEYS.includes(req.body.kind) ? req.body.kind : 'subjects';
    const text = String(req.body.csv_text || '').slice(0, 2000000);
    const term = await Academics.currentTerm();
    if (kind !== 'subjects' && !term) return importPage(res, 422, { kind, text, error: 'Set a current term first (Academics).' });
    const v = await validateUpload(kind, text, term);          // re-validated on the server: the preview is never trusted
    const rows = v.results.filter((r) => r.status === 'ok').map((r) => r.data);
    if (!rows.length) return importPage(res, 422, { kind, text, ...v, error: 'Nothing valid to import.' });
    try {
      if (kind === 'subjects') await Academics.importSubjects(rows);
      else if (kind === 'enrollments') await Academics.importEnrollments(rows, term.id);
      else await Academics.importAssignments(rows, term.id);
    } catch (x) {
      if (isDup(x)) return importPage(res, 422, { kind, text, error: 'Someone added some of these rows a moment ago. Nothing was imported; press Check again.' });
      throw x;
    }
    await audit(req, 'bulk_import', kind, rows.length + ' imported, ' + v.summary.skip + ' skipped, ' + v.summary.error + ' with errors');
    req.session.flash = I.KINDS[kind].label + ': imported ' + rows.length + ', skipped ' + v.summary.skip + ' (already there), ' + v.summary.error + ' with errors not imported.';
    res.redirect(303, '/admin/import?kind=' + kind);
  } catch (e) { next(e); }
});

module.exports = router;
