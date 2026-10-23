# Teamrene · CSPC Digital Clearance (CCIT 106)

Digital version of the CSPC paper clearance: students submit a clearance for a purpose, the system generates the
signatories from the student's **actual enrollment** and the school's configuration, signatories clear or hold their
requirement with an **e-signature**, the Registrar and then the Dean sign last, and the completed clearance gets a
**QR code** anyone can verify.

Stack (Weeks 1–8): Node.js · Express · EJS · MySQL/MariaDB (XAMPP works) · Git/GitHub · AI-assisted development.

## Run it
```bash
npm install
cp .env.example .env          # set DB_PASSWORD (empty on XAMPP) and SESSION_SECRET
npm run setup                 # creates the database, tables and SAMPLE data
npm run dev                   # http://localhost:3001
npm test                      # 33 tests, no database needed
```
Generate a session secret: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

> **Honest status:** the business rules, services, notifications, scheduler and all views are covered by automated
> tests. The SQL in `models/` has **not** yet been run against a live MySQL server by the author of this code
> (no database was available when it was generated). Run through `docs/TEST_PLAN.md` once after `npm run setup`.

## Sample accounts (made-up names, marked "Sample" in the admin list)
All emails end in `@my.cspc.edu.ph`. `npm run setup` prints every name, email and password; the full list is in `database/sampleUsers.js`.
Already set up before? Run `npm run rename-samples` to give your existing sample users the new names (passwords, enrollments and clearances are kept).

| Role | Names (email = full name, no spaces) | Password |
|---|---|---|
| Admin | System Admin (`systemadmin@`) | Admin@Teamrene1 |
| Students | Pia Jane Lastrollo (`pilastrollo@`, BSIT 2C) · Analiza Minulas (`anminulas@`, BSIT 2D) | stud123 · stud234 |
| Instructors | Noel Paguio, Ana Reyes, Challiz Omorog (teach 2C) · Maribel Nacario, Ramon Buenaflor, Jocelyn Ordoñez (teach 2D) · Eduardo Belmonte (unassigned) | instructor1 … instructor7 |
| Accounting | Rowena Cabrera · Teodoro Salazar · Marites Fuentes | Acct1#Cspc26 … Acct3#Cspc26 |
| Guidance | Lourdes Alcantara · Benjamin Rosales · Cynthia Mercado | Guid1#Cspc26 … |
| SAS | Armando Villareal · Glenda Pascual · Rodel Santiago | Sas1#Cspc26 … |
| Alumni Treasurer | Felicidad Navarro · Gilbert Aguilar · Imelda Castillo | Alum1#Cspc26 … |
| CSC Treasurer | Jerome Dizon · Katrina Valdez · Paolo Manalo | Csc1#Cspc26 … |
| Library | Teresita Bautista · Rolando Esguerra · Analyn Soriano | Lib1#Cspc26 … |
| Laboratory | Dennis Pineda · Josephine Ramos · Arnel Tolentino | Lab1#Cspc26 … |
| Registrar | Corazon Evangelista · Wilfredo Mendoza · Shirley Panganiban | Reg1#Cspc26 … |
| Dean (CCS) · Dept. head | Rosel Onesa (`roselonesa@`) · Gregorio Almazan | Dean#2026 · DeptHead#2026 |

Pia (2C) and Analiza (2D) take the same subjects with **different instructors**, so you can see that Noel Paguio is
never notified about Analiza's request.

## Subjects, enrollment and bulk import
* **Fix a wrong subject:** Academics → Subjects → **Edit** (code and title). Past clearances keep the code they were created with. An unused subject can also be deleted.
* **Bulk import:** Academics → *Bulk import (CSV / PDF)*. Choose *Subjects*, *Student enrollments* or *Teaching assignments*, pick a CSV (templates are downloadable) or paste rows, press **Check**, review the preview (will import / skipped because already there / errors), then **Import**. Enrollments and assignments go into the current term. Only valid rows are imported, and everything is re-checked on the server.
  * subjects: `code,title` · enrollments: `student_no,subject_code,section` (e.g. `2022-0001,CCIT 106,BSIT 2C`) · assignments: `instructor,subject_code,section` (instructor = employee ID or e-mail)
* **PDF subject list:** upload a PDF with selectable text; the system extracts lines like `CCIT 106  Application Development  3` into the same preview. It is best-effort (layouts vary, scans cannot be read), so always review before importing. Needs `npm install` (uses `pdf-parse`).

## E-signature image
Instructors and office staff open **My signature** (header) to draw or upload a signature (PNG/JPEG, max 200 KB). It is copied onto each clearance **at the moment they sign** and printed on the form, so changing it later never alters past signatures. The image alone signs nothing: every signature still needs the confirmation tick and the signer's password.

## Upgrading an existing database
Run `npm run setup` again. It keeps your data and adds the new `signature_image` columns.

## E-mail rules
* Student: first **two** letters of the first name + surname → `Pia Jane Lastrollo` = `pilastrollo@my.cspc.edu.ph`.
* Instructor, staff, registrar, dean…: full name without spaces → `juandelacruz@my.cspc.edu.ph`.
* Spaces, accents and punctuation are removed; always lowercase. The form fills it in live as the admin types.
* Taken? The form shows the alternatives (with middle initial, then numbers) and keeps everything else. Uniqueness is
  also enforced by a database `UNIQUE` key, so a double click or two admins can never create a duplicate.
* A generated address is **not** a real mailbox. Accounts start as "Not verified"; an admin can record
  "I confirmed this mailbox exists" (audited). No mailbox is ever claimed to exist otherwise.

## How the workflow works
1. **Submit** – student picks a purpose (Graduation, Transfer, Leave of Absence, Others + explanation). The system builds
   the signatory list = offices required for that purpose (admin-configurable, with a stage per office) + the instructors who
   teach the student's enrolled subject **and** section this term. One open clearance per student.
2. **Stages** – default: Stage 1 offices & instructors (any order) → Stage 2 Registrar → Stage 3 Dean. An approval is
   signable only if every approval in an earlier stage is **Cleared** and no compliance issue is open. Enforced in the
   backend transaction, not by hiding buttons. Admins can change stages per purpose under **Purposes**.
3. **Statuses** – *Pending*, *On Hold* (reason required, creates a compliance record, blocks later stages), *Cleared*
   (re-verified by the same signatory), *Overdue* (derived from the deadline; the real Pending/On Hold state is kept),
   *Completed* (Registrar and Dean signed → certificate and QR issued).
4. **E-signature** – clearing needs a confirmation tick **and the signer's password**; a typed name is not a signature.
   Each signature stores signer, role, office, stage, time, IP and an HMAC. Admins cannot sign or bypass anything; the only
   admin override is *revoking* an issued certificate (reason + password + audit).
5. **Notifications** – every role has a 🔔 inbox with request number and a link. Signers hear about a request only when it
   reaches them (Registrar/Dean when they become eligible). Students hear about every change.
6. **Deadlines** – each approval is due after `due_hours` from when it becomes actionable; a notice goes out before the
   deadline, reminders when overdue, and one escalation to the admin (and department head if enabled). Reminders never
   approve anything. Admin → **Settings**.
7. **Final clearance** – printable form (`/forms/:id`, use *Print → Save as PDF*) with signatures, timestamps and QR.
   `/verify/<token>` shows **VALID / EXPIRED / REVOKED / ALREADY USED**.

## Where each requirement lives
| Spec module | Code |
|---|---|
| Roles, access control | `middleware/auth.js`, SQL `scope()` in `models/clearances.js` |
| E-mail generation, duplicates | `lib/emailGen.js`, `routes/admin.js`, `public/js/app.js` |
| Account forms, field-level errors, password checklist, drafts | `views/admin/user_form.ejs`, `views/partials/*`, `public/js/app.js` |
| Academics, enrollment, assignments | `routes/academics.js`, `models/academics.js`, `lib/enrollment.js` |
| Purposes and required signatories | `routes/academics.js` (Purposes), `models/purposes.js` |
| Sequential workflow, compliance | `lib/rules.js`, `models/clearances.js#decideAtomic` |
| E-signatures, audit trail | `services/clearanceService.js`, `models/audit.js`, tables `signatures`, `audit_logs` |
| Notifications, deadlines, escalation | `services/scheduler.js`, `models/notifications.js`, Settings page |
| Dashboards and reports (+CSV) | `routes/staff.js`, `routes/admin.js`, `routes/reports.js` |
| Final document, QR | `routes/forms.js`, `routes/verify.js`, `models/certificates.js` |

## Week 1–8 checklist
Week 1 setup, `.gitignore`, `.env.example` · Week 3 privacy note (only name, student no., e-mail; kept one academic year) ·
Week 4 `docs/REQUIREMENTS.md` · Week 5–6 Express/EJS/MySQL, parameterised queries, no `SELECT *`, error handler ·
Week 7 `CONTRIBUTING.md` (branches + Conventional Commits) · Week 8 `docs/AI_DEVELOPMENT_LOG.md`.

## Not done / simplified (Won't this round)
Sending real e-mail or SMS (notifications are in-app) · e-mail verification link (needs an authorised mail service;
manual admin confirmation instead) · server-generated PDF (browser print to PDF instead) · signing on behalf of someone
(delegation) · automatic deletion after one academic year · per-user permission editor (permissions follow role + office).
