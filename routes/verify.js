// Public QR verification. Anyone who scans the code sees valid / expired / revoked / used.
const { Router } = require('express');
const R = require('../lib/rules');
const Certs = require('../models/certificates');

const router = Router();
const TOKEN = /^[a-f0-9]{32}$/;
const canConsume = (u) => u && ['staff', 'admin'].includes(u.role);

router.get('/:token', async (req, res, next) => {
  try {
    const cert = TOKEN.test(req.params.token) ? await Certs.findByToken(req.params.token) : null;
    if (!cert) return res.status(404).render('verify', { title: 'Verify clearance', status: 'invalid', cert: null, canUse: false });
    const status = R.certStatus(cert);
    await Certs.log(cert.id, status, req.ip);
    res.render('verify', { title: 'Verify clearance', status, cert, canUse: status === 'valid' && canConsume(req.session.user) });
  } catch (e) { next(e); }
});

// Marks the clearance as consumed (for example when credentials are released). One time only.
router.post('/:token/use', async (req, res, next) => {
  try {
    if (!canConsume(req.session.user)) return res.status(403).render('error', { title: 'Not allowed', heading: 'Not allowed', message: 'Log in as office staff or an administrator to mark a clearance as used.' });
    const cert = TOKEN.test(req.params.token) ? await Certs.findByToken(req.params.token) : null;
    if (!cert) return res.status(404).render('error', { title: 'Not found', heading: 'Not found', message: 'That certificate does not exist.' });
    const ok = await Certs.markUsed(cert.id, req.session.user.id);
    req.session.flash = ok ? 'Marked as used. It can no longer be accepted again.' : 'This clearance can no longer be used.';
    res.redirect(303, '/verify/' + cert.token);
  } catch (e) { next(e); }
});

module.exports = router;
