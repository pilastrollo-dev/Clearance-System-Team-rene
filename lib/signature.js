// Validation of a signature IMAGE (drawn or uploaded). The image is only what is printed on the form;
// authorisation to sign is still the confirmation + password check. SVG is refused on purpose (script risk).
const MAX_BYTES = 200 * 1024;

function validateSignatureDataUrl(s) {
  if (typeof s !== 'string') return { ok: false, error: 'No signature was received.' };
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(s);
  if (!m) return { ok: false, error: 'Use a PNG or JPEG image.' };
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_BYTES) return { ok: false, error: 'The image is too large (maximum 200 KB).' };
  if (buf.length < 100) return { ok: false, error: 'The image looks empty.' };
  const png = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const jpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if ((m[1] === 'png' && !png) || (m[1] === 'jpeg' && !jpg)) return { ok: false, error: 'That file is not a real ' + m[1].toUpperCase() + ' image.' };
  return { ok: true };
}
const isSafeImage = (s) => /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(String(s || ''));

module.exports = { MAX_BYTES, validateSignatureDataUrl, isSafeImage };
