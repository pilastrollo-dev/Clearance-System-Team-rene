const QRCode = require('qrcode');
const cfg = require('../config');

const verifyUrl = (token) => cfg.APP_URL + '/verify/' + token;
const dataUrl = (token) => QRCode.toDataURL(verifyUrl(token), { width: 280, margin: 1, errorCorrectionLevel: 'M' });

module.exports = { verifyUrl, dataUrl };
