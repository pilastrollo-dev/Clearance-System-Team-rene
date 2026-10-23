const test = require('node:test');
const assert = require('node:assert');
const R = require('../lib/rules');
const E = require('../lib/emailGen');
const { instructorSignatories } = require('../lib/enrollment');

let id = 1;
const mk = (code, stage, status = 'pending', extra = {}) => ({ id: id++, office_code: code, office_name: code, stage, status, ...extra });
const set = (over = {}) => {
  const st = { ACCT: 'cleared', GUID: 'cleared', SAS: 'cleared', INSTRUCTOR: 'cleared', REG: 'pending', DEAN: 'pending', ...over };
  return [mk('ACCT', 1, st.ACCT), mk('GUID', 1, st.GUID), mk('SAS', 1, st.SAS), mk('INSTRUCTOR', 1, st.INSTRUCTOR, { instructor_name: 'Noel', subject_label: 'CCIT 106' }),
    mk('REG', 2, st.REG), mk('DEAN', 3, st.DEAN)];
};
const by = (all, c) => all.find((a) => a.office_code === c);
const issue = (d = 'Unpaid lab fee') => ({ status: 'open', description: d });

// ---- Email generation (scenario 2, 3) ----
test('student e-mail = first two letters of first name + surname', () => {
  assert.strictEqual(E.suggest('student', { given_name: 'Pia Jane', family_name: 'Lastrollo' }).email, 'pilastrollo@my.cspc.edu.ph');
  assert.strictEqual(E.suggest('student', { given_name: 'Juan', family_name: 'Dela Cruz' }).email, 'judelacruz@my.cspc.edu.ph');
  assert.strictEqual(E.suggest('student', { given_name: 'Maria', family_name: 'Santos' }).email, 'masantos@my.cspc.edu.ph');
  assert.strictEqual(E.suggest('student', { given_name: 'Ana', family_name: 'Reyes' }).email, 'anreyes@my.cspc.edu.ph');
});
test('instructor/staff e-mail = full name without spaces; accents and punctuation removed', () => {
  assert.strictEqual(E.suggest('instructor', { given_name: 'Juan', family_name: 'Dela Cruz' }).email, 'juandelacruz@my.cspc.edu.ph');
  assert.strictEqual(E.suggest('staff', { given_name: 'María José', family_name: "O'Neil-Peña" }).email, 'mariajoseoneilpena@my.cspc.edu.ph');
});
test('duplicate e-mail: flagged and alternatives suggested (middle initial, then number)', () => {
  const taken = new Set(['pilastrollo@my.cspc.edu.ph']);
  const s = E.suggest('student', { given_name: 'Pia', middle_name: 'Jane', family_name: 'Lastrollo' }, taken);
  assert.strictEqual(s.isTaken, true);
  assert.strictEqual(s.alternatives[0], 'pijlastrollo@my.cspc.edu.ph');
  taken.add('pijlastrollo@my.cspc.edu.ph');
  assert.strictEqual(E.suggest('student', { given_name: 'Pia', middle_name: 'Jane', family_name: 'Lastrollo' }, taken).alternatives[0], 'pilastrollo2@my.cspc.edu.ph');
  assert.strictEqual(E.suggest('student', { given_name: '', family_name: 'X' }).email, '');
});

// ---- Enrollment-based instructors (scenario 1, 5) ----
test('only instructors teaching the student\'s actual subject+section+term are signatories', () => {
  const enr = [{ subject_id: 1, section_id: 10, term_id: 1, subject_code: 'CCIT 106' }];
  const assign = [
    { instructor_id: 100, subject_id: 1, section_id: 10, term_id: 1 }, // Nasreno handles BSIT 2C
    { instructor_id: 200, subject_id: 1, section_id: 11, term_id: 1 }, // handles BSIT 2D only
    { instructor_id: 300, subject_id: 2, section_id: 10, term_id: 1 }, // different subject
    { instructor_id: 400, subject_id: 1, section_id: 10, term_id: 0 }, // old term
  ];
  const r = instructorSignatories(enr, assign);
  assert.deepStrictEqual(r.map((x) => x.instructor_id), [100]);
});

// ---- Sequential workflow (scenarios 6, 7, 8, 11) ----
test('Registrar is blocked until every earlier approval is cleared', () => {
  const all = set({ GUID: 'on_hold' });
  assert.match(R.blockedReason(by(all, 'REG'), all, [issue()]), /every earlier approval/);
  assert.match(R.evaluateAction(all, [], by(all, 'REG').id, 'clear'), /Outstanding/);
});
test('Registrar may sign when stage 1 is complete', () => {
  const all = set();
  assert.strictEqual(R.evaluateAction(all, [], by(all, 'REG').id, 'clear'), null);
});
test('Dean is blocked until the Registrar has signed', () => {
  const all = set();
  assert.match(R.evaluateAction(all, [], by(all, 'DEAN').id, 'clear'), /College Registrar|REG/);
  const ok = set({ REG: 'cleared' });
  assert.strictEqual(R.evaluateAction(ok, [], by(ok, 'DEAN').id, 'clear'), null);
});
test('an open compliance issue blocks later stages even if everything else is cleared', () => {
  const all = set({ REG: 'cleared' });
  assert.match(R.evaluateAction(all, [issue()], by(all, 'DEAN').id, 'clear'), /compliance/i);
});
test('stage-1 items are never blocked, and a hold needs a reason', () => {
  const all = set({ GUID: 'pending' });
  assert.strictEqual(R.evaluateAction(all, [], by(all, 'GUID').id, 'clear'), null);
  assert.match(R.evaluateAction(all, [], by(all, 'GUID').id, 'hold', ''), /Explain/);
  assert.strictEqual(R.evaluateAction(all, [], by(all, 'GUID').id, 'hold', 'Missing form'), null);
});
test('compliance resolution: clearing a held item re-enables the next stage', () => {
  let all = set({ GUID: 'on_hold' });
  assert.notStrictEqual(R.blockedReason(by(all, 'REG'), all, [issue()]), null);
  by(all, 'GUID').status = 'cleared';
  assert.strictEqual(R.blockedReason(by(all, 'REG'), all, []), null);
});
test('a cleared item cannot be changed after a later stage signed', () => {
  const all = set({ REG: 'cleared' });
  assert.match(R.evaluateAction(all, [], by(all, 'GUID').id, 'pending'), /revoke/);
  assert.match(R.evaluateAction(all, [], by(all, 'GUID').id, 'hold', 'some reason'), /revoke/);
});
test('configurable sequence: stages other than 1-2-3 are honoured', () => {
  const all = [mk('A', 1, 'cleared'), mk('B', 2, 'pending'), mk('C', 2, 'pending'), mk('D', 4, 'pending')];
  assert.strictEqual(R.blockedReason(all[2], all, []), null);   // same stage as B: parallel
  assert.match(R.blockedReason(all[3], all, []), /Outstanding/);
});
test('nextEligible lists items whose earlier stages just completed', () => {
  const all = set(); // stage1 done; REG eligible, DEAN not
  all.filter((a) => a.stage === 1).forEach((a) => (a.eligible_at = new Date()));
  assert.deepStrictEqual(R.nextEligible(all), [by(all, 'REG').id]);
});
test('isComplete / progress', () => {
  assert.strictEqual(R.isComplete(set({ REG: 'cleared', DEAN: 'cleared' })), true);
  assert.strictEqual(R.isComplete(set()), false);
  assert.strictEqual(R.progress(set()).done, 4);
});

// ---- Overdue (scenario 10) ----
test('overdue is derived and preserves the underlying status', () => {
  const now = new Date('2026-10-21T12:00:00Z');
  const a = { status: 'on_hold', due_at: new Date(now.getTime() - 3600e3) };
  assert.strictEqual(R.isOverdue(a, now), true);
  assert.strictEqual(a.status, 'on_hold');
  assert.strictEqual(R.isOverdue({ status: 'cleared', due_at: a.due_at }, now), false);
});
test('follow-ups: due-soon heads-up, reminder, one escalation; never approves', () => {
  const cfg = { remindEveryHours: 24, escalateAfterHours: 24, dueSoonHours: 24 };
  const now = new Date('2026-10-21T12:00:00Z');
  const h = (n) => new Date(now.getTime() + n * 3600e3);
  const base = { status: 'pending', last_reminder_at: null, escalated_at: null, due_soon_notified_at: null };
  let r = R.followUps([{ ...base, due_at: h(5) }], now, cfg);
  assert.ok(r[0].dueSoon && !r[0].remind);
  assert.deepStrictEqual(R.followUps([{ ...base, due_at: h(5), due_soon_notified_at: h(-1) }], now, cfg), []);
  assert.deepStrictEqual(R.followUps([{ ...base, due_at: h(60) }], now, cfg), []);
  r = R.followUps([{ ...base, due_at: h(-2) }], now, cfg);
  assert.ok(r[0].remind && !r[0].escalate);
  r = R.followUps([{ ...base, status: 'on_hold', due_at: h(-30) }], now, cfg);
  assert.ok(r[0].remind && r[0].escalate);
  assert.deepStrictEqual(R.followUps([{ ...base, due_at: h(-30), last_reminder_at: h(-2), escalated_at: h(-5) }], now, cfg), []);
  assert.deepStrictEqual(R.followUps([{ ...base, status: 'cleared', due_at: h(-60) }], now, cfg), []);
});

// ---- Passwords, QR status ----
test('password policy', () => {
  assert.deepStrictEqual(R.validatePassword('Teamrene@2026'), []);
  assert.ok(R.validatePassword('short').length >= 3);
  assert.ok(R.validatePassword('alllowercase1!').includes('One uppercase letter'));
  assert.ok(R.validatePassword(undefined).length > 0);
});
test('certificate status precedence: revoked > used > expired > valid', () => {
  const now = new Date('2026-10-21T00:00:00Z'), future = new Date('2027-01-01'), past = new Date('2026-01-01');
  assert.strictEqual(R.certStatus({ expires_at: future }, now), 'valid');
  assert.strictEqual(R.certStatus({ expires_at: past }, now), 'expired');
  assert.strictEqual(R.certStatus({ expires_at: future, used_at: past }, now), 'used');
  assert.strictEqual(R.certStatus({ expires_at: past, used_at: past, revoked_at: past }, now), 'revoked');
  assert.strictEqual(R.certStatus(null, now), 'invalid');
});
