const test = require('node:test');
const assert = require('node:assert');
const E = require('../lib/emailGen');
const { people } = require('../database/sampleUsers');

test('every sample user has a real-looking name (not a role) and a unique, rule-following e-mail', () => {
  const list = people();
  const emails = list.map((x) => E.suggest(x.role === 'student' ? 'student' : 'staff', { given_name: x.given, family_name: x.family }).email);
  assert.strictEqual(new Set(emails).size, list.length);
  for (const x of list.filter((u) => u.role !== 'admin')) assert.ok(!/staff|instructor|office|admin|treasurer|registrar|dean|head/i.test(x.given + ' ' + x.family), x.given + ' ' + x.family + ' looks like a role');
  assert.ok(emails.includes('systemadmin@my.cspc.edu.ph'));
  assert.ok(emails.every((e) => /^[a-z0-9]+@my\.cspc\.edu\.ph$/.test(e)));
  assert.ok(emails.includes('pilastrollo@my.cspc.edu.ph') && emails.includes('anminulas@my.cspc.edu.ph') && emails.includes('roselonesa@my.cspc.edu.ph') && emails.includes('challizomorog@my.cspc.edu.ph'));
  assert.strictEqual(new Set(list.map((x) => x.employee_id).filter(Boolean)).size, list.filter((x) => x.employee_id).length);
  assert.strictEqual(list.filter((x) => x.office === 'REG').length, 3);
});
