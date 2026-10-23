// Reads the text layer of a PDF (best effort). Scanned/image-only PDFs have no text and cannot be read.
const MAX_BYTES = 5 * 1024 * 1024;

// pdf-parse glues the cells of a table row together with nothing in between ("CCIT 106Application Development3").
// This renderer puts a tab between items on the same line so the columns can be told apart.
function renderPage(pageData) {
  return pageData.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false }).then((tc) => {
    let lastY, text = '';
    for (const item of tc.items) {
      const y = item.transform[5];
      if (lastY === undefined || Math.abs(lastY - y) < 2) text += (text && !text.endsWith('\n') ? '\t' : '') + item.str;
      else text += '\n' + item.str;
      lastY = y;
    }
    return text;
  });
}

async function pdfToText(base64) {
  const buf = Buffer.from(String(base64 || ''), 'base64');
  if (!buf.length) throw new Error('No PDF was received.');
  if (buf.length > MAX_BYTES) throw new Error('That PDF is larger than 5 MB.');
  if (buf.slice(0, 5).toString() !== '%PDF-') throw new Error('That file is not a PDF.');
  let parse;
  try { parse = require('pdf-parse/lib/pdf-parse.js'); } catch (e) { throw new Error('PDF reading is not installed. Run "npm install" in the project folder, then restart.'); }
  let out;
  try { out = await parse(buf, { pagerender: renderPage }); } catch (e) { throw new Error('The PDF could not be read (it may be damaged or password-protected).'); }
  return out.text || '';
}

module.exports = { pdfToText, renderPage };
