const { Router } = require('express');
const bcrypt = require('bcryptjs');
const Users = require('../models/users');
const Audit = require('../models/audit');
const { homeFor } = require('../middleware/auth');

const router = Router();
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10); // equalises timing for unknown emails
const fails = new Map();
const MAX_FAILS = 5, WINDOW = 15 * 60 * 1000;
const tooMany = (key) => { const f = fails.get(key); if (!f) return false; if (Date.now() - f.first > WINDOW) { fails.delete(key); return false; } return f.n >= MAX_FAILS; };
const noteFail = (key) => { const f = fails.get(key); if (!f || Date.now() - f.first > WINDOW) fails.set(key, { n: 1, first: Date.now() }); else f.n++; };

router.get('/', (req, res) => res.redirect(req.session.user ? homeFor(req.session.user) : '/login'));
router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect(homeFor(req.session.user));
  res.render('login', { title: 'Log in', errors: [], old: {} });
});

router.post('/login', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const key = req.ip + '|' + email;
    const fail = (msg, code = 401) => res.status(code).render('login', { title: 'Log in', errors: [msg], old: { email } });
    if (!email || !password) return fail('Enter your email and password.', 422);
    if (tooMany(key)) return fail('Too many attempts. Try again in a few minutes.', 429);

    const u = await Users.findByEmailWithHash(email);
    const ok = await bcrypt.compare(password, u ? u.password_hash : DUMMY_HASH);
    if (!u || !ok || !u.is_active) { noteFail(key); return fail('Incorrect email or password.'); }

    fails.delete(key);
    const user = { id: u.id, role: u.role, given_name: u.given_name, family_name: u.family_name, email: u.email, college: u.college, office_code: u.office_code, must_change: !!u.must_change_password };
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = user;
      Audit.write({ actor: user, action: 'login', entity: 'user', entityId: user.id, ip: req.ip }).catch(() => {});
      req.session.save((e2) => (e2 ? next(e2) : res.redirect(user.must_change ? '/account/password' : homeFor(user))));
    });
  } catch (e) { next(e); }
});

router.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));
module.exports = router;
