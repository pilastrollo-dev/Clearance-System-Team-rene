
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const crypto = require('crypto');
const path = require('path');
const cfg = require('./config');
const { db } = require('./db');

const {
  requireRole,
  requireReports,
  csrf,
  forcePasswordChange
} = require('./middleware/auth');

const Academics = require('./models/academics');
const Notify = require('./models/notifications');
const Scheduler = require('./services/scheduler');

const app = express();

// Trust Render's HTTPS reverse proxy in production
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');

// ---- logger ----
app.use((req, res, next) => {
  const t = Date.now();

  res.on('finish', () => {
    console.log(
      req.method,
      req.originalUrl.split('?')[0],
      res.statusCode,
      Date.now() - t + 'ms'
    );
  });

  next();
});

// ---- parsers and static files ----
app.use(
  '/admin/import',
  express.urlencoded({ extended: true, limit: '8mb' })
);

app.use(
  '/account/signature',
  express.urlencoded({ extended: true, limit: '500kb' })
);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- database-backed sessions ----
if (
  process.env.NODE_ENV === 'production' &&
  !process.env.SESSION_SECRET
) {
  throw new Error('SESSION_SECRET is required in production.');
}

if (!process.env.SESSION_SECRET) {
  console.warn(
    'SESSION_SECRET is not set. Using a temporary development secret.'
  );
}

// Reuse the existing MySQL2 promise connection pool
const sessionStore = new MySQLStore({}, db);

app.use(session({
  secret:
    process.env.SESSION_SECRET ||
    crypto.randomBytes(32).toString('hex'),

  store: sessionStore,
  resave: false,
  saveUninitialized: true,

  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000
  }
}));

// ---- values every view can use ----
const fmt = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Manila'
});

app.use(async (req, res, next) => {
  try {
    res.locals.user = req.session.user || null;
    res.locals.flash = req.session.flash || null;

    delete req.session.flash;

    res.locals.clearDraft = req.session.clearDraft || '';

    delete req.session.clearDraft;

    let t = null;

    try {
      t = await Academics.currentTerm();
    } catch (e) {
      // Tables may not exist yet
    }

    res.locals.term = t ? t.label : cfg.TERM_LABEL;

    res.locals.fmt = (d) => (
      d ? fmt.format(new Date(d)) : '—'
    );

    res.locals.errors = [];
    res.locals.old = {};

    res.locals.unread = req.session.user
      ? await Notify.unreadCount(req.session.user.id)
      : 0;

    next();
  } catch (e) {
    next(e);
  }
});

app.use(csrf);
app.use(forcePasswordChange);

// ---- routes ----
app.use('/', require('./routes/auth'));
app.use('/verify', require('./routes/verify'));

app.use(
  '/account',
  requireRole('student', 'instructor', 'staff', 'admin'),
  require('./routes/account')
);

app.use(
  '/notifications',
  requireRole('student', 'instructor', 'staff', 'admin'),
  require('./routes/notifications')
);

app.use('/forms', require('./routes/forms'));

app.use(
  '/student',
  requireRole('student'),
  require('./routes/student')
);

app.use(
  '/staff',
  requireRole('instructor', 'staff'),
  require('./routes/staff')
);

app.use(
  '/admin',
  requireRole('admin'),
  require('./routes/admin')
);

app.use(
  '/admin',
  requireRole('admin'),
  require('./routes/academics')
);

app.use(
  '/reports',
  requireReports,
  require('./routes/reports')
);

// ---- 404 and error handler ----
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Not found',
    heading: 'Page not found',
    message: 'We could not find that page.'
  });
});

// Error handler must be last
app.use((err, req, res, next) => {
  const ref = Date.now().toString(36);

  console.error('[' + ref + ']', err);

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).render('error', {
    title: 'Error',
    heading: 'Something went wrong',
    message:
      'Please try again. If it keeps happening, tell the administrator and quote reference ' +
      ref + '.'
  });
});

// ---- start application ----
if (require.main === module) {
  sessionStore.onReady()
    .then(() => {
      console.log('MySQL session store ready');

      app.listen(cfg.PORT, () => {
        console.log(
          'Teamrene Digital Clearance running on port ' + cfg.PORT
        );

        Scheduler.start();
      });
    })
    .catch(err => {
      console.error(
        'MySQL session store failed to initialize:',
        err
      );

      process.exit(1);
    });
}

module.exports = app;
