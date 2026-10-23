// Bulk import helpers (pure, no database): CSV parsing, row validation, and best-effort text extraction from a
// subject-list PDF. Nothing is saved from here: the admin always sees a preview first and the server re-validates.

const norm = (s) => String(s || '').replace(/\s+/g, '').toUpperCase();      // "BSIT 2C" -> "BSIT2C"
const normCode = (s) => String(s || '').toUpperCase().replace(/\s+/g, ' ').trim();

function parseCsv(text) {
  const s = String(text || '').replace(/^\uFEFF/, '');
  const first = s.split(/\r?\n/, 1)[0] || '';
  const delim = first.includes('\t') ? '\t' : first.split(';').length > first.split(',').length ? ';' : ',';
  const rows = []; let row = [], cell = '', q = false;
  const endRow = () => { row.push(cell.trim()); cell = ''; if (row.some((x) => x !== '')) rows.push(row); row = []; };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"' && cell === '') q = true;
    else if (c === delim) { row.push(cell.trim()); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; endRow(); }
    else cell += c;
  }
  if (cell !== '' || row.length) endRow();
  return rows;
}

const toCsv = (rows) => rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? '"' + String(c).replace(/"/g, '""') + '"' : c)).join(',')).join('\n');

const KINDS = {
  subjects: { label: 'Subjects', header: ['code', 'title'], firstNames: ['code', 'subject_code', 'subject'] },
  enrollments: { label: 'Student enrollments', header: ['student_no', 'subject_code', 'section'], firstNames: ['student_no', 'student', 'studentno', 'student_number'] },
  assignments: { label: 'Teaching assignments', header: ['instructor', 'subject_code', 'section'], firstNames: ['instructor', 'employee_id', 'email'] },
};

// Drops a header row if present. Returns { rows, firstLine } where firstLine is the 1-based line of rows[0].
function splitHeader(kind, rows) {
  if (rows.length && KINDS[kind].firstNames.includes(String(rows[0][0]).toLowerCase())) return { rows: rows.slice(1), firstLine: 2 };
  return { rows, firstLine: 1 };
}

// ctx (built from the database by the caller):
//  subjectCodes:Set(upper)  subjectsByCode:Map(upper->id)  studentsByNo:Map(upper->id)  sectionsByKey:Map(norm label->id)
//  instructorsByKey:Map(lowercase employee id / email -> id)  enrolledKeys:Set("sid:subid")  assignedKeys:Set("iid:subid:secid")
function validateRows(kind, rawRows, ctx) {
  const { rows, firstLine } = splitHeader(kind, rawRows);
  const seen = new Set();
  const need = KINDS[kind].header.length;
  return rows.map((cells, i) => {
    const line = firstLine + i;
    const out = (status, message, data) => ({ line, cells, status, message, data });
    if (cells.length < need || cells.slice(0, need).some((c) => c === '')) return out('error', 'Needs ' + need + ' filled columns: ' + KINDS[kind].header.join(', ') + '.');

    if (kind === 'subjects') {
      const code = normCode(cells[0]), title = cells[1].trim();
      if (!/^[A-Z0-9 -]{2,20}$/.test(code)) return out('error', 'Subject code must be 2–20 letters/digits (e.g. CCIT 106).');
      if (title.length < 3 || title.length > 120) return out('error', 'Title must be 3–120 characters.');
      if (seen.has(code)) return out('error', 'Duplicate of an earlier line in this file.');
      seen.add(code);
      if (ctx.subjectCodes.has(code)) return out('skip', 'Already exists: it will be left unchanged.');
      return out('ok', 'Will be added.', { code, title });
    }

    const sub = ctx.subjectsByCode.get(normCode(cells[1]));
    const sec = ctx.sectionsByKey.get(norm(cells[2]));
    if (!sub) return out('error', 'Unknown subject "' + cells[1] + '". Add the subject first.');
    if (!sec) return out('error', 'Unknown section "' + cells[2] + '". Use the full label, e.g. BSIT 2C.');

    if (kind === 'enrollments') {
      const sid = ctx.studentsByNo.get(cells[0].trim().toUpperCase());
      if (!sid) return out('error', 'No student with number "' + cells[0] + '".');
      const key = sid + ':' + sub;
      if (seen.has(key)) return out('error', 'Duplicate of an earlier line in this file.');
      seen.add(key);
      if (ctx.enrolledKeys.has(key)) return out('skip', 'Already enrolled in that subject this term.');
      return out('ok', 'Will be enrolled.', { student_id: sid, subject_id: sub, section_id: sec });
    }

    const iid = ctx.instructorsByKey.get(cells[0].trim().toLowerCase());
    if (!iid) return out('error', 'No instructor with employee ID / email "' + cells[0] + '".');
    const key = iid + ':' + sub + ':' + sec;
    if (seen.has(key)) return out('error', 'Duplicate of an earlier line in this file.');
    seen.add(key);
    if (ctx.assignedKeys.has(key)) return out('skip', 'Already assigned this term.');
    return out('ok', 'Will be assigned.', { instructor_id: iid, subject_id: sub, section_id: sec });
  });
}

const summarize = (results) => ({ ok: results.filter((r) => r.status === 'ok').length, skip: results.filter((r) => r.status === 'skip').length, error: results.filter((r) => r.status === 'error').length });

// ---- best-effort subject list from PDF text (the admin must review the preview) ----
const SKIP_WORDS = /^(page|sy|ay|year|semester|sem|term|total|units?)$/i;
function rowsFromPdfText(text) {
  const out = [], seen = new Set();
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim();
    const m = /^([A-Za-z]{2,6})\s?-?\s?(\d{2,4}[A-Za-z]?)\s*[-–:]?\s+(.{3,})$/.exec(line);
    if (!m || SKIP_WORDS.test(m[1])) continue;
    let title = m[3];
    for (let k = 0; k < 4; k++) title = title.replace(/\s+\(?\d+(\.\d+)?\s*(units?|lec|lab|hrs?)?\)?\s*$/i, '');   // trailing units / hours
    title = title.replace(/\s+[-–:]\s*$/, '').trim();
    if (title.length < 3 || /^(of|to)\s+\d/i.test(title)) continue;
    const code = (m[1] + ' ' + m[2]).toUpperCase();
    if (seen.has(code)) continue;
    seen.add(code); out.push([code, title]);
  }
  return out;
}

const TEMPLATES = {
  subjects: 'code,title\nCCIT 106,Application Development\nIT 201,Data Structures\n',
  enrollments: 'student_no,subject_code,section\n2022-0001,CCIT 106,BSIT 2C\n2022-0001,IT 201,BSIT 2C\n',
  assignments: 'instructor,subject_code,section\nEMP-1001,CCIT 106,BSIT 2C\nnoelpaguio@my.cspc.edu.ph,IT 201,BSIT 2C\n',
};

module.exports = { KINDS, TEMPLATES, norm, normCode, parseCsv, toCsv, splitHeader, validateRows, summarize, rowsFromPdfText };
