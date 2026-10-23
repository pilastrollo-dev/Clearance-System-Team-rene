# Test plan (spec scenarios)

`npm test` runs the automated checks (no database). Items marked **DB** must be tried once against MySQL after `npm run setup`.

| # | Scenario | Automated | Manual with the database |
|---|---|---|---|
| 1 | Student sees instructors from real enrollment | `flow.test` scenario 1+5, `rules.test` enrollment | Log in as `pilastrollo@` → dashboard lists Noel/Challiz/Ana; `anminulas@` lists Four/Five/Six |
| 2 | E-mail rules | `rules.test` (student 2-letter rule, staff full name, accents) | Admin → Add user, type a name, watch the e-mail fill in |
| 3 | Duplicate e-mails | `rules.test` alternatives | **DB** add the same name twice: alternatives appear, nothing is created; DB `UNIQUE` key is the last guard |
| 4 | Form persistence | `views.test` (values kept, passwords blank) | Enter a weak password / mismatch: other fields stay; stop MySQL and submit: draft restores after reload |
| 5 | Only relevant instructors notified | `flow.test` | Submit as Pia, log in as Instructor Four: no request |
| 6 | Compliance issue blocks dependents | `rules.test`, `flow.test` | Accounting places On Hold; Registrar's Clear is refused |
| 7 | Registrar restriction | `flow.test` | Try POSTing to `/staff/approvals/:id` early: refused by the server |
| 8 | Dean restriction | `flow.test` | same, before the Registrar signs |
| 9 | Final document only after the Dean | `flow.test` | Complete a request: certificate + QR + printable form appear |
| 10 | Overdue notifies, never approves | `flow.test` scheduler | Settings → due 1 h, "Run follow-up check now"; statuses unchanged |
| 11 | Advance only after verified resolution | `rules.test`, `flow.test` | Hold → Clear by the same office → Registrar becomes eligible |
| 12 | Role security | middleware + SQL scope (review) | **DB** student opens `/admin`: 403; instructor opens another instructor's approval id: 404 |
| 13 | Audit history | engine writes audit rows in the same transaction | **DB** Admin → Audit shows submit, holds, signatures, completion, revoke |
| 14 | Concurrency | design: `SELECT … FOR UPDATE` on the request, `UNIQUE(certificates.request_id)` | **DB** two browsers press *Clear* on the last two items at once: exactly one certificate |
| 15 | Mailbox not falsely verified | `views.test` | New users show "Not verified"; only the admin button changes it (audited) |

## Added: import, subject edit, signature image
| Scenario | Automated | Manual with the database |
|---|---|---|
| CSV parsing and row validation (new / skipped / duplicate / unknown) | `importer.test` | Import `enrollments-template.csv` after editing student numbers: preview, then import; run it twice: second time everything is "skipped" |
| PDF text to subject rows, tab-joined columns | `importer.test` (parser + page renderer with a fake page) | **Needs `npm install`:** upload a real subject-list PDF; review preview. Try a scanned PDF: clear error |
| Edit / delete subject | `views.test` | Edit a code to a duplicate: field error, other fields kept. Delete a used subject: refused |
| Signature image validation (PNG/JPEG only, size, magic bytes, no SVG) | `importer.test` | Draw and save; sign a clearance; change the signature; the old form still shows the old image |
