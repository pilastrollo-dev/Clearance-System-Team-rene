const { Router } = require('express');
const bcrypt = require('bcryptjs');
const R = require('../lib/rules');
const Users = require('../models/users');
const Audit = require('../models/audit');
const { validateSignatureDataUrl } = require('../lib/signature');
const { homeFor } = require('../middleware/auth');

const router = Router();
const render = (res, status, errors) => res.status(status).render('account/password', { title: 'Change password', errors, old: {} });

router.get('/password', (req, res) => render(res, 200, {}));

router.post('/password', async (req, res, next) => {
  try {
    const u = req.session.user;
    const cur = String(req.body.current || ''), pw = String(req.body.password || ''), pw2 = String(req.body.password2 || '');
    const errors = {};
    if (!(await bcrypt.compare(cur, (await Users.hashOf(u.id)) || ''))) errors.current = 'Your current password is incorrect.';
    const rules = R.validatePassword(pw);
    if (rules.length) errors.password = 'Still needed: ' + rules.join(', ') + '.';
    else if (pw === cur) errors.password = 'Choose a password different from the current one.';
    if (pw !== pw2) errors.password2 = 'Passwords do not match.';
    if (Object.keys(errors).length) return render(res, 422, errors);

    await Users.setPassword(u.id, await bcrypt.hash(pw, 10), false);
    u.must_change = false; req.session.user = u;
    await Audit.write({ actor: u, action: 'password_changed', entity: 'user', entityId: u.id, ip: req.ip });
    req.session.flash = 'Password changed.';
    res.redirect(303, homeFor(u));
  } catch (e) { next(e); }
});

// ---------- my signature image (instructors and office staff) ----------
const canSign = (u) => ['instructor', 'staff'].includes(u.role);
const sigPage = async (res, status, user, error = '') => res.status(status).render('account/signature', { title: 'My signature', current: await Users.signatureOf(user.id), error });

router.get('/signature', async (req, res, next) => {
  try {
    if (!canSign(req.session.user)) return res.status(403).render('error', { title: 'Not allowed', heading: 'Not allowed', message: 'Only instructors and office staff sign clearances.' });
    await sigPage(res, 200, req.session.user);
  } catch (e) { next(e); }
});
router.post('/signature', async (req, res, next) => {
  try {
    const u = req.session.user;
    if (!canSign(u)) return res.status(403).render('error', { title: 'Not allowed', heading: 'Not allowed', message: 'Only instructors and office staff sign clearances.' });
    if (req.body.remove === '1') {
      await Users.setSignature(u.id, null);
      await Audit.write({ actor: u, action: 'signature_removed', entity: 'user', entityId: u.id, ip: req.ip });
      req.session.flash = 'Signature image removed.'; return res.redirect(303, '/account/signature');
    }
    const v = validateSignatureDataUrl(String(req.body.image || ''));
    if (!v.ok) return sigPage(res, 422, u, v.error);
    await Users.setSignature(u.id, String(req.body.image));
    await Audit.write({ actor: u, action: 'signature_saved', entity: 'user', entityId: u.id, ip: req.ip });
    req.session.flash = 'Signature saved. It will appear on clearances you sign from now on (earlier ones are not changed).';
    res.redirect(303, '/account/signature');
  } catch (e) { next(e); }
});

module.exports = router;
