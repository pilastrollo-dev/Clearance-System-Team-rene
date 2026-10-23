// Renders every view with realistic data (including error states) and checks key UI behaviours.
// Uses the real `ejs` package when installed (npm install); otherwise a tiny compatible renderer, so it also runs offline.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
let render;
try { const ejs = require('ejs'); render = (f, d) => ejs.render(fs.readFileSync(f, 'utf8'), d, { filename: f }); } catch (e) { render = require('./helpers/miniEjs').render; }
const V = path.join(__dirname, '..', 'views') + '/';

const d0 = new Date('2026-10-21T08:00:00Z'), later = new Date('2026-10-23T08:00:00Z');
const R = require('../lib/rules');
const base = { user: { id: 1, role: 'admin', given_name: 'A', family_name: 'B', office_code: null }, csrf: 'tok', flash: null, term: '1st Sem SY 2026–2027', unread: 2, fmt: (d) => (d ? 'D' : '—'), errors: {}, old: {}, clearDraft: '' };
const ap = (o) => ({ id: 1, request_id: 1, office_code: 'ACCT', stage: 1, status: 'pending', eligible_at: d0, due_at: later, label: 'Accounting', ...o });
const rows = [ap({}), ap({ id: 2, status: 'on_hold', remarks: 'Unpaid', label: 'Guidance' }), ap({ id: 3, stage: 2, status: 'pending', eligible_at: null, due_at: null, label: 'Registrar' }), ap({ id: 4, stage: 3, status: 'cleared', acted_at: d0, label: 'Dean' })].map((a) => ({ ...a, overdue: true, blocked: 'blocked msg' }));
const issues = [{ approval_id: 2, status: 'open', description: 'Unpaid', kind: 'financial', office_code: 'GUID', raised_at: d0 }];
const req = { id: 1, reference_no: 'CLR-1', purpose: 'Graduation', purpose_other: null, status: 'in_progress', created_at: d0, deadline_at: later, completed_at: null, semester: '1st Sem', academic_year: '2026-2027' };
const prog = { id: 1, code: 'BSIT', name: 'BSIT', college: 'CCS' }, sec = { id: 1, program_id: 1, year_level: 2, label: 'BSIT 2C', name: 'C' };
const stats = { totals: { total: 3, in_progress: 1, completed: 1, pending: 1, on_hold: 1, awaiting_registrar: 0, awaiting_dean: 0, overdue: 1, avg_hours: 50 }, openIssues: 1, byPurpose: [{ k: 'Graduation', n: 2 }], byTerm: [{ k: 'x', n: 1 }], byGroup: [{ k: 'g', n: 1 }], bySigner: [{ k: 'Acct', pending: 1, on_hold: 0, cleared: 2, avg_hours: 3 }], byInstructor: [{ k: 'Noel', pending: 1, on_hold: 0, cleared: 0 }] };
const staffRow = { ...ap({}), given_name: 'Pia', family_name: 'L', student_no: '1', section_label: 'BSIT 2C', purpose: 'Graduation', reference_no: 'CLR-1', submitted_at: d0, overdue: true, student_college: 'CCS', request_status: 'in_progress', year_level: 2 };
const person = { id: 5, given_name: 'Pia', family_name: 'L', section_id: 1, section_label: 'BSIT 2C', email: 'p@my.cspc.edu.ph', email_status: 'unverified' };
const sub = [{ id: 1, code: 'CCIT 106', title: 'T' }]; const en = [{ id: 1, subject_code: 'CCIT 106', title: 'T', section_label: 'BSIT 2C', instructors: 'Noel', subject_id: 1 }];
const cert = { id: 1, token: 'a'.repeat(32), issued_at: d0, expires_at: later, revoked_at: null, used_at: null, reference_no: 'CLR-1', purpose: 'Graduation', semester: '1st Sem', academic_year: '2026-2027', given_name: 'Pia', family_name: 'L', student_no: '1', college: 'CCS' };
const userForm = { mode: 'new', title: 'x', suggestions: ['a@my.cspc.edu.ph'], userId: 0, target: null, roles: ['student', 'instructor', 'staff', 'admin'], programs: [prog], sections: [sec], offices: [{ code: 'ACCT', name: 'Acct' }] };
const cases = [
  ['login', { errors: ['bad'], old: { email: 'x' } }],
  ['error', { heading: 'h', message: 'm' }],
  ['notifications', { items: [{ id: 1, title: 't', body: 'b', is_read: 0, created_at: d0, reference_no: 'CLR-1' }] }],
  ['account/password', { errors: { current: 'x', password: 'y', password2: 'z' }, user: { ...base.user, must_change: true } }],
  ['student/dashboard', { user: { ...base.user, role: 'student' }, profile: { given_name: 'P', family_name: 'L', student_no: '1', program_code: 'BSIT', year_level: 2, section_label: 'BSIT 2C', college: 'CCS', email: 'e', email_status: 'verified' }, list: [{ id: 1, reference_no: 'CLR-1', created_at: d0, purpose: 'G', semester: '1st', academic_year: '2026', done: 1, total: 4, deadline_at: d0, status: 'in_progress' }], enrollments: en, openId: 1 }],
  ['student/dashboard', { user: { ...base.user, role: 'student' }, profile: { given_name: 'P', family_name: 'L', email: 'e', email_status: 'unverified' }, list: [], enrollments: [], openId: null }],
  ['student/new', { errors: { _form: 'f', purpose_id: 'p', purpose_other: 'o' }, old: { purpose_id: '1', purpose_other: 'x' }, purposes: [{ id: 1, name: 'Graduation', instructor_stage: 1 }], byPurpose: { 1: [{ name: 'Acct', stage: 1 }] }, enrollments: en }],
  ['student/detail', { request: req, rows, issues, progress: R.progress(rows), cert: cert, certStatus: 'valid', qr: 'data:x', verifyUrl: 'http://x', requestOverdue: true }],
  ['staff/inbox', { rows: [staffRow], f: { view: 'action', q: '', subject_id: 0, section_id: 0 }, assignments: [{ subject_code: 'C', title: 't', section_label: 's', year_level: 2, students: 3 }], subjects: [{ id: 1, label: 'C' }], sections: [{ id: 1, label: 's' }], isDept: false }],
  ['staff/students', { students: [{ given_name: 'P', family_name: 'L', student_no: '1', subject_code: 'C', section_label: 's', clearance_status: 'in_progress', my_status: 'pending' }], f: { q: '', subject_id: 0, section_id: 0 }, subjects: [], sections: [] }],
  ['staff/detail', { a: staffRow, all: rows, issues, errors: { password: 'wrong', remarks: 'r' }, old: { action: 'clear', remarks: 'r', kind: 'general' }, overdue: true, blocked: 'blocked', readOnly: false, laterSigned: false, hasSignature: false }],
  ['staff/detail', { a: { ...staffRow, status: 'cleared' }, all: rows, issues: [], errors: {}, old: { action: '', remarks: '', kind: 'general' }, overdue: false, blocked: null, readOnly: true, laterSigned: true, hasSignature: true }],
  ['admin/dashboard', { counts: { student: 2 }, stats, overdue: [{ ...staffRow, hours: 5 }], settings: { dueHours: 48, dueSoonHours: 24, remindEveryHours: 24, escalateAfterHours: 24, escalateToDeptHead: 1 } }],
  ['admin/users', { users: [{ id: 2, given_name: 'A', family_name: 'B', email: 'e', email_status: 'verified', role: 'student', office_code: null, student_no: '1', section_label: 'x', is_active: 1, is_sample: 1 }], q: '', role: '', roles: ['student'] }],
  ['admin/user_form', { ...userForm, errors: { email: 'dup', password: 'weak', password2: 'mismatch', student_no: 'x' }, old: { role: 'student', given_name: 'Pia', family_name: 'L', email: 'pilastrollo@my.cspc.edu.ph', student_no: '1', temp_password: '' } }],
  ['admin/user_form', { ...userForm, mode: 'edit', userId: 9, target: { email_status: 'verified' }, errors: {}, suggestions: [], old: { role: 'instructor', given_name: 'N' } }],
  ['admin/user_created', { created: { id: 3, role: 'student', office_code: null, given_name: 'P', family_name: 'L', email: 'e' }, tempPassword: 'abc#Aa1' }],
  ['admin/enrollment', { person, currentTerm: { label: 'T' }, items: en, subjects: sub, sections: [sec], errors: { subject_id: 'x' }, old: {} }],
  ['admin/assignments', { person, currentTerm: { label: 'T' }, items: [{ id: 1, subject_code: 'C', title: 't', section_label: 's', students: 2 }], subjects: sub, sections: [sec], errors: {}, old: {} }],
  ['admin/academics', { terms: [{ id: 1, label: 'T', is_current: 1 }, { id: 2, label: 'U', is_current: 0 }], programs: [prog], sections: [sec], subjects: sub, form: 'program', errors: { code: 'bad' }, old: { code: 'x' } }],
  ['admin/purposes', { purposes: [{ id: 1, name: 'Graduation', is_active: 1, requires_explanation: 0, instructor_stage: 1, deadline_days: 30, stages: { ACCT: 1 } }], offices: [{ code: 'ACCT', name: 'Acct', is_active: 1 }], errPurpose: 1, errors: { name: 'n', signatories: 's' }, newErr: null }],
  ['admin/settings', { fields: [['due_hours', 'Hours', 1, 720]], errors: { due_hours: 'bad' }, old: { due_hours: 'x', escalate_to_dept_head: '1' } }],
  ['admin/clearances', { rows: [{ id: 1, reference_no: 'CLR-1', created_at: d0, given_name: 'P', family_name: 'L', student_no: '1', purpose: 'G', done: 1, total: 2, open_issues: 1, status: 'completed', certStatus: 'valid', cert }] }],
  ['admin/revoke', { cert, errors: { reason: 'r', password: 'p' }, old: { reason: 'x' } }],
  ['admin/audit', { rows: [{ created_at: d0, actor_label: 'a', action: 'x', reference_no: 'CLR-1', details: 'd' }], q: '', requestNo: '' }],
  ['reports', { stats, rows: [{ reference_no: 'CLR-1', created_at: d0, given_name: 'P', family_name: 'L', student_no: '1', purpose: 'G', program: 'BSIT', year_level: 2, section: 'C', done: 1, total: 2, open_issues: 0, status: 'completed' }], terms: [{ id: 1, label: 'T' }], purposes: [{ id: 1, name: 'G' }], programs: [prog], sections: [sec], offices: [{ code: 'ACCT', name: 'A' }], f: { from: '', to: '', term_id: '', purpose_id: '', program_id: '', section_id: '', office: '', status: '' }, qs: '' }],
  ['form', { request: { ...req, status: 'completed', completed_at: d0 }, rows, issues, student: { given_name: 'P', middle_name: 'J', family_name: 'L', student_no: '1', program: 'BSIT', year_level: 2, section_label: 'BSIT 2C' }, signatures: { 4: { given_name: 'R', family_name: 'O', signed_at: d0, signature_hash: 'a'.repeat(64) } }, cert, certStatus: 'revoked', qr: 'data:x', verifyUrl: 'http://x' }],
  ['admin/subject_edit', { subject: { id: 1, code: 'CCIT 106', title: 'T' }, usage: { enrollments: 0, assignments: 0, approvals: 0 }, errors: { code: 'dup' }, old: { code: 'CCIT 1o6', title: 'T' } }],
  ['admin/subject_edit', { subject: { id: 1, code: 'CCIT 106', title: 'T' }, usage: { enrollments: 3, assignments: 1, approvals: 2 }, errors: {}, old: { code: 'CCIT 106', title: 'T' } }],
  ['admin/import', { kinds: { subjects: { label: 'Subjects' }, enrollments: { label: 'Student enrollments' }, assignments: { label: 'Teaching assignments' } }, kind: 'subjects', text: 'code,title\nA,B', results: null, summary: null, info: '', error: 'oops' }],
  ['admin/import', { kinds: { subjects: { label: 'Subjects' }, enrollments: { label: 'Student enrollments' }, assignments: { label: 'Teaching assignments' } }, kind: 'enrollments', text: 'a,b,c', info: 'Read 2 lines', error: '', summary: { ok: 1, skip: 1, error: 1 },
    results: [{ line: 2, cells: ['a', 'b', 'c'], status: 'ok', message: 'Will be enrolled.' }, { line: 3, cells: ['a'], status: 'skip', message: 'Already' }, { line: 4, cells: ['x'], status: 'error', message: 'Unknown <b>subject</b>' }] }],
  ['account/signature', { current: null, error: '', user: { ...base.user, role: 'instructor' } }],
  ['account/signature', { current: 'data:image/png;base64,iVBORw0KGgo=', error: 'bad', user: { ...base.user, role: 'staff' } }],
  ['verify', { status: 'valid', cert: { ...cert, used_by_given: null }, canUse: true }],
  ['verify', { status: 'invalid', cert: null, canUse: false }],
];

const html = (name, i = 0) => { const c = cases.filter((x) => x[0] === name)[i]; return render(V + name + '.ejs', { ...base, title: name, ...c[1] }); };

test('every view renders without errors and without leaking "undefined"', () => {
  const seen = {};
  for (const [n, d] of cases) {
    const i = (seen[n] = (seen[n] || 0)); seen[n]++;
    const out = render(V + n + '.ejs', { ...base, title: n, ...d });
    assert.ok(out.length > 200, n + ' rendered too little');
    assert.ok(!/undefined|\[object Object\]/.test(out), n + '[' + i + '] leaked undefined');
  }
});

test('admin form after an error keeps typed values, highlights fields, never refills passwords', () => {
  const uf = html('admin/user_form');
  assert.match(uf, /id="given_name" name="given_name" type="text" value="Pia"/);
  assert.match(uf, /value="pilastrollo@my.cspc.edu.ph"/);
  assert.match(uf, /name="student_no" type="text" value="1"/);
  assert.ok(!/type="password"[^>]*value="[^"]+"/.test(uf));
  assert.match(uf, /id="password2-err"[^>]*>[^<]*mismatch/);
  assert.match(uf, /aria-invalid="true"/);
  assert.match(uf, /class="invalid"/);
  assert.match(uf, /data-suggest="a@my.cspc.edu.ph"/);
  assert.match(uf, /data-pw-check/);
  assert.match(uf, /data-toggle-pw="password"/);
});

test('signatory screen blocks clearing when earlier stages are open, and locks after a later signature', () => {
  const sd = html('staff/detail');
  assert.match(sd, /blocked/);
  assert.match(sd, /value="clear"[^>]*disabled/);
  assert.ok(!/name="password"[^>]*value=/.test(sd));
  assert.ok(!/<form method="POST" action="\/staff/.test(html('staff/detail', 1)));
});

test('student page shows the compliance issue, locked later stages and the QR panel', () => {
  const st = html('student/detail');
  assert.match(st, /What you need to resolve/);
  assert.match(st, /Not started: waiting for earlier stages/);
  assert.match(st, /QR verification/);
});

test('printable form and verify page', () => {
  const fm = html('form');
  assert.match(fm, /REVOKED/); assert.match(fm, /aaaaaaaaaa/); assert.match(fm, /QR verification code/);
  const vf = html('verify', 0);
  assert.match(vf, /VALID/); assert.match(vf, /mark as used/i);
  assert.match(html('verify', 1), /NOT FOUND/);
});

test('user-supplied text is HTML-escaped (no XSS)', () => {
  const out = render(V + 'admin/audit.ejs', { ...base, title: 't', rows: [{ created_at: new Date(), actor_label: '<script>alert(1)</script>', action: 'x', details: '"><img src=x onerror=1>' }], q: '', requestNo: '' });
  assert.ok(!/<script>alert/.test(out));
  assert.ok(!/<img src=x/.test(out));
});

test('bulk import preview shows each status and escapes row text', () => {
  const out = html('admin/import', 1);
  assert.match(out, /1 will import/); assert.match(out, /Import 1 valid row/); assert.match(out, /Already/);
  assert.ok(!/<b>subject<\/b>/.test(out));                       // message text is escaped
  assert.ok(!/<option value="">/.test(out));                      // the type selector has no blank choice
});

test('subject edit screen allows delete only when unused', () => {
  assert.match(html('admin/subject_edit', 0), /Delete this subject/);
  assert.ok(!/Delete this subject/.test(html('admin/subject_edit', 1)));
  assert.match(html('admin/subject_edit', 1), /cannot be deleted/);
});

test('printable form shows a saved signature image but refuses unsafe ones', () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
  const mk = (img) => render(V + 'form.ejs', { ...base, title: 'f', ...cases.filter((x) => x[0] === 'form')[0][1], signatures: { 4: { given_name: 'R', family_name: 'O', signed_at: new Date(), signature_hash: 'a'.repeat(64), signature_image: img } } });
  assert.match(mk(png), /<img src="data:image\/png;base64,iVBOR/);
  assert.ok(!/<img src="javascript/.test(mk('javascript:alert(1)')));
  assert.ok(!/image\/svg/.test(mk('data:image/svg+xml;base64,PHN2Zz4=')));
});
