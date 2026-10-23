// Print-friendly clearance form (use the browser's "Save as PDF"). Only the student, a signatory of the request, or an admin may open it.
const { Router } = require('express');
const R = require('../lib/rules');
const Clearances = require('../models/clearances');
const Certs = require('../models/certificates');
const QR = require('../services/qr');

const router = Router();

router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id) || 0;
    const user = req.session.user;
    if (!user) return res.redirect('/login');
    if (!(await Clearances.canOpenForm(user, id))) return res.status(404).render('error', { title: 'Not found', heading: 'Not found', message: 'That clearance does not exist or you cannot open it.' });
    const request = await Clearances.findById(id);
    const [rows, issues, extra, cert] = await Promise.all([Clearances.approvalsFor(id), Clearances.issuesFor(id), Clearances.formData(id), Certs.findByRequest(id)]);
    res.render('form', { title: request.reference_no, request, rows, issues, student: extra.student, signatures: extra.signatures, cert, certStatus: cert ? R.certStatus(cert) : null,
      qr: cert ? await QR.dataUrl(cert.token) : null, verifyUrl: cert ? QR.verifyUrl(cert.token) : null });
  } catch (e) { next(e); }
});

module.exports = router;
