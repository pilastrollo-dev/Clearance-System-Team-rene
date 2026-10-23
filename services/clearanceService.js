// Orchestrates the clearance flow: rules + database + notifications. Rules themselves live in lib/rules.js.
const bcrypt = require('bcryptjs');
const R = require('../lib/rules');
const { instructorSignatories } = require('../lib/enrollment');
const Users = require('../models/users');
const Academics = require('../models/academics');
const Purposes = require('../models/purposes');
const Settings = require('../models/settings');
const Clearances = require('../models/clearances');
const Certs = require('../models/certificates');
const Notify = require('../models/notifications');
const Audit = require('../models/audit');

const fullName = (a) => a.given_name + ' ' + a.family_name;
const KINDS = ['general', 'property', 'financial'];

async function notifyApprovals(approvals, request, student, title, body) {
  const missing = [];
  for (const a of approvals) {
    const to = await Users.recipientsFor({ office_code: a.office_code, instructor_id: a.instructor_id, student_college: student.college });
    if (!to.length) { missing.push(a.label); continue; }
    await Notify.addMany(to, title, body, '/staff/approvals/' + a.id, request.id);
  }
  if (missing.length) {
    await Notify.addMany(await Users.adminIds(), 'No signer assigned', 'Request ' + request.reference_no + ' needs: ' + missing.join('; ') + '. Assign someone.', '/admin/users', request.id);
  }
}

// Student submits. Signatories come from the purpose configuration + the student's ACTUAL enrollment.
async function submit({ student, purposeId, purposeOther, ip }) {
  const purpose = await Purposes.find(purposeId);
  const errors = {};
  if (!purpose || !purpose.is_active) errors.purpose_id = 'Choose a purpose.';
  else if (purpose.requires_explanation && purposeOther.length < 3) errors.purpose_other = 'Please explain the purpose (at least 3 characters).';
  if (purposeOther.length > 120) errors.purpose_other = 'Keep the explanation under 120 characters.';
  if (Object.keys(errors).length) return { ok: false, errors };

  const term = await Academics.currentTerm();
  if (!term) return { ok: false, errors: { _form: 'No current academic term is set. Please tell the administrator.' } };

  const approvals = (await Purposes.signatories(purpose.id)).map((o) => ({ office_code: o.office_code, stage: o.stage }));
  let skipped = [];
  if (purpose.instructor_stage != null) {
    const enr = await Academics.enrollmentsFor(student.id, term.id);
    if (!enr.length) return { ok: false, errors: { _form: 'You are not enrolled in any subject for ' + term.label + '. Ask the administrator to enroll you.' } };
    const assigns = await Academics.assignmentsForSubjects(term.id, enr.map((e) => e.subject_id));
    const ins = instructorSignatories(enr, assigns);
    skipped = enr.filter((e) => !ins.some((i) => i.subject_id === e.subject_id)).map((e) => e.subject_code);
    ins.forEach((i) => approvals.push({ office_code: R.INSTRUCTOR_CODE, instructor_id: i.instructor_id, subject_id: i.subject_id, subject_label: i.subject_label, stage: purpose.instructor_stage }));
  }
  if (!approvals.length) return { ok: false, errors: { _form: 'No signatories are configured for this purpose. Please tell the administrator.' } };

  const st = await Settings.get();
  const now = new Date();
  const made = await Clearances.createWithApprovals({
    student, purposeId: purpose.id, purposeOther: purpose.requires_explanation ? purposeOther : null, termId: term.id,
    deadlineAt: purpose.deadline_days ? new Date(now.getTime() + purpose.deadline_days * 86400000) : null,
    approvals, dueAt: R.dueAt(now, st.dueHours), ip,
  });
  if (made.duplicate) return { ok: false, errors: { _form: 'You already have a clearance in progress.' } };

  const request = { id: made.id, reference_no: made.reference };
  const all = await Clearances.approvalsFor(made.id);
  await Notify.add(student.id, 'Clearance submitted', 'Request ' + made.reference + ' (' + purpose.name + ') was sent to ' + all.length + ' signatories.', '/student/clearances/' + made.id, made.id);
  await notifyApprovals(all.filter((a) => a.eligible_at), request, student, 'New clearance request',
    fullName(student) + ' (' + (student.student_no || '') + ') submitted ' + made.reference + ' for ' + purpose.name + '. Due ' + R.dueAt(now, st.dueHours).toLocaleDateString('en-PH') + '.');
  if (skipped.length) await Notify.addMany(await Users.adminIds(), 'Subject without instructor', fullName(student) + ' is enrolled in ' + skipped.join(', ') + ' but no instructor is assigned to that section.', '/admin/academics', made.id);
  return { ok: true, id: made.id, reference: made.reference };
}

// action: 'clear' | 'hold' | 'pending'
async function decide({ approvalId, user, action, remarks, kind, password, confirm, ip }) {
  const a = await Clearances.approvalScoped(approvalId, user);
  if (!a) return { ok: false, notFound: true };
  if (user.office_code === 'DEPT') return { ok: false, errors: ['Department heads monitor escalations and cannot sign.'] };

  if (action === 'clear') {
    // A typed name is not a signature: the signer must confirm and re-enter their password.
    if (confirm !== 'yes') return { ok: false, errors: ['Tick the box to confirm that you are signing.'] };
    const hash = await Users.hashOf(user.id);
    if (!password || !hash || !(await bcrypt.compare(password, hash))) {
      await Audit.write({ actor: user, action: 'signature_denied', entity: 'approval', entityId: approvalId, requestId: a.request_id, details: 'Wrong password at signing', ip });
      return { ok: false, errors: ['Your password is incorrect. The signature was not applied.'] };
    }
  }
  const st = await Settings.get();
  const signatureImage = action === 'clear' ? await Users.signatureOf(user.id) : null; // snapshot: later changes never alter past signatures
  const out = await Clearances.decideAtomic({
    approvalId, actor: user, action, remarks: remarks || '', kind: KINDS.includes(kind) ? kind : 'general', ip, dueHours: st.dueHours, qrValidDays: st.qrValidDays, signatureImage,
  });
  if (!out.ok) return out;

  const link = '/student/clearances/' + a.request_id;
  const req = { id: a.request_id, reference_no: a.reference_no };
  const student = { id: a.student_id, college: a.student_college, given_name: a.given_name, family_name: a.family_name, student_no: a.student_no };
  const who = a.label;
  if (action === 'hold') {
    await Notify.add(a.student_id, 'On Hold: ' + who, 'Reason: ' + remarks + ' Please resolve it, then ask the signatory to review.', link, a.request_id);
    return { ok: true, message: 'Marked On Hold. The student was notified.' };
  }
  if (action === 'pending') {
    await Notify.add(a.student_id, 'Status changed', who + ' was set back to Pending.', link, a.request_id);
    return { ok: true, message: 'Reset to Pending.' };
  }
  await Notify.add(a.student_id, 'Cleared: ' + who, 'Your requirement was verified and cleared.', link, a.request_id);
  if (out.complete) {
    await Notify.add(a.student_id, 'Clearance completed', 'Every approval is complete. Your final clearance and QR code are ready.', link, a.request_id);
    await Notify.addMany(await Users.adminIds(), 'Clearance completed', a.reference_no + ' (' + fullName(a) + ') is fully cleared.', '/admin/clearances', a.request_id);
  }
  for (const n of out.newlyEligible) {
    await notifyApprovals([n], req, student, 'Ready for your signature', fullName(a) + ' (' + a.reference_no + '): all earlier approvals are cleared.');
    if (n.office_code === 'REG' || n.office_code === 'DEAN') {
      await Notify.add(a.student_id, 'Next: ' + n.label, n.label + ' can now sign your clearance.', link, a.request_id);
    }
  }
  return { ok: true, message: out.complete ? 'Cleared — this was the final signature. The clearance is completed.' : 'Cleared and signed. The student was notified.' };
}

// Admin action. Not a bypass: it only invalidates an issued certificate, needs a reason and the admin's password, and is audited.
async function revoke({ cert, reason, admin, password, ip }) {
  const hash = await Users.hashOf(admin.id);
  if (!password || !(await bcrypt.compare(password, hash))) return { ok: false, errors: { password: 'Your password is incorrect.' } };
  if (!(await Certs.revoke(cert.id, reason, admin.id))) return { ok: false, errors: { _form: 'It was already revoked.' } };
  await Audit.write({ actor: admin, action: 'revoke', entity: 'certificate', entityId: cert.id, requestId: cert.request_id, details: reason, ip });
  await Notify.add(cert.student_id, 'Clearance revoked', 'Your clearance certificate was revoked. Reason: ' + reason, '/student/clearances/' + cert.request_id, cert.request_id);
  return { ok: true };
}

module.exports = { submit, decide, revoke };
