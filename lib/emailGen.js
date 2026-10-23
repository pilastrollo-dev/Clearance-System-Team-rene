// Institutional e-mail generation (pure). A generated address is only a SUGGESTION:
// it does not mean the mailbox exists. See users.email_status.
const DOMAIN = '@my.cspc.edu.ph';

const clean = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Student: first TWO letters of the first name + surname.  Pia Jane Lastrollo -> pilastrollo
const studentUsername = (first, last) => clean(first).slice(0, 2) + clean(last);
// Everyone else: full name without spaces.  Juan Dela Cruz -> juandelacruz
const staffUsername = (first, last) => clean(first) + clean(last);

function base(role, p) {
  if (!clean(p.given_name) || !clean(p.family_name)) return '';
  return role === 'student' ? studentUsername(p.given_name, p.family_name) : staffUsername(p.given_name, p.family_name);
}

// Ordered candidates: plain, with middle initial, then numbered.
function candidates(role, p, max = 12) {
  const b = base(role, p);
  if (!b) return [];
  const out = [b];
  const mi = clean(p.middle_name).slice(0, 1);
  if (mi) {
    out.push(role === 'student' ? clean(p.given_name).slice(0, 2) + mi + clean(p.family_name) : clean(p.given_name) + mi + clean(p.family_name));
  }
  for (let i = 2; i <= max; i++) out.push(b + i);
  return [...new Set(out)].map((u) => u + DOMAIN);
}

// taken: Set of lowercase e-mails already used.  Returns { email, isTaken, alternatives }.
function suggest(role, p, taken = new Set()) {
  const all = candidates(role, p);
  if (!all.length) return { email: '', isTaken: false, alternatives: [] };
  const free = all.filter((e) => !taken.has(e));
  return { email: all[0], isTaken: taken.has(all[0]), alternatives: free.slice(0, 3) };
}

module.exports = { DOMAIN, clean, studentUsername, staffUsername, candidates, suggest };
