const { db } = require('../db');
const cfg = require('../config');

const MAP = { due_hours: 'dueHours', remind_every_hours: 'remindEveryHours', escalate_after_hours: 'escalateAfterHours',
  due_soon_hours: 'dueSoonHours', escalate_to_dept_head: 'escalateToDeptHead', qr_valid_days: 'qrValidDays' };

async function get() {
  const out = { dueHours: cfg.dueHours, remindEveryHours: cfg.remindEveryHours, escalateAfterHours: cfg.escalateAfterHours,
    dueSoonHours: cfg.dueSoonHours, escalateToDeptHead: 1, qrValidDays: cfg.qrValidDays };
  const [rows] = await db.query('SELECT key_name, value FROM settings');
  for (const r of rows) if (MAP[r.key_name] && Number.isFinite(Number(r.value))) out[MAP[r.key_name]] = Number(r.value);
  return out;
}

async function save(values) {
  for (const [k, v] of Object.entries(values)) {
    await db.query('INSERT INTO settings (key_name, value) VALUES (?,?) ON DUPLICATE KEY UPDATE value = VALUES(value)', [k, String(v)]);
  }
}

module.exports = { get, save, MAP };
