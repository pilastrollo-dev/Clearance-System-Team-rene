require('dotenv').config();
const num = (v, d) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
const PORT = num(process.env.PORT, 3001);

module.exports = {
  PORT,
  APP_URL: (process.env.APP_URL || 'http://localhost:' + PORT).replace(/\/$/, ''),
  EMAIL_DOMAIN: '@my.cspc.edu.ph',
  TERM_LABEL: process.env.TERM_LABEL || '1st Sem SY 2026–2027',
  dueHours: num(process.env.APPROVAL_DUE_HOURS, 48),
  remindEveryHours: num(process.env.REMIND_EVERY_HOURS, 24),
  escalateAfterHours: num(process.env.ESCALATE_AFTER_HOURS, 24),
  dueSoonHours: num(process.env.DUE_SOON_HOURS, 24),
  schedulerMinutes: num(process.env.SCHEDULER_MINUTES, 15),
  qrValidDays: num(process.env.QR_VALID_DAYS, 90),
  // Edit this list to match the colleges of your campus.
  COLLEGES: [
    'College of Computer Studies',
    'College of Engineering',
    'College of Arts and Sciences',
    'College of Business and Management',
    'College of Education',
  ],
};
