const { db } = require('../db');

const actorLabel = (u) => (u ? u.given_name + ' ' + u.family_name + ' (' + (u.office_code || u.role) + ')' : 'system');

// `exec` is the pool or a transaction connection, so audit rows commit/rollback with the change itself.
async function log(exec, e) {
  await exec.query(
    'INSERT INTO audit_logs (actor_id, actor_label, action, entity, entity_id, request_id, details, ip, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    [e.actor ? e.actor.id : null, actorLabel(e.actor), e.action, e.entity, e.entityId || null, e.requestId || null,
      e.details ? String(e.details).slice(0, 500) : null, e.ip ? String(e.ip).slice(0, 64) : null, new Date()]);
}
const write = (e) => log(db, e);

async function list({ q = '', requestNo = '' } = {}) {
  let sql = 'SELECT a.id, a.actor_label, a.action, a.entity, a.entity_id, a.request_id, a.details, a.created_at, r.reference_no FROM audit_logs a LEFT JOIN clearance_requests r ON r.id = a.request_id WHERE 1=1';
  const p = [];
  if (q) { sql += ' AND (a.actor_label LIKE ? OR a.action LIKE ? OR a.details LIKE ?)'; p.push('%' + q + '%', '%' + q + '%', '%' + q + '%'); }
  if (requestNo) { sql += ' AND r.reference_no = ?'; p.push(requestNo); }
  const [rows] = await db.query(sql + ' ORDER BY a.id DESC LIMIT 300', p);
  return rows;
}

async function forRequest(requestId) {
  const [rows] = await db.query('SELECT actor_label, action, details, created_at FROM audit_logs WHERE request_id = ? ORDER BY id', [requestId]);
  return rows;
}

module.exports = { log, write, list, forRequest, actorLabel };
