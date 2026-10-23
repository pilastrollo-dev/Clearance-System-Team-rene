// Minimal EJS-compatible renderer used ONLY to smoke-test the views offline.
const fs = require('fs'), path = require('path');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function compile(file) {
  const s = fs.readFileSync(file, 'utf8'); const re = /<%([=\-#]?)([\s\S]*?)%>/g; let m, last = 0, js = 'var __o="";with(__d){';
  while ((m = re.exec(s))) {
    js += '__o+=' + JSON.stringify(s.slice(last, m.index)) + ';'; last = re.lastIndex;
    if (m[1] === '=') js += '__o+=__e(' + m[2] + ');'; else if (m[1] === '-') js += '__o+=(function(){var v=' + m[2] + ';return v==null?"":v})();'; else if (m[1] !== '#') js += m[2] + '\n';
  }
  js += '__o+=' + JSON.stringify(s.slice(last)) + ';}return __o;';
  return new Function('__d', '__e', 'include', js);
}
function render(file, data) {
  const include = (p, d) => render(path.resolve(path.dirname(file), p.endsWith('.ejs') ? p : p + '.ejs'), Object.assign({}, data, d || {}));
  const d = Object.assign({}, data); d.locals = d; return compile(file)(d, esc, include);
}
module.exports = { render };
