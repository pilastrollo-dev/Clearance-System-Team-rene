const { Router } = require('express');
const Academics = require('../models/academics');
const Purposes = require('../models/purposes');
const Clearances = require('../models/clearances');

const router = Router();
const num = (v) => Number(v) || 0;
const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? new Date(v + 'T00:00:00') : null);
// Cells starting with = + - @ are prefixed so spreadsheets cannot run them as formulas (CSV injection).
const cell = (v) => { let s = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };

router.get('/', async (req, res, next) => {
  try {
    const q = req.query;
    const to = date(q.to);
    const f = { from: date(q.from), to: to ? new Date(to.getTime() + 86400000) : null, term_id: num(q.term_id), purpose_id: num(q.purpose_id), program_id: num(q.program_id), section_id: num(q.section_id),
      office: String(q.office || '').slice(0, 10), status: String(q.status || '') };
    const raw = { from: q.from || '', to: q.to || '', term_id: f.term_id || '', purpose_id: f.purpose_id || '', program_id: f.program_id || '', section_id: f.section_id || '', office: f.office, status: f.status };
    const now = new Date();
    if (q.format === 'csv') {
      const rows = await Clearances.reportRows(f, now);
      const head = ['Request', 'Status', 'Purpose', 'Term', 'Student', 'Student no.', 'Program', 'Year', 'Section', 'Signed', 'Total', 'Open issues', 'Submitted', 'Completed'];
      const lines = [head.map(cell).join(',')].concat(rows.map((r) => [r.reference_no, r.status, r.purpose, r.semester + ' ' + r.academic_year, r.given_name + ' ' + r.family_name, r.student_no, r.program, r.year_level, r.section, r.done, r.total, r.open_issues,
        new Date(r.created_at).toISOString(), r.completed_at ? new Date(r.completed_at).toISOString() : ''].map(cell).join(',')));
      res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="clearance-report.csv"' });
      return res.send('\ufeff' + lines.join('\r\n'));
    }
    const [stats, rows, terms, purposes, programs, sections, offices] = await Promise.all([Clearances.reportStats(f, now), Clearances.reportRows(f, now),
      Academics.terms(), Purposes.list(), Academics.programs(), Academics.sections(), Purposes.offices()]);
    res.render('reports', { title: 'Reports', stats, rows, terms, purposes, programs, sections, offices, f: raw, qs: new URLSearchParams(Object.entries(raw).filter(([, v]) => v !== '')).toString() });
  } catch (e) { next(e); }
});

module.exports = router;
