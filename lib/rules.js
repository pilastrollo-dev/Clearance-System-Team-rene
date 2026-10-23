// Pure clearance rules. No database, no Express: everything here is unit-tested with `node --test`.
// An approval is {id, office_code, stage, status: 'pending'|'on_hold'|'cleared', ...}.
// Stages come from the purpose configuration: an approval may be signed only when every
// approval in an EARLIER stage is cleared and no compliance issue is open.

const INSTRUCTOR_CODE = 'INSTRUCTOR';
const STATUS_LABEL = { pending: 'Pending', on_hold: 'On Hold', cleared: 'Cleared' };
const H = 3600 * 1000;

function labelOf(a) {
  if (a.office_code === INSTRUCTOR_CODE) {
    return 'Instructor: ' + (a.instructor_name || 'Instructor') + (a.subject_label ? ' (' + a.subject_label + ')' : '');
  }
  return a.office_name || a.office_code;
}

const openIssues = (issues) => (issues || []).filter((i) => i.status === 'open');

// null = may be signed now; otherwise the human-readable reason.
function blockedReason(a, all, issues = []) {
  const earlier = all.filter((x) => x.id !== a.id && x.stage < a.stage && x.status !== 'cleared');
  const parts = [];
  if (earlier.length) {
    const names = earlier.slice(0, 3).map((x) => labelOf(x) + ' (' + STATUS_LABEL[x.status] + ')').join('; ');
    const more = earlier.length > 3 ? ' and ' + (earlier.length - 3) + ' more' : '';
    parts.push(labelOf(a) + ' can only sign after every earlier approval is cleared. Outstanding: ' + names + more + '.');
  }
  const minStage = Math.min(...all.map((x) => x.stage));
  const open = openIssues(issues);
  if (a.stage > minStage && open.length) {
    parts.push('Unresolved compliance issue' + (open.length > 1 ? 's' : '') + ': ' + open.slice(0, 2).map((i) => i.description).join(' / ') + '.');
  }
  return parts.length ? parts.join(' ') : null;
}

// Validates one action against the whole request. Returns an error string or null.
// action: 'clear' | 'hold' | 'pending'
function evaluateAction(all, issues, approvalId, action, remarks = '') {
  const a = all.find((x) => x.id === approvalId);
  if (!a) return 'That approval does not exist.';
  if (!['clear', 'hold', 'pending'].includes(action)) return 'Unknown action.';
  const laterSigned = all.some((x) => x.stage > a.stage && x.status === 'cleared');

  if (action === 'clear') {
    if (a.status === 'cleared') return 'This item is already cleared.';
    return blockedReason(a, all, issues);
  }
  if (laterSigned) return 'A later stage has already signed, so this item can no longer be changed. Ask the administrator to revoke the clearance first.';
  if (action === 'hold') {
    if (String(remarks).trim().length < 5) return 'Explain the compliance issue (at least 5 characters).';
    return null;
  }
  if (a.status !== 'cleared') return 'Only a cleared item can be reset to pending.';
  return null;
}

// Approvals that have just become eligible (their earlier stages are done) and have no due date yet.
function nextEligible(all, issues = []) {
  return all.filter((x) => !x.eligible_at && x.status !== 'cleared' && blockedReason(x, all, issues) === null).map((x) => x.id);
}

const isComplete = (all) => all.length > 0 && all.every((a) => a.status === 'cleared');

function progress(all) {
  const done = all.filter((a) => a.status === 'cleared').length;
  return { done, total: all.length, pct: all.length ? Math.round((done / all.length) * 100) : 0 };
}

const dueAt = (from, hours) => new Date(from.getTime() + hours * H);

// Overdue is DERIVED, never stored, so the underlying Pending/On Hold state is preserved.
const isOverdue = (a, now = new Date()) => a.status !== 'cleared' && !!a.due_at && new Date(a.due_at) < now;

// Which unfinished approvals need a heads-up, a reminder or an escalation right now?
// NEVER approves anything: it only decides who to notify.
function followUps(approvals, now, cfg) {
  const out = [];
  for (const a of approvals) {
    if (a.status === 'cleared' || !a.due_at) continue;
    const due = new Date(a.due_at);
    if (due > now) {
      if (!a.due_soon_notified_at && due - now <= cfg.dueSoonHours * H) out.push({ approval: a, dueSoon: true, remind: false, escalate: false, overdueHours: 0 });
      continue;
    }
    const remind = !a.last_reminder_at || now - new Date(a.last_reminder_at) >= cfg.remindEveryHours * H;
    const escalate = !a.escalated_at && now - due >= cfg.escalateAfterHours * H;
    if (remind || escalate) out.push({ approval: a, dueSoon: false, remind, escalate, overdueHours: Math.floor((now - due) / H) });
  }
  return out;
}

const PASSWORD_RULES = [
  { key: 'len', label: 'At least 8 characters', test: (p) => p.length >= 8 },
  { key: 'upper', label: 'One uppercase letter', test: (p) => /[A-Z]/.test(p) },
  { key: 'lower', label: 'One lowercase letter', test: (p) => /[a-z]/.test(p) },
  { key: 'num', label: 'One number', test: (p) => /[0-9]/.test(p) },
  { key: 'special', label: 'One special character (e.g. @ # ! $)', test: (p) => /[^A-Za-z0-9]/.test(p) },
];

function validatePassword(pw) {
  const p = typeof pw === 'string' ? pw : '';
  const errors = PASSWORD_RULES.filter((r) => !r.test(p)).map((r) => r.label);
  if (p.length > 72) errors.push('At most 72 characters');
  return errors; // empty = valid
}

function certStatus(cert, now = new Date()) {
  if (!cert) return 'invalid';
  if (cert.revoked_at) return 'revoked';
  if (cert.used_at) return 'used';
  if (new Date(cert.expires_at) <= now) return 'expired';
  return 'valid';
}

module.exports = {
  INSTRUCTOR_CODE, STATUS_LABEL, PASSWORD_RULES, labelOf, blockedReason, evaluateAction, nextEligible,
  isComplete, progress, dueAt, isOverdue, followUps, validatePassword, certStatus,
};
