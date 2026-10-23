const crypto = require('crypto');

const deny = (res, status, title, message) => res.status(status).render('error', { title, heading: title, message });

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect('/login');
    if (!roles.includes(req.session.user.role)) return deny(res, 403, 'Not allowed', 'Your account cannot open this page.');
    next();
  };
}
// Reports are for admins and the registrar only.
function requireReports(req, res, next) {
  const u = req.session.user;
  if (!u) return res.redirect('/login');
  if (u.role === 'admin' || (u.role === 'staff' && u.office_code === 'REG')) return next();
  return deny(res, 403, 'Not allowed', 'Reports are available to administrators and the registrar.');
}
const homeFor = (u) => (u.role === 'student' ? '/student' : u.role === 'admin' ? '/admin' : '/staff');

// An account with a temporary password must choose its own before doing anything else.
function forcePasswordChange(req, res, next) {
  const u = req.session.user;
  if (u && u.must_change && !['/account/password', '/logout'].includes(req.path) && !req.path.startsWith('/css') && !req.path.startsWith('/js') && !req.path.startsWith('/img')) {
    return res.redirect('/account/password');
  }
  next();
}

// Synchroniser-token CSRF protection for every POST.
function csrf(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrf = req.session.csrf;
  if (req.method === 'POST') {
    const a = Buffer.from(String((req.body && req.body._csrf) || ''));
    const b = Buffer.from(req.session.csrf);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return deny(res, 403, 'Session expired', 'Please go back, reload the page and try again.');
  }
  next();
}

module.exports = { requireRole, requireReports, homeFor, forcePasswordChange, csrf, deny };
