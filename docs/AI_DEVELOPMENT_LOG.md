# AI-Assisted Development Log (Week 8)

> Disclosure: this code base was generated with Claude (Anthropic) from the instructor's CCIT 106 handout, the paper clearance form,
> the login design and the team's "master prompt". Every member must read, run and understand it, and complete the last column honestly.

| # | Date | Tool | What I asked | What it produced | What I checked / changed | Verified by |
|---|---|---|---|---|---|---|
| 1 | 2026-10-21 | Claude | Digital clearance system with roles, signing order, notifications, QR, escalation | v1: Express + EJS + MySQL app | Rules/flow tests pass | |
| 2 | 2026-10-22 | Claude | Upgrade to the full CSPC master prompt (enrollment-based signatories, e-mail generation, stages, compliance, e-signatures, audit, reports, settings) | v2: schema v2, `lib/rules.js` stage engine, transactional approvals, admin/academics/purposes/reports, 33 tests | `npm test` passes. **Not yet run against MySQL**: run `docs/TEST_PLAN.md`, review each SQL statement, try every role in the browser | |
| 3 | 2026-10-22 | Claude | Bulk import (CSV/PDF), edit subjects, e-signature image | `lib/importer.js`, import routes/views, subject edit/delete, signature pad + snapshot, 43 tests | Parsing/validation tested. **PDF extraction with the real `pdf-parse` library and all new SQL not yet run**: test with a real PDF | |

Review checklist for AI-written code: placeholders in every query · `<%= %>` (escaped) for user data · ownership/role checks inside SQL · no secrets in the repo · errors never show stack traces · every rule enforced in the backend.
