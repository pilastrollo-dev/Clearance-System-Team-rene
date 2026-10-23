const { db } = require('../db');

async function list({ activeOnly = false } = {}) {
  const [rows] = await db.query('SELECT id, name, requires_explanation, instructor_stage, deadline_days, is_active FROM clearance_purposes' +
    (activeOnly ? ' WHERE is_active = 1' : '') + ' ORDER BY id');
  return rows;
}
async function find(id) {
  const [rows] = await db.query('SELECT id, name, requires_explanation, instructor_stage, deadline_days, is_active FROM clearance_purposes WHERE id = ?', [id]);
  return rows[0];
}
async function signatories(purposeId) {
  const [rows] = await db.query(
    'SELECT ps.office_code, ps.stage, o.name FROM purpose_signatories ps JOIN offices o ON o.code = ps.office_code AND o.is_active = 1 WHERE ps.purpose_id = ? ORDER BY ps.stage, o.name', [purposeId]);
  return rows;
}
async function allSignatories() {
  const [rows] = await db.query('SELECT purpose_id, office_code, stage FROM purpose_signatories');
  return rows;
}
async function offices() { const [r] = await db.query('SELECT code, name, is_active FROM offices ORDER BY name'); return r; }
async function addOffice(code, name) { await db.query('INSERT INTO offices (code, name) VALUES (?,?)', [code, name]); }

async function create(p) {
  const [r] = await db.query('INSERT INTO clearance_purposes (name, requires_explanation, instructor_stage, deadline_days) VALUES (?,?,?,?)',
    [p.name, p.requires_explanation ? 1 : 0, p.instructor_stage, p.deadline_days]);
  return r.insertId;
}
// stages: { OFFICE_CODE: stageNumber } (offices not present are not required)
async function save(id, p, stages) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('UPDATE clearance_purposes SET name = ?, requires_explanation = ?, instructor_stage = ?, deadline_days = ?, is_active = ? WHERE id = ?',
      [p.name, p.requires_explanation ? 1 : 0, p.instructor_stage, p.deadline_days, p.is_active ? 1 : 0, id]);
    await conn.query('DELETE FROM purpose_signatories WHERE purpose_id = ?', [id]);
    for (const [code, stage] of Object.entries(stages)) await conn.query('INSERT INTO purpose_signatories (purpose_id, office_code, stage) VALUES (?,?,?)', [id, code, stage]);
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}

module.exports = { list, find, signatories, allSignatories, offices, addOffice, create, save };
