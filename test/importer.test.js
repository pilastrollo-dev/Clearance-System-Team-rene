const test = require('node:test');
const assert = require('node:assert');
const I = require('../lib/importer');
const S = require('../lib/signature');
const { renderPage } = require('../services/pdfText');

const ctx = () => ({
  subjectCodes: new Set(['CCIT 106']), subjectsByCode: new Map([['CCIT 106', 1], ['IT 201', 2]]),
  studentsByNo: new Map([['2022-0001', 10]]), sectionsByKey: new Map([['BSIT2C', 5]]),
  instructorsByKey: new Map([['emp-1001', 20], ['noel@my.cspc.edu.ph', 20]]), enrolledKeys: new Set(['10:2']), assignedKeys: new Set(['20:2:5']),
});

test('CSV: quotes, BOM, CRLF, semicolons and blank lines', () => {
  assert.deepStrictEqual(I.parseCsv('\uFEFFcode,title\r\n"CCIT 106","Apps, Dev ""101"""\r\n\r\nIT 201,Data\r\n'), [['code', 'title'], ['CCIT 106', 'Apps, Dev "101"'], ['IT 201', 'Data']]);
  assert.deepStrictEqual(I.parseCsv('a;b\nc;d'), [['a', 'b'], ['c', 'd']]);
  assert.strictEqual(I.toCsv([['A', 'x, "y"']]), 'A,"x, ""y"""');
});

test('subjects: new / existing (skipped) / duplicate in file / bad rows', () => {
  const r = I.validateRows('subjects', I.parseCsv('code,title\nccit 106,Apps\nIT 301,Networks\nit 301,Again\nX,Short\nMATH 101,'), ctx());
  assert.deepStrictEqual(r.map((x) => x.status), ['skip', 'ok', 'error', 'error', 'error']);
  assert.strictEqual(r[1].data.code, 'IT 301');
  assert.deepStrictEqual(r.map((x) => x.line), [2, 3, 4, 5, 6]);
  assert.deepStrictEqual(I.summarize(r), { ok: 1, skip: 1, error: 3 });
});

test('enrollments: valid, already enrolled, unknown student / subject / section', () => {
  const csv = '2022-0001,CCIT 106,bsit 2c\n2022-0001,IT 201,BSIT 2C\n9999,CCIT 106,BSIT 2C\n2022-0001,NOPE 1,BSIT 2C\n2022-0001,CCIT 106,BSIT 9Z\n2022-0001,CCIT 106,BSIT 2C';
  const r = I.validateRows('enrollments', I.parseCsv(csv), ctx());
  assert.deepStrictEqual(r.map((x) => x.status), ['ok', 'skip', 'error', 'error', 'error', 'error']);
  assert.deepStrictEqual(r[0].data, { student_id: 10, subject_id: 1, section_id: 5 });
  assert.match(r[5].message, /Duplicate/);
});

test('assignments accept employee ID or e-mail and skip existing ones', () => {
  const r = I.validateRows('assignments', I.parseCsv('instructor,subject_code,section\nEMP-1001,CCIT 106,BSIT 2C\nnoel@my.cspc.edu.ph,IT 201,BSIT 2C\nnobody,CCIT 106,BSIT 2C'), ctx());
  assert.deepStrictEqual(r.map((x) => x.status), ['ok', 'skip', 'error']);
});

test('PDF text -> subject rows (units stripped, headers/page numbers ignored)', () => {
  const text = ['Camarines Sur Polytechnic Colleges', 'Course Code   Descriptive Title   Units', 'CCIT 106   Application Development   3', 'IT-201 - Data Structures and Algorithms (3 units)',
    'MATH101 Discrete Mathematics 3 0 3', 'Page 10 of 12', 'Total 9', 'CCIT 106   Application Development   3'].join('\n');
  assert.deepStrictEqual(I.rowsFromPdfText(text), [['CCIT 106', 'Application Development'], ['IT 201', 'Data Structures and Algorithms'], ['MATH 101', 'Discrete Mathematics']]);
  assert.deepStrictEqual(I.rowsFromPdfText('nothing useful here'), []);
});

test('signature image validation: PNG/JPEG only, size and real magic bytes', () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(300, 1)]).toString('base64');
  assert.ok(S.validateSignatureDataUrl('data:image/png;base64,' + png).ok);
  assert.match(S.validateSignatureDataUrl('data:image/svg+xml;base64,PHN2Zz4=').error, /PNG or JPEG/);
  assert.match(S.validateSignatureDataUrl('data:image/jpeg;base64,' + png).error, /not a real JPEG/);
  assert.match(S.validateSignatureDataUrl('data:image/png;base64,' + Buffer.alloc(300 * 1024, 1).toString('base64')).error, /too large/);
  assert.match(S.validateSignatureDataUrl('data:image/png;base64,AAAA').error, /empty/);
  assert.match(S.validateSignatureDataUrl(undefined).error, /No signature/);
  assert.ok(!S.isSafeImage('javascript:alert(1)') && !S.isSafeImage('data:image/svg+xml;base64,AAAA'));
});

test('PDF table rows: cells on one line are tab-separated, new lines start where y changes', async () => {
  const item = (str, y) => ({ str, transform: [1, 0, 0, 1, 10, y] });
  const page = { getTextContent: async () => ({ items: [item('Code', 700), item('Title', 700), item('CCIT 106', 680), item('Application Development', 680), item('3', 680), item('IT 201', 660.5), item('Data Structures', 660), item('3', 660)] }) };
  const text = await renderPage(page);
  assert.strictEqual(text, 'Code\tTitle\nCCIT 106\tApplication Development\t3\nIT 201\tData Structures\t3');
  assert.deepStrictEqual(I.rowsFromPdfText(text), [['CCIT 106', 'Application Development'], ['IT 201', 'Data Structures']]);
});
