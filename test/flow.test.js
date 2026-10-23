// Runs the REAL clearanceService and scheduler against in-memory fakes of the models (no MySQL needed).
// The fake decideAtomic mirrors the SQL transaction in models/clearances.js using the same pure rules.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const Module = require('module');
const R = require('../lib/rules');

// bcryptjs is a dependency of the real app; here it is replaced by a tiny fake (password "right" is correct).
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'bcryptjs') return { compare: async (p) => p === 'right' };
  if (req === 'dotenv') return { config() {} };
  return origLoad.call(this, req, ...rest);
};
const fake = (rel, exports) => { const p = require.resolve(path.join('..', rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };

let S, notes, audits, clock = new Date();
const OFFICE_USER = { ACCT: 101, GUID: 102, SAS: 103, CSC: 104, LIB: 105, REG: 106, DEAN: 107 };
const pia = { id: 1, given_name: 'Pia Jane', family_name: 'Lastrollo', student_no: '2022-0001', college: 'CCS' };
const ana = { id: 2, given_name: 'Analiza', family_name: 'Minulas', student_no: '2022-0002', college: 'CCS' };
const detail = (a) => ({ ...a, label: R.labelOf(a), reference_no: S.ref, request_status: 'in_progress', student_id: S.student.id, given_name: S.student.given_name, family_name: S.student.family_name, student_no: S.student.student_no, student_college: 'CCS' });
const lab = (a) => ({ ...a, label: R.labelOf(a) });
const mine = () => S.approvals.map(lab);

fake('models/notifications.js', {
  add: async (u, title, body) => { notes.push({ u, title, body }); },
  addMany: async (us, title, body) => { for (const u of new Set(us)) notes.push({ u, title, body }); },
});
fake('models/audit.js', { write: async (e) => { audits.push(e.action); }, log: async () => {} });
fake('models/certificates.js', { revoke: async () => true });
fake('models/settings.js', { get: async () => ({ dueHours: 48, remindEveryHours: 24, escalateAfterHours: 24, dueSoonHours: 24, escalateToDeptHead: 1, qrValidDays: 90 }) });
fake('models/users.js', {
  hashOf: async () => 'hash', signatureOf: async () => null, adminIds: async () => [999], deptHeadIds: async () => [888],
  recipientsFor: async (a) => (a.office_code === 'INSTRUCTOR' ? [a.instructor_id] : [OFFICE_USER[a.office_code]].filter(Boolean)),
});
fake('models/academics.js', {
  currentTerm: async () => ({ id: 1, label: '1st Sem SY 2026–2027' }),
  enrollmentsFor: async (sid) => S.enroll[sid] || [],
  assignmentsForSubjects: async () => S.assign,
});
fake('models/purposes.js', {
  find: async (id) => ({ id, name: id === 4 ? 'Others' : 'Graduation', requires_explanation: id === 4 ? 1 : 0, instructor_stage: 1, deadline_days: 30, is_active: 1 }),
  signatories: async () => [['ACCT', 1], ['GUID', 1], ['SAS', 1], ['REG', 2], ['DEAN', 3]].map(([office_code, stage]) => ({ office_code, stage })),
});
fake('models/clearances.js', {
  approvalsFor: async () => mine(),
  issuesFor: async () => S.issues,
  approvalScoped: async (id) => { const a = S.approvals.find((x) => x.id === id); return a && detail(a); },
  createWithApprovals: async ({ student, approvals, dueAt }) => {
    S.student = student; S.ref = 'CLR-T'; S.issues = [];
    const min = Math.min(...approvals.map((a) => a.stage));
    S.approvals = approvals.map((a, i) => ({ id: i + 1, request_id: 1, status: 'pending', office_name: a.office_code, instructor_name: a.instructor_id ? 'Inst ' + a.instructor_id : null,
      eligible_at: a.stage === min ? clock : null, due_at: a.stage === min ? dueAt : null, ...a }));
    return { id: 1, reference: 'CLR-T' };
  },
  decideAtomic: async ({ approvalId, action, remarks, kind, dueHours }) => {
    const err = R.evaluateAction(mine(), S.issues, approvalId, action, remarks);
    if (err) return { ok: false, errors: [err] };
    const t = S.approvals.find((a) => a.id === approvalId);
    if (action === 'clear') { t.status = 'cleared'; S.issues.filter((i) => i.approval_id === t.id).forEach((i) => (i.status = 'resolved')); }
    else if (action === 'hold') { t.status = 'on_hold'; S.issues.push({ approval_id: t.id, status: 'open', description: remarks, kind }); }
    else t.status = 'pending';
    const after = mine();
    const complete = R.isComplete(after) && !S.issues.some((i) => i.status === 'open');
    const ids = complete ? [] : R.nextEligible(after, S.issues);
    S.approvals.filter((a) => ids.includes(a.id)).forEach((a) => { a.eligible_at = clock; a.due_at = R.dueAt(clock, dueHours); });
    return { ok: true, target: lab(t), after, complete, newlyEligible: mine().filter((a) => ids.includes(a.id)) };
  },
  overdueCandidates: async () => mine().filter((a) => a.status !== 'cleared' && a.due_at).map(detail),
  markReminded: async (id) => { const a = S.approvals.find((x) => x.id === id); a.last_reminder_at = clock; a.reminder_count = (a.reminder_count || 0) + 1; },
  markEscalated: async (id) => { S.approvals.find((x) => x.id === id).escalated_at = clock; },
  markDueSoon: async (id) => { S.approvals.find((x) => x.id === id).due_soon_notified_at = clock; },
});
const Service = require('../services/clearanceService');
const Scheduler = require('../services/scheduler');

// BSIT 2C (section 10): Noel(100) teaches subject 1. BSIT 2D (section 11): Four(200) teaches subject 1.
function reset() {
  notes = []; audits = []; clock = new Date();
  S = { approvals: [], issues: [], enroll: {
    1: [{ subject_id: 1, section_id: 10, term_id: 1, subject_code: 'CCIT 106' }],
    2: [{ subject_id: 1, section_id: 11, term_id: 1, subject_code: 'CCIT 106' }],
  }, assign: [{ instructor_id: 100, subject_id: 1, section_id: 10, term_id: 1 }, { instructor_id: 200, subject_id: 1, section_id: 11, term_id: 1 }] };
}
const by = (c) => S.approvals.find((a) => a.office_code === c);
const sign = (c, extra = {}) => Service.decide({ approvalId: by(c).id, user: { id: 5, role: 'staff', office_code: c }, action: 'clear', password: 'right', confirm: 'yes', ...extra });

test('scenario 1+5: only the instructor of the student\'s real subject+section is a signatory and is notified', async () => {
  reset();
  assert.ok((await Service.submit({ student: pia, purposeId: 1, purposeOther: '' })).ok);
  assert.ok(S.approvals.some((a) => a.instructor_id === 100));
  assert.ok(!S.approvals.some((a) => a.instructor_id === 200));
  assert.ok(notes.some((n) => n.u === 100 && n.title === 'New clearance request'));
  assert.ok(!notes.some((n) => n.u === 200));
  // registrar/dean are NOT notified yet: they are not eligible
  assert.ok(!notes.some((n) => n.u === 106 || n.u === 107));
  reset();
  await Service.submit({ student: ana, purposeId: 1, purposeOther: '' });
  assert.ok(S.approvals.some((a) => a.instructor_id === 200) && !S.approvals.some((a) => a.instructor_id === 100));
});

test('submission needs enrollment and an explanation for "Others"', async () => {
  reset();
  assert.match((await Service.submit({ student: { ...pia, id: 77 }, purposeId: 1, purposeOther: '' })).errors._form, /not enrolled/);
  const r = await Service.submit({ student: pia, purposeId: 4, purposeOther: '' });
  assert.ok(r.errors.purpose_other);
});

test('scenarios 7+8: registrar and dean cannot sign early; backend refuses even if the button was forced', async () => {
  reset(); await Service.submit({ student: pia, purposeId: 1, purposeOther: '' });
  let r = await sign('REG'); assert.strictEqual(r.ok, false); assert.match(r.errors[0], /Outstanding/);
  r = await sign('DEAN'); assert.strictEqual(r.ok, false);
  for (const c of ['ACCT', 'GUID', 'SAS']) assert.ok((await sign(c)).ok);
  assert.strictEqual((await sign('REG')).ok, false); // instructor still pending
  assert.ok((await Service.decide({ approvalId: S.approvals.find((a) => a.instructor_id).id, user: { id: 100, role: 'instructor' }, action: 'clear', password: 'right', confirm: 'yes' })).ok);
  assert.strictEqual((await sign('DEAN')).ok, false); // registrar has not signed
  assert.ok((await sign('REG')).ok);
  assert.ok((await sign('DEAN')).ok);
});

test('scenario 9+13: final clearance only after the dean; student and admin notified; audit kept', async () => {
  reset(); await Service.submit({ student: pia, purposeId: 1, purposeOther: '' });
  for (const c of ['ACCT', 'GUID', 'SAS']) await sign(c);
  await Service.decide({ approvalId: S.approvals.find((a) => a.instructor_id).id, user: { id: 100, role: 'instructor' }, action: 'clear', password: 'right', confirm: 'yes' });
  assert.ok(notes.some((n) => n.u === 106 && n.title === 'Ready for your signature'));
  assert.ok(notes.some((n) => n.u === 1 && /Next: /.test(n.title)));
  const reg = await sign('REG'); assert.strictEqual(reg.ok, true);
  assert.ok(!notes.some((n) => n.title === 'Clearance completed'));
  const dean = await sign('DEAN'); assert.ok(dean.ok); assert.match(dean.message, /final signature/);
  assert.ok(notes.some((n) => n.u === 1 && n.title === 'Clearance completed'));
  assert.ok(notes.some((n) => n.u === 999 && n.title === 'Clearance completed'));
});

test('scenarios 6+11: an On Hold blocks dependents; only the signatory clearing it re-enables the next stage', async () => {
  reset(); await Service.submit({ student: pia, purposeId: 1, purposeOther: '' });
  const bad = await Service.decide({ approvalId: by('ACCT').id, user: { id: 5, role: 'staff', office_code: 'ACCT' }, action: 'hold', remarks: '' });
  assert.strictEqual(bad.ok, false);
  const hold = await Service.decide({ approvalId: by('ACCT').id, user: { id: 5, role: 'staff', office_code: 'ACCT' }, action: 'hold', remarks: 'Unpaid lab fee', kind: 'financial' });
  assert.ok(hold.ok);
  assert.ok(notes.some((n) => n.u === 1 && /On Hold/.test(n.title) && /Unpaid lab fee/.test(n.body)));
  for (const c of ['GUID', 'SAS']) await sign(c);
  await Service.decide({ approvalId: S.approvals.find((a) => a.instructor_id).id, user: { id: 100, role: 'instructor' }, action: 'clear', password: 'right', confirm: 'yes' });
  assert.strictEqual((await sign('REG')).ok, false); // ACCT still on hold
  assert.ok((await sign('ACCT')).ok);                 // resolved and verified by the signatory
  assert.ok((await sign('REG')).ok);
});

test('scenario 12: e-signature needs confirmation and the right password; nothing is changed otherwise', async () => {
  reset(); await Service.submit({ student: pia, purposeId: 1, purposeOther: '' });
  assert.match((await sign('ACCT', { confirm: '' })).errors[0], /confirm/);
  assert.match((await sign('ACCT', { password: 'wrong' })).errors[0], /password is incorrect/);
  assert.strictEqual(by('ACCT').status, 'pending');
  assert.ok(audits.includes('signature_denied'));
  const dept = await Service.decide({ approvalId: by('ACCT').id, user: { id: 9, role: 'staff', office_code: 'DEPT' }, action: 'clear', password: 'right', confirm: 'yes' });
  assert.strictEqual(dept.ok, false);
});

test('scenario 10: overdue reminders/escalation notify but NEVER approve or change the status', async () => {
  reset(); await Service.submit({ student: pia, purposeId: 1, purposeOther: '' });
  await Service.decide({ approvalId: by('GUID').id, user: { id: 6, role: 'staff', office_code: 'GUID' }, action: 'hold', remarks: 'Missing form' });
  notes.length = 0;
  const t1 = new Date(Date.now() + 49 * 3600e3); clock = t1;
  let r = await Scheduler.runOnce(t1);
  assert.ok(r.reminded >= 3 && r.escalated === 0);
  assert.ok(notes.some((n) => n.u === 102 && /Overdue/.test(n.title)));   // the held signatory is still chased
  assert.ok(!notes.some((n) => n.u === 106));                              // registrar is blocked: not blamed
  const t2 = new Date(Date.now() + 75 * 3600e3); clock = t2;
  r = await Scheduler.runOnce(t2);
  assert.ok(r.escalated >= 3);
  assert.ok(notes.some((n) => n.u === 999 && /Escalation/.test(n.title)) && notes.some((n) => n.u === 888));
  assert.strictEqual(by('GUID').status, 'on_hold');                        // underlying state preserved
  assert.ok(S.approvals.every((a) => a.status !== 'cleared'));            // nothing auto-approved
});

test('deadline approaching heads-up is sent once', async () => {
  reset(); await Service.submit({ student: pia, purposeId: 1, purposeOther: '' });
  const t = new Date(Date.now() + 40 * 3600e3); clock = t; notes.length = 0;
  let r = await Scheduler.runOnce(t); assert.ok(r.dueSoon >= 3);
  r = await Scheduler.runOnce(t); assert.strictEqual(r.dueSoon, 0);
});
