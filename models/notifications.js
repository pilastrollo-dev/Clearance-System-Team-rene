const { db } = require('../db');

async function add(userId, title, body, link = null, requestId = null) {
  await db.query('INSERT INTO notifications (user_id, request_id, title, body, link) VALUES (?,?,?,?,?)',
    [userId, requestId, String(title).slice(0, 120), String(body).slice(0, 400), link]);
}
async function addMany(userIds, title, body, link = null, requestId = null) {
  for (const id of new Set(userIds)) await add(id, title, body, link, requestId);
}
async function listFor(userId) {
  const [rows] = await db.query(
    'SELECT n.id, n.title, n.body, n.link, n.is_read, n.created_at, r.reference_no FROM notifications n LEFT JOIN clearance_requests r ON r.id = n.request_id WHERE n.user_id = ? ORDER BY n.id DESC LIMIT 100', [userId]);
  return rows;
}
async function unreadCount(userId) {
  const [[r]] = await db.query('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0', [userId]); return r.n;
}
async function openOwned(id, userId) {
  const [rows] = await db.query('SELECT id, link FROM notifications WHERE id = ? AND user_id = ?', [id, userId]);
  if (!rows[0]) return null;
  await db.query('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [id, userId]);
  return rows[0];
}
async function markAllRead(userId) { await db.query('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [userId]); }

module.exports = { add, addMany, listFor, unreadCount, openOwned, markAllRead };
