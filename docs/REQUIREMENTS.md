# Requirements (Week 4)

Stakeholders: students, instructors, office signers (Accounting, Guidance, SAS, Alumni Treasurer, CSC Treasurer, Library, Laboratory, Registrar, Dean), department head, administrator, anyone checking a QR.

## Functional (Must unless stated)
| ID | Requirement |
|---|---|
| FR-01 | Accounts use `@my.cspc.edu.ph`; the system suggests the e-mail (student: 2 letters of first name + surname; others: full name), flags duplicates, offers alternatives, and the database enforces uniqueness. |
| FR-02 | A generated address is shown as "not verified"; only an audited admin statement marks a mailbox verified. |
| FR-03 | The admin adds/edits/activates/deactivates students, instructors, office staff, registrar, dean and department head with role-specific fields. |
| FR-04 | Forms keep all non-sensitive input when validation or the server fails; errors show beside the field; passwords are never refilled or stored in the browser. |
| FR-05 | Password policy with live checklist and show/hide; temporary passwords are generated, shown once and must be changed at first login. |
| FR-06 | The admin manages programs, sections, subjects, terms, enrollment and teaching assignments; history is kept per term. |
| FR-07 | The admin configures clearance purposes, required offices and their stages, explanations and deadlines. |
| FR-08 | A student submits a clearance for a purpose; signatories are generated from configuration plus real enrollment (subject + section + term). |
| FR-09 | Signatories set Pending / On Hold (reason, type) / Cleared; On Hold creates a compliance record and blocks later stages. |
| FR-10 | An approval can be signed only when all earlier stages are cleared and no compliance issue is open (default: offices/instructors → Registrar → Dean). |
| FR-11 | Clearing requires confirmation and password re-entry; each signature records signer, role, office, stage, time, IP, HMAC. |
| FR-12 | Every important action is written to an append-only audit log. |
| FR-13 | In-app notifications for every event; unrelated users are never notified. |
| FR-14 | Deadlines, "approaching" notices, overdue reminders and one escalation (admin, optional department head); never an automatic approval. |
| FR-15 | On completion a printable clearance and a unique QR code are issued; scanning shows valid / expired / revoked / already used. |
| FR-16 | The admin can revoke a certificate (reason + password + audit); history is preserved. |
| FR-17 | Admin dashboard and filterable reports (date, term, program, section, purpose, office, status) with CSV export for admin and registrar. |
| FR-19 | The admin can edit a wrongly entered subject; an unused subject can be deleted; used subjects are protected. |
| FR-20 | The admin can bulk-import subjects, enrollments and teaching assignments from CSV, and subjects from a text PDF, with a mandatory preview, server-side re-validation and an audit entry. |
| FR-21 | Signers can save a signature image (drawn or uploaded) that is snapshotted onto each clearance they sign; it never replaces the password-confirmed e-signature. |
| FR-18 (Could) | A student cancels a clearance still in progress. |

## Non-functional
| ID | Requirement |
|---|---|
| NFR-01 | Lists render within 2 s for 500 records on the laboratory network. |
| NFR-02 Security | bcrypt (cost 10); parameterised SQL; role/ownership checks inside SQL; CSRF token on every POST; HttpOnly session cookie; login throttling; 128-bit QR token; CSV formula-injection guard; transactions and row locks for approvals. |
| NFR-03 Usability | A first-time student submits a clearance in under 3 minutes. |
| NFR-04 Accessibility | Labels, visible focus, text status labels (not colour alone), `aria-invalid` + described errors, responsive layout. |
| NFR-05 Privacy | Only name, student number and e-mail collected; retention one academic year (purge job: Won't). |
| NFR-06 Integrity | One open clearance per student and one certificate per request are enforced by locks and `UNIQUE` keys. |

## Won't (this round)
Real e-mail/SMS delivery · mailbox verification link · server-side PDF · signing on behalf (delegation) · automatic purge · per-user permission editor.

## Use case UC-01 Submit a clearance
Actor: student. Pre: logged in, enrolled, no clearance in progress.
1. Student chooses a purpose (and explains "Others"). 2. System loads the purpose's offices and the student's instructors from enrollment. 3. System creates the request and approvals and notifies the first-stage signatories. Post: request *In progress*.
Exceptions: 2a not enrolled → message, nothing created. 3a double click / second tab → the row lock refuses the second request. 3b database down → neutral error with reference id.
