// Deadline reminders and escalation. This job only NOTIFIES. It never approves or bypasses a stage.
const R = require('../lib/rules');
const Users = require('../models/users');
const Settings = require('../models/settings');
const Clearances = require('../models/clearances');
const Notify = require('../models/notifications');
const Audit = require('../models/audit');
const cfg = require('../config');

let running = false;

async function runOnce(now = new Date()) {
  if (running) return { dueSoon: 0, reminded: 0, escalated: 0, skipped: true };
  running = true;
  const out = { dueSoon: 0, reminded: 0, escalated: 0 };
  try {
    const st = await Settings.get();
    const cands = await Clearances.overdueCandidates();
    // Only blame signatories who can actually act: skip items still blocked by an earlier stage.
    const ctx = new Map();
    const actionable = [];
    for (const a of cands) {
      if (!ctx.has(a.request_id)) ctx.set(a.request_id, { all: await Clearances.approvalsFor(a.request_id), issues: await Clearances.issuesFor(a.request_id) });
      const c = ctx.get(a.request_id);
      if (R.blockedReason(c.all.find((x) => x.id === a.id), c.all, c.issues) === null) actionable.push(a);
    }
    for (const f of R.followUps(actionable, now, st)) {
      const a = f.approval;
      const who = a.given_name + ' ' + a.family_name;
      const link = '/staff/approvals/' + a.id;
      const to = await Users.recipientsFor(a);
      if (f.dueSoon) {
        await Notify.addMany(to, 'Deadline approaching', a.reference_no + ' (' + who + '): your approval is due ' + new Date(a.due_at).toLocaleString('en-PH') + '.', link, a.request_id);
        await Clearances.markDueSoon(a.id); out.dueSoon++;
      }
      if (f.remind) {
        await Notify.addMany(to, 'Overdue: ' + a.label, a.reference_no + ' (' + who + ') is ' + f.overdueHours + ' h overdue (' + (a.status === 'on_hold' ? 'On Hold' : 'Pending') + '). Please act on it.', link, a.request_id);
        await Clearances.markReminded(a.id); out.reminded++;
      }
      if (f.escalate) {
        const extra = st.escalateToDeptHead ? await Users.deptHeadIds(a.student_college) : [];
        await Notify.addMany([...(await Users.adminIds()), ...extra], 'Escalation: ' + a.label, a.reference_no + ' (' + who + ') is ' + f.overdueHours + ' h overdue. Responsible: ' + a.label + '.', '/admin', a.request_id);
        await Notify.add(a.student_id, 'Your request was escalated', a.label + ' is overdue. The administrator has been alerted.', '/student/clearances/' + a.request_id, a.request_id);
        await Clearances.markEscalated(a.id);
        await Audit.write({ actor: null, action: 'escalated', entity: 'approval', entityId: a.id, requestId: a.request_id, details: a.label + ' overdue ' + f.overdueHours + ' h' });
        out.escalated++;
      }
    }
  } finally { running = false; }
  return out;
}

function start() {
  const tick = () => runOnce().then((r) => { if (r.dueSoon || r.reminded || r.escalated) console.log('[scheduler]', r); })
    .catch((e) => console.error('[scheduler] failed:', e.message));
  setTimeout(tick, 10 * 1000);
  setInterval(tick, cfg.schedulerMinutes * 60 * 1000);
}

module.exports = { runOnce, start };
