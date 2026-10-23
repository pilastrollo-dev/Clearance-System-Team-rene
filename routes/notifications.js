const { Router } = require('express');
const Notify = require('../models/notifications');

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    res.render('notifications', { title: 'Notifications', items: await Notify.listFor(req.session.user.id) });
  } catch (e) { next(e); }
});

router.post('/read-all', async (req, res, next) => {
  try { await Notify.markAllRead(req.session.user.id); res.redirect(303, '/notifications'); } catch (e) { next(e); }
});

router.get('/:id/open', async (req, res, next) => {
  try {
    const n = await Notify.openOwned(Number(req.params.id), req.session.user.id);
    res.redirect(n && n.link && n.link.startsWith('/') ? n.link : '/notifications');
  } catch (e) { next(e); }
});

module.exports = router;
