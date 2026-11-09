# Acceptance checklist (PRD §16): evidence

Every item in PRD §16 and what proves it. **Auto** = checked by `npm test` (11 suites, in-memory database). **Sweep** = checked in a real browser by `npm run sweep`. **Owner** = needs a person to confirm.

Status at build step 9: **all 37 items pass their automated checks.** Five items also list something for the owner to confirm before go-live.

## Registration and verification

| # | Item | Evidence |
|---|---|---|
| 1 | Registration closed with no active agreement; opens once published | Auto: `registration.e2e` (form reports closed, uploads refused), `admin.e2e` (opens after publishing, closes after deactivating) |
| 2 | Field validations: PAN, GST, GST-to-PAN, mobile | Auto: `registration.e2e` (per-field messages, PAN message, GST/PAN mismatch). Same shared rules run in the browser |
| 3 | GST certificate required when a GST number is entered | Auto: `registration.e2e` |
| 4 | Contacts: unlimited, removable, Contact 1 not removable | Sweep: Contact 1 has no Remove, contacts added and removed. Auto: at least one contact required |
| 5 | "Same as Signatory" copies details | Sweep: copies and stays in step. Auto: reusing the same files works |
| 6 | Agreement shows applicant's details live; Register disabled until ticked | Sweep: Register disabled until both boxes ticked. Live details apply to **typed** agreements; the default uploaded-PDF agreement is shown as-is (PRD D15). Auto: typed acceptance stores the personalised text |
| 7 | Duplicate PAN or GST blocked with the right message | Auto: `registration.e2e`, `verification.e2e` (database PAN rule) |
| 8 | Existing account email or mobile: "please log in" | Auto: `registration.e2e` |
| 9 | Email/mobile matching another registration: warning, flag, Admin email | Auto: `registration.e2e`, `verification.e2e` (N3 email) |
| 10 | Email and SMS OTP: expiry, cooldown, attempts; account only after both | Auto: `verification.e2e`, `otp.e2e`, `sms.e2e` (Networkz OTP with DLT wording) |
| 11 | Acceptance record: version, date, time, snapshot | Auto: `registration.e2e` (PDF fingerprint; typed text snapshot), permanent |
| 12 | Admin uploads, previews, replaces (draft only), publishes, deactivates; bad files refused | Auto: `admin.e2e` (non-PDF, >10 MB, password-protected refused; replace only while draft) |
| 13 | Agreement readable on a 360 px phone; older versions still available | Sweep: PDF shown and fits 360 px. Auto: `admin.e2e` (applicant still gets the v1 PDF after v2 is published) |

## Workflow

| # | Item | Evidence |
|---|---|---|
| 14 | New application Unassigned; Pick Up; no double pick-up | Auto: `workflow.e2e` (two at once: exactly one wins) |
| 15 | Only the assignee decides; Approve disabled with an open duplicate flag | Auto: `workflow.e2e`, `oversight.e2e` |
| 16 | Admin reassigns, resolves duplicates; all logged | Auto: `workflow.e2e`, `oversight.e2e` |
| 17 | Accounts Approve → Pending Manager; Reject needs a reason | Auto: `workflow.e2e` |
| 18 | Resubmission after Accounts rejection → same reviewer | Auto: `workflow.e2e` (and to Unassigned if that reviewer left) |
| 19 | Manager Approve: Approved, reference number, PDF; Reject needs a reason | Auto: `manager.e2e` |
| 20 | Resubmission after Manager rejection → straight to Pending Manager | Auto: `workflow.e2e`, `manager.e2e` |
| 21 | Unlimited resubmissions; all versions and decisions viewable | Auto: `workflow.e2e` (version 3), `verification.e2e` (versions view) |
| 22 | A new agreement version doesn't change an accepted one | Auto: `admin.e2e`, `workflow.e2e` (same version re-accepted) |

## PDF and delivery

| # | Item | Evidence |
|---|---|---|
| 23 | PDF has every 9.2 item and the exact footer on every page | Auto: `manager.e2e` (A4, footer and "Page X of Y" on every page, details, acceptance, no signature fields). **Owner:** read one real PDF |
| 24 | Manager views, downloads, sends, resends; email history | Auto: `manager.e2e` |
| 25 | Accounts and applicants cannot reach the PDF, even directly | Auto: `manager.e2e` (direct links and API refused) |
| 26 | Admin access matches Q1 | Auto: `oversight.e2e` (records and email history only, no PDF) |
| 27 | Generation failure: Retry and alerts | Auto: `manager.e2e` (N12, retry) |

## Notifications and reminders

| # | Item | Evidence |
|---|---|---|
| 28 | Every notification to the right people with the right content | Auto: N1–N15 across all suites; wording editable (Admin › Email Templates, `admin.e2e`). **Owner:** review the wording once in Email Templates |
| 29 | Reminders after 2 business days, every 2, skipping weekends and holidays; Admin after 5 | Auto: `reminders.e2e` |
| 30 | Changing intervals in Settings takes effect | Auto: `admin.e2e` |
| 31 | Reminders never change a status | Auto: `reminders.e2e` |

## Roles, security and quality

| # | Item | Evidence |
|---|---|---|
| 32 | All four roles tested; every menu item, button and form works | Sweep: every menu screen and detail page of Admin, Accounts, Manager and Franchise User, plus public pages. Auto: every workflow button in the suites. **Owner:** click through once (`portal-walkthrough.mp4` shows it) |
| 33 | Public registration never creates staff users | Auto: `admin.e2e` (role fields in the request are ignored), staff creation refused to non-Admins |
| 34 | Changing a URL or ID never shows another user's data | Auto: `verification.e2e`, `workflow.e2e`, `oversight.e2e` (other applicants' documents and applications refused) |
| 35 | Audit log records all AD10 actions | Auto: `admin.e2e` (logins, failed logins, registrations, agreement changes, users, settings, templates), `workflow.e2e`, `manager.e2e` (PDF generated, viewed, downloaded, emailed), `oversight.e2e` (duplicates, exports); permanent |
| 36 | Desktop, tablet and mobile layouts | Sweep: 37 screens × 360 / 768 / 1366 px, no sideways scrolling |
| 37 | No mock data; database changes only by migrations; API respects every permission | Production refuses test mailboxes, local storage and a local database (`golive.e2e`); 12 migrations, no `autoIndex`; every suite calls the API directly as each role. **Owner:** never run `seed:dev` on the live database |
