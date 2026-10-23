const crypto = require('crypto');
const { db } = require('../db');

const COLS = 'c.id, c.request_id, c.token, c.issued_at, c.expires_at, c.revoked_at, c.revoked_reason, c.used_at';

// Called INSIDE the approval transaction. request_id is UNIQUE, so a second certificate for the same request is impossible.
async function issueTx(conn, requestId, expiresAt) {
  const token = crypto.randomBytes(16).toString('hex'); // 128-bit, unguessable
  await conn.query('INSERT INTO certificates (request_id, token, issued_at, expires_at) VALUES (?,?,?,?)', [requestId, token, new Date(), expiresAt]);
  return token;
}
async function findByRequest(requestId) {
  const [rows] = await db.query('SELECT ' + COLS + ' FROM certificates c WHERE c.request_id = ?', [requestId]); return rows[0];
}
async function findByToken(token) {
  const [rows] = await db.query(
    'SELECT ' + COLS + ', r.reference_no, r.purpose_other, p.name AS purpose, t.academic_year, t.semester, r.student_id, ' +
    's.given_name, s.family_name, s.student_no, s.college, u.given_name AS used_by_given, u.family_name AS used_by_family ' +
    'FROM certificates c JOIN clearance_requests r ON r.id = c.request_id JOIN clearance_purposes p ON p.id = r.purpose_id JOIN terms t ON t.id = r.term_id ' +
    'JOIN users s ON s.id = r.student_id LEFT JOIN users u ON u.id = c.used_by WHERE c.token = ?', [token]);
  return rows[0];
}
async function revoke(id, reason, byId) {
  const [r] = await db.query('UPDATE certificates SET revoked_at = ?, revoked_reason = ?, revoked_by = ? WHERE id = ? AND revoked_at IS NULL', [new Date(), reason, byId, id]);
  return r.affectedRows === 1;
}
async function markUsed(id, userId) {
  const [r] = await db.query('UPDATE certificates SET used_at = ?, used_by = ? WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?', [new Date(), userId, id, new Date()]);
  return r.affectedRows === 1;
}
async function log(certId, result, ip) {
  await db.query('INSERT INTO verification_logs (certificate_id, result, ip) VALUES (?,?,?)', [certId, result, String(ip || '').slice(0, 64)]);
}

module.exports = { issueTx, findByRequest, findByToken, revoke, markUsed, log };

async function byRequestIds(ids) {
  if (!ids.length) return {};
  const [rows] = await db.query('SELECT request_id, token, expires_at, revoked_at, used_at FROM certificates WHERE request_id IN (?)', [ids]);
  return Object.fromEntries(rows.map((r) => [r.request_id, r]));
}
module.exports.byRequestIds = byRequestIds;
