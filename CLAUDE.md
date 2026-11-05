# CLAUDE.md

Guidance for Claude Code (and any developer) working in this repository.

## Project

**Franchise Online Agreement Portal.** Franchise partners register online, accept a personalised franchise agreement, verify email and mobile, and pass a two-step approval (Accounts, then Manager). On final approval a PDF agreement is generated automatically. Only the Manager downloads it and emails it to the franchisee.

- **[PRD.md](PRD.md) is the source of truth** for screens, fields, statuses, business rules, notifications and acceptance tests. Read the relevant section before building any feature.
- The original brief is `Franchise Online Agreement Portal – Business Requirements.pdf`. **Where it conflicts with PRD.md, PRD.md wins.**
- **The product owner is non-technical.** Explain trade-offs in plain business language. Don't silently change business rules. If something in the PRD is ambiguous or marked as an open question (PRD §18.2), build the documented default and say so.

## Tech stack

The product owner chose **MongoDB instead of Supabase** (PRD D14), so this is a MERN-style app with our own backend.

- **Frontend (`client/`):** React + TypeScript + Vite + Tailwind CSS. Talks only to our REST API and never to MongoDB directly.
- **Backend (`server/`):** Node.js + Express + TypeScript REST API.
- **Database:** MongoDB Atlas with Mongoose models. Requires a replica set for transactions, which Atlas provides.
- **Auth:** implemented in the backend.
  - Passwords are hashed with bcrypt or Argon2.
  - Sessions use JWTs in secure, HTTP-only, SameSite cookies, with refresh-token rotation.
  - Role-based access middleware runs on every route.
  - Login lockout and rate limiting are required.
- **File storage:** private S3-compatible bucket. MongoDB stores file metadata and keys only. Files are served after a permission check by streaming them or issuing a short-lived presigned URL (≤ 5 minutes).
- **Scheduled jobs:** a MongoDB-backed scheduler (e.g. Agenda) for the daily 09:00 IST reminder run, OTP cleanup and Pending Verification purge. It must run exactly once, even with several server instances.
- **PDF:** generated in the backend, triggered by Manager approval.
- **Email:** transactional email provider, not yet chosen. **SMS OTP:** Indian SMS gateway with DLT templates, not yet chosen. Wrap both behind a small provider interface so they can be swapped easily.
- **Migrations:** migrate-mongo (or equivalent) under `server/migrations/`, for indexes and data-shape changes.

## Commands

Run from the repository root (npm workspaces: `shared/`, `server/`, `client/`):

| Command | What it does |
|---|---|
| `npm install` | Install all dependencies |
| `npm run dev` | Start everything: local database, API (http://localhost:4000) and website (http://localhost:5173) |
| `npm run db` | Start only the local development MongoDB (single-node replica set `rs0`, data in `server/.data/db`) |
| `npm run migrate` | Apply pending migrations (the API also applies them on startup) |
| `npm run seed:dev` | Create dev logins `admin` / `accounts` / `manager` (`@portal.local`), password `Portal@2026`. Development only |
| `npm run typecheck` | TypeScript check across all workspaces |
| `npm test` | End-to-end API tests (6 suites) on a throwaway in-memory database (never touches dev data) |

- The local database is downloaded and run by `server/src/scripts/local-db.ts` (via mongodb-memory-server's binary). It is for development only; production uses MongoDB Atlas.
- Server settings live in `server/.env` (copy from `server/.env.example`).
- The Vite dev server proxies `/api` to the API, so cookies are same-origin in development.

## Git workflow (mandatory)

- Branches: **`development`** (all work) and **`production`** (live code).
- **Commit before starting each build phase**, then commit the phase's work. Push to `development` only.
- **Never push directly to `production`.** It is updated only by merging `development` after a proper code review (a reviewed pull request).
- The rule is enforced locally by `.githooks/pre-push` (enable once per clone with `git config core.hooksPath .githooks`) and must also be enforced on the hosting service with branch protection on `production` (pull request + approving review required, direct pushes blocked).

## Build progress

1. ✅ **Foundation:** project setup, local DB, migrations, secure login/refresh/logout, lockout, audit log, branding, role menus with placeholders
2. ✅ **Admin tools:** Accounts/Manager user management with emailed set-password links, forgot/reset password, settings + public holidays, audit log screen, agreement content management (PDF upload as the default, or TipTap typed text with merge fields; publish/activate/deactivate, single active version). The public `/register` page already shows the active agreement with the mandatory acceptance checkbox, and `recordAcceptance()` in `agreement.service.ts` is ready for step 3's submit. Emails use the `dev_outbox` provider, viewable at `/dev/mailbox` in development only
3. ✅ **Public registration form:** five sections with live validation and browser autosave; files upload on selection (`PUT /api/public/uploads/:kind`, content-sniffed, size limits from Settings, one-time tokens, 24 h expiry); `POST /api/public/registrations` runs the duplicate rules and saves registration + documents + submission v1 + agreement acceptance + duplicate flag in one transaction, status `pending_verification`. Tests: `server/src/tests/registration.e2e.ts`
4. ✅ **Verification and Franchise User screens:** email/SMS OTP (`otp.service.ts`: HMAC-hashed 6-digit codes, expiry/cooldown/attempts from Settings, max 6 codes per hour), set password → one transaction creates the `franchise_user`, sets `pending_accounts`, `applicationId` (`APP-YYYY-NNNN`), `panLock`/`gstLock`, history entry, then logs in; N2/N3 emails. SMS uses the `dev_outbox` provider (development only). Franchise Dashboard, My Application (versions, documents, history), My Profile (change password; change email/mobile with OTP when not under review). All `/api/franchise/*` queries are scoped to the user's own registration. Tests: `server/src/tests/verification.e2e.ts`
5. ✅ **Accounts review and resubmission:** `workflow.service.ts` (pick-up, approve, reject, Admin reassign / move-all; each a conditional `findOneAndUpdate` + history + assignment history + audit in one transaction), `review.service.ts` (A1 dashboard, A2 queues with search/filters/business days, A3 review view with "changes since last review", A4 reviewed list; Accounts see Pending Accounts + what they reviewed), `resubmission.service.ts` (F3: keep-or-replace documents via `keep:<docId>`, same agreement version re-accepted, PAN/GST re-check excluding self, new duplicate matches only, back to same reviewer or straight to Manager). Accounts users with applications cannot be deactivated until they are handed over (AD8). N4–N7, N10 emails. Shared business-day maths in `shared/src/workflow.ts`. Tests: `server/src/tests/workflow.e2e.ts`
6. ✅ **Manager review and the agreement PDF:** `workflow.service.ts` `approveByManager` (one transaction: status, `FRN/YYYY/NNNN` via `counters` `agreement_ref_YYYY`, history, `generatedagreements` record, audit; then generation) and `rejectByManager`; `agreement-pdf.ts` builds the A4 PDF with pdf-lib (details pages, typed text via htmlparser2 or the uploaded PDF's pages scaled above the footer band, acceptance record, footer + "Page X of Y" on every page); `generated-agreement.service.ts` (generate/retry with failure alerts N12, view/download/send N11 with attachment, append-only `agreementemaillogs`, every view/download/email audited). `/api/manager/*` is the ONLY route to the PDF (Manager role). Screens M1–M5. Tests: `server/src/tests/manager.e2e.ts`
   - ✅ **Legal compliance (India, DPDP Act):** public `/privacy-policy` and `/terms` pages (`client/src/pages/legal/`, versions in `shared/src/legal.ts` `LEGAL_DOCUMENTS`), `LegalFooter` on every layout, mandatory `legalConsent` checkbox on register and resubmit saved by `recordConsent()` (append-only `consentrecords`), Settings fields `registeredAddress` / `grievanceOfficerName` / `grievanceOfficerEmail`. **Delete my account:** `data-request.service.ts` (request / cancel in My Profile, Admin AD12 erase or decline; erase is refused for approved agreements; status `withdrawn`). Tests: `server/src/tests/privacy.e2e.ts`
7. Admin oversight: registrations, duplicate review, approval tracking, exports
8. All notifications and business-day reminders
9. Acceptance-checklist testing (PRD §16) and go-live preparation (Atlas, S3, email/SMS providers)

Screens not built yet show a "planned for step N" placeholder; the step numbers come from `client/src/navigation.ts`.

## Non-negotiable rules

1. **Never delete or reset database data.**
   - Every index or data-shape change is a new migration script under `server/migrations/`.
   - Don't edit migrations that have already been applied.
   - Never call `dropDatabase`, drop collections, or run `deleteMany({})` against any shared or remote database.
   - Never rely on Mongoose `autoIndex` in production; create indexes through migrations.
2. **Enforce permissions in the backend on every request.**
   - Use auth plus role middleware, and scope every query by role and ownership in the service layer (for example, a franchise user's queries always filter by their own `userId`).
   - Hiding a button is never the security control.
   - Write API tests that prove each role is refused data it must not see.
3. **Status changes only go through dedicated workflow endpoints** (approve, reject, resubmit, pick-up, reassign). There is no generic "update registration" endpoint that can change the status.
   - Each endpoint checks role, current status, assignment and the open duplicate flag.
   - Use a conditional `findOneAndUpdate` (filtering on the expected current status or assignee) so that two users clicking at once can't both win.
   - Wrap multi-document changes in a MongoDB transaction: the status change, history entry, reference number, PDF record and audit entry.
   - Allowed transitions are listed in PRD §6.2.
4. **Agreement PDF access is Manager only** for download and email. Accounts and Franchise Users get no access at all, including through direct storage URLs. Admin's access is open question Q1; the default is metadata and email history only. All files live in **private** buckets and are served through short-lived signed URLs issued after a permission check.
5. **Public sign-up only ever creates the `franchise_user` role.** Internal users (`admin`, `accounts`, `manager`) are created by Admin only. The role is always read from the database, never from client input.
6. **The PDF footer appears on every page, with exactly this text:**
   `This is a computer-generated digital agreement and does not require any physical or digital signature.`
7. **No mock data or fake providers in the final product.** Seed data is for local development only.
8. **There are no fees, payments or financial calculations** anywhere in the product (PRD D1).
9. **Write important actions to the append-only audit log** (PRD AD10). Never update or delete audit rows.
   - **The only exception to "permanent records / files are never changed or deleted"** is the DPDP erasure in `data-request.service.ts` `eraseRequest()` (PRD D16, A28), run by Admin on an applicant's request. Do not add other bypasses of `appendOnly`.
10. **Uniqueness is enforced by MongoDB unique indexes**, not only in the UI:
    - one registration per PAN
    - one per GST, using a partial unique index because GST is optional
    - one user account per login email (stored lowercase) and per login mobile

    Abandoned `pending_verification` records must not hold a PAN or GST forever, so exclude them from the unique index or purge them on schedule.
    Implemented as `panLock` / `gstLock` on registrations (partial unique indexes), set only when the application leaves `pending_verification` (step 4). Duplicate checks compare against verified registrations only.
11. **Secrets stay in environment variables** (`.env`, never committed): the MongoDB URI, JWT secrets, storage keys, and email and SMS API keys. Provide a `.env.example`.

## Domain cheat-sheet

- **Roles:** `admin`, `accounts`, `manager`, `franchise_user`.
- **Statuses:** `pending_verification` → `pending_accounts` → `pending_manager` → `approved`, plus `rejected_by_accounts` and `rejected_by_manager`, and `withdrawn` (data erased on request, final).
  - "Accounts Approved" is a history event, not a status.
  - Resubmitting after `rejected_by_accounts` goes to `pending_accounts`, auto-reassigned to the same reviewer if they are still active.
  - Resubmitting after `rejected_by_manager` goes **straight to `pending_manager`**.
  - There is no limit on resubmissions.
- **The applicant / authorised signatory is the account owner.** Their email and mobile are OTP-verified and used for login. Contact persons are not verified.
- **Duplicates:**
  - A matching PAN or GST blocks the registration.
  - A signatory email or mobile that already has an account is blocked ("log in instead").
  - An email or mobile matching another registration raises a **duplicate flag** that Admin resolves. While the flag is open, Accounts cannot approve.
- **Agreement versions:**
  - Exactly one version is active at a time, and published versions are immutable.
  - A registration keeps the version it first accepted.
  - Two formats (PRD D15): `pdf` (uploaded, shown as-is, not personalised; default) and `text` (typed, merge fields).
  - Each acceptance is an append-only `agreementacceptances` row storing a snapshot: personalised HTML for `text`, or the PDF storage key and SHA-256 for `pdf`. Save it with `recordAcceptance()` inside the submission's transaction.
  - Stored files are never overwritten or deleted (`server/src/lib/storage.ts`). Development uses the `local` storage provider (`server/storage/`), which is refused in production.
  - Merge fields use `{{snake_case}}` names (PRD §10.4), for typed agreements only.
- **Submissions are versioned.** Each resubmission snapshots all data and document references, and old versions are never overwritten.
- **Business days** are Monday to Friday minus the admin-managed holidays. Reminder intervals of 2 / repeat 2 / escalate 5 come from settings, not constants.
- **Agreement reference number:** `FRN/YYYY/NNNN`, assigned atomically on Manager approval. Use a `counters` collection with `findOneAndUpdate({ _id: year }, { $inc: { seq: 1 } }, { upsert: true })`, never a client-generated value.
- **Validation:** shared validation helpers are used in both the browser and the server.
  - PAN: `^[A-Z]{5}[0-9]{4}[A-Z]$`
  - GSTIN: `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$`, where characters 3–12 must equal the PAN
  - Mobile: `^[6-9][0-9]{9}$`
- **Dates** are stored in UTC and displayed in IST as DD-MM-YYYY.
- **Legal text changes:** when the Privacy Policy or Terms wording changes, raise its `version` and `effectiveDate` in `LEGAL_DOCUMENTS` so new consents record the new version.

## Conventions

- TypeScript `strict` mode. Avoid `any`.
- **Backend layering:** routes → controllers → services → Mongoose models. Business rules live in services, not in routes or models.
- **Frontend:** keep API calls in one client layer (`client/src/api/`) rather than scattered through components.
- **Validation:** request bodies are validated with a schema library (e.g. Zod). Share the validation schemas and types between `client/` and `server/` through a `shared/` package so browser and server rules never drift.
- **Data shapes:** store each submission version as an immutable snapshot document. Reference documents by ID instead of embedding large or growing arrays (history, logs) inside the registration document.
- Branding (logo, colours, organisation name, support contact) comes from the settings table or Tailwind theme tokens, never hard-coded, because the owner will supply it later.
- Every screen must work at 360 px wide as well as on tablet and desktop.
- Before adding a component, check whether an existing one can be reused or extended.
- When a feature is done, check it against the matching items in the PRD §16 acceptance checklist.
