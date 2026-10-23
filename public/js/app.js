(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // Print button and confirmation dialogs
  document.addEventListener('click', function (e) { if (e.target.closest('[data-print]')) window.print(); });
  document.addEventListener('submit', function (e) {
    var msg = e.target.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) e.preventDefault();
  });

  // Show / hide password
  $$('[data-toggle-pw]').forEach(function (b) {
    b.addEventListener('click', function () {
      var i = document.getElementById(b.getAttribute('data-toggle-pw'));
      var show = i.type === 'password'; i.type = show ? 'text' : 'password';
      b.textContent = show ? 'Hide' : 'Show'; b.setAttribute('aria-pressed', String(show));
    });
  });

  // Live password checklist (same rules as lib/rules.js; the server re-checks everything)
  var RULES = { len: function (p) { return p.length >= 8; }, upper: function (p) { return /[A-Z]/.test(p); }, lower: function (p) { return /[a-z]/.test(p); },
    num: function (p) { return /[0-9]/.test(p); }, special: function (p) { return /[^A-Za-z0-9]/.test(p); } };
  $$('[data-pw-check]').forEach(function (inp) {
    function paint() {
      $$('#pw-rules li').forEach(function (li) {
        var ok = RULES[li.getAttribute('data-rule')](inp.value);
        li.classList.toggle('ok', ok); $('.tick', li).textContent = ok ? '✓' : '○';
      });
    }
    inp.addEventListener('input', paint); paint();
  });

  // Role-dependent fields in the admin user form
  var role = $('#role');
  if (role) {
    var office = $('#office_code');
    var sync = function () {
      $$('[data-for]').forEach(function (el) {
        var show = el.getAttribute('data-for').split(' ').indexOf(role.value) !== -1;
        var need = el.getAttribute('data-office');
        if (need && role.value === 'staff') show = !!office && need.split(' ').indexOf(office.value) !== -1;
        el.hidden = !show;
      });
    };
    role.addEventListener('change', sync); if (office) office.addEventListener('change', sync); sync();
  }

  // Section list follows the chosen program
  var prog = $('#program_id'), sec = $('#section_id');
  if (prog && sec) {
    var filter = function () {
      $$('option', sec).forEach(function (o) { var p = o.getAttribute('data-program'); o.hidden = !!p && !!prog.value && p !== prog.value; });
      var cur = sec.options[sec.selectedIndex]; if (cur && cur.hidden) sec.value = '';
    };
    prog.addEventListener('change', filter); filter();
  }

  // Suggested institutional e-mail (mirrors lib/emailGen.js). Generated address != verified mailbox.
  var D = '@my.cspc.edu.ph';
  var clean = function (s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ''); };
  var email = $('#email'), gn = $('#given_name'), fn = $('#family_name');
  if (email && gn && fn && role) {
    var touched = !!email.value;
    email.addEventListener('input', function () { touched = true; });
    document.addEventListener('draft-restored', function () { if (email.value) touched = true; });
    var gen = function () {
      if (touched) return;
      var f = clean(gn.value), l = clean(fn.value);
      email.value = f && l ? (role.value === 'student' ? f.slice(0, 2) + l : f + l) + D : '';
    };
    [gn, fn, role].forEach(function (el) { el.addEventListener('input', gen); el.addEventListener('change', gen); });
    $$('[data-suggest]').forEach(function (b) { b.addEventListener('click', function () { email.value = b.getAttribute('data-suggest'); touched = true; email.focus(); }); });
  }

  // Draft persistence: non-sensitive fields only (never passwords), cleared after a successful save.
  var cd = $('meta[name="clear-draft"]');
  if (cd && cd.content) { try { sessionStorage.removeItem('draft:' + cd.content); } catch (e) { /* ignore */ } }
  $$('form[data-draft]').forEach(function (form) {
    var key = 'draft:' + form.getAttribute('data-draft');
    var fields = function () { return $$('input, select, textarea', form).filter(function (el) { return el.name && el.type !== 'password' && el.type !== 'hidden' && el.type !== 'submit' && el.name !== '_csrf'; }); };
    if (form.getAttribute('data-fresh') === '1') {
      try {
        var saved = JSON.parse(sessionStorage.getItem(key) || 'null');
        if (saved) { fields().forEach(function (el) { if (saved[el.name] !== undefined) { if (el.type === 'checkbox') el.checked = saved[el.name] === true; else el.value = saved[el.name]; } }); form.dispatchEvent(new Event('draft-restored', { bubbles: true })); }
      } catch (e) { /* ignore */ }
    }
    var save = function () {
      try { var o = {}; fields().forEach(function (el) { o[el.name] = el.type === 'checkbox' ? el.checked : el.value; }); sessionStorage.setItem(key, JSON.stringify(o)); } catch (e) { /* ignore */ }
    };
    form.addEventListener('input', save); form.addEventListener('change', save);
  });
  if ($('#role')) { var r = $('#role'); r.dispatchEvent(new Event('change')); }


  // ---- Bulk import: read files in the browser, then show them for review ----
  var kindSel = $('#import-form #kind');
  if (kindSel) {
    var cols = { subjects: 'code, title', enrollments: 'student_no, subject_code, section (e.g. BSIT 2C)', assignments: 'instructor (employee ID or email), subject_code, section' };
    var syncKind = function () {
      $('#cols-hint').textContent = cols[kindSel.value]; $('#tpl').setAttribute('href', '/admin/import/template/' + kindSel.value);
      $('#pdf-box').hidden = kindSel.value !== 'subjects';
    };
    kindSel.addEventListener('change', syncKind); syncKind();
    var csvFile = $('#csv_file');
    csvFile.addEventListener('change', function () {
      var f = csvFile.files[0]; if (!f) return;
      var r = new FileReader(); r.onload = function () { $('#csv_text').value = String(r.result); $('#pdf_base64').value = ''; }; r.readAsText(f);
    });
    var pdfFile = $('#pdf_file');
    pdfFile.addEventListener('change', function () {
      var f = pdfFile.files[0]; if (!f) return;
      if (f.size > 5 * 1024 * 1024) { alert('That PDF is larger than 5 MB.'); pdfFile.value = ''; return; }
      var r = new FileReader();
      r.onload = function () { var b = String(r.result); $('#pdf_base64').value = b.slice(b.indexOf(',') + 1); $('#csv_text').value = ''; };
      r.readAsDataURL(f);
    });
  }

  // ---- Signature pad (draw or upload). Output is a PNG data URL; the server re-validates it. ----
  var pad = $('#sigpad');
  if (pad) {
    var ctx = pad.getContext('2d'), drawing = false, drawn = false;
    var reset = function () { ctx.clearRect(0, 0, pad.width, pad.height); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, pad.width, pad.height); drawn = false; };
    ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0b1f4b'; reset();
    var pos = function (e) { var b = pad.getBoundingClientRect(); return { x: (e.clientX - b.left) * pad.width / b.width, y: (e.clientY - b.top) * pad.height / b.height }; };
    pad.addEventListener('pointerdown', function (e) { drawing = true; pad.setPointerCapture(e.pointerId); var p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); });
    pad.addEventListener('pointermove', function (e) { if (!drawing) return; var p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); drawn = true; });
    ['pointerup', 'pointercancel'].forEach(function (n) { pad.addEventListener(n, function () { drawing = false; }); });
    $('#sig-clear').addEventListener('click', reset);
    $('#sig-file').addEventListener('change', function (ev) {
      var f = ev.target.files[0]; if (!f) return;
      var img = new Image(), url = URL.createObjectURL(f);
      img.onload = function () {
        reset(); var k = Math.min(pad.width / img.width, pad.height / img.height);
        ctx.drawImage(img, (pad.width - img.width * k) / 2, (pad.height - img.height * k) / 2, img.width * k, img.height * k); drawn = true; URL.revokeObjectURL(url);
      };
      img.src = url;
    });
    $('#sig-form').addEventListener('submit', function (e) {
      var msg = $('#sig-msg');
      if (!drawn) { e.preventDefault(); msg.textContent = 'Draw or upload your signature first.'; msg.hidden = false; return; }
      $('#sig-image').value = pad.toDataURL('image/png');
    });
  }

  // Prevent double submission (the database also refuses duplicates)
  $$('form').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (e.defaultPrevented) return;
      var btn = $('button[type=submit]:not([data-allow-multi])', form);
      if (form.getAttribute('data-busy') === '1') { e.preventDefault(); return; }
      form.setAttribute('data-busy', '1'); if (btn) { btn.setAttribute('aria-busy', 'true'); btn.disabled = true; var t = btn.textContent; btn.textContent = 'Please wait…'; btn.setAttribute('data-label', t); }
    });
  });
  window.addEventListener('pageshow', function () {
    $$('form[data-busy]').forEach(function (f) { f.removeAttribute('data-busy'); var b = $('button[aria-busy]', f); if (b) { b.disabled = false; b.removeAttribute('aria-busy'); b.textContent = b.getAttribute('data-label') || b.textContent; } });
  });
})();
