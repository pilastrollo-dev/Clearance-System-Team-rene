const express = require('express');
const session = require('express-session');
const crypto = require('crypto');
const path = require('path');
const cfg = require('./config');
const { requireRole, requireReports, csrf, forcePasswordChange } = require('./middleware/auth');
const Academics = require('./models/academics');
const Notify = require('./models/notifications');
const Scheduler = require('./services/scheduler');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');

// ---- logger ----
app.use((req, res, next) => {
  const t = Date.now();
  res.on('finish', () => console.log(req.method, req.originalUrl.split('?')[0], res.statusCode, Date.now() - t + 'ms'));
  next();
});

// ---- parsers, static, session ----
app.use('/admin/import', express.urlencoded({ extended: true, limit: '8mb' }));      // CSV text / base64 PDF (5 MB max)
app.use('/account/signature', express.urlencoded({ extended: true, limit: '500kb' })); // signature image (200 KB max)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

if (!process.env.SESSION_SECRET) console.warn('SESSION_SECRET is not set in .env - using a random one (everyone is logged out on restart).');
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false, saveUninitialized: true,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 8 * 3600 * 1000 },
}));

// ---- values every view can use ----
const fmt = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' });
app.use(async (req, res, next) => {
  try {
    res.locals.user = req.session.user || null;
    res.locals.flash = req.session.flash || null;
    delete req.session.flash;
    res.locals.clearDraft = req.session.clearDraft || '';
    delete req.session.clearDraft;
    let t = null;
    try { t = await Academics.currentTerm(); } catch (e) { /* tables may not exist yet */ }
    res.locals.term = t ? t.label : cfg.TERM_LABEL;
    res.locals.fmt = (d) => (d ? fmt.format(new Date(d)) : '—');
    res.locals.errors = [];
    res.locals.old = {};
    res.locals.unread = req.session.user ? await Notify.unreadCount(req.session.user.id) : 0;
    next();
  } catch (e) { next(e); }
});
app.use(csrf);
app.use(forcePasswordChange);

// ---- routes ----
app.use('/', require('./routes/auth'));
app.use('/verify', require('./routes/verify'));
app.use('/account', requireRole('student', 'instructor', 'staff', 'admin'), require('./routes/account'));
app.use('/notifications', requireRole('student', 'instructor', 'staff', 'admin'), require('./routes/notifications'));
app.use('/forms', require('./routes/forms'));
app.use('/student', requireRole('student'), require('./routes/student'));
app.use('/staff', requireRole('instructor', 'staff'), require('./routes/staff'));
app.use('/admin', requireRole('admin'), require('./routes/admin'));
app.use('/admin', requireRole('admin'), require('./routes/academics'));
app.use('/reports', requireReports, require('./routes/reports'));

// ---- 404 and error handler: must be last, error handler takes 4 parameters ----
app.use((req, res) => res.status(404).render('error', { title: 'Not found', heading: 'Page not found', message: 'We could not find that page.' }));
app.use((err, req, res, next) => {
  const ref = Date.now().toString(36);
  console.error('[' + ref + ']', err); // details go to the log only, never to the screen
  if (res.headersSent) return next(err);
  res.status(500).render('error', { title: 'Error', heading: 'Something went wrong', message: 'Please try again. If it keeps happening, tell the administrator and quote reference ' + ref + '.' });
});

if (require.main === module) {
  app.listen(cfg.PORT, () => {
    console.log('Teamrene Digital Clearance running on http://localhost:' + cfg.PORT);
    Scheduler.start();
  });
}

module.exports = app;
