# Franchise Online Agreement Portal — Product Requirements Document (PRD)

| Item | Detail |
|---|---|
| Document version | 1.2 (agreement can be uploaded as a PDF, D15) |
| Date | 4 November 2026 |
| Product owner | Lincy |
| Source | "Franchise Online Agreement Portal – Business Requirements.pdf" plus the product owner's answers to the follow-up discovery questions |
| Status | Ready for build, subject to the open questions in Section 18 |

> **How to read this document.** Sections 1–4 explain *what* we are building and *why*. Sections 5–9 describe the exact workflow, statuses, screens and forms. Sections 10–14 cover the business rules, notifications, data, security and settings. Sections 15–18 cover the non-functional requirements, acceptance tests, what is out of scope and what still needs confirmation.
>
> **Where this PRD and the original PDF disagree, this PRD wins.** It includes the product owner's later decisions.

---

## 1. Purpose

The Franchise Online Agreement Portal replaces paper and email-based franchise onboarding with a single, secure web application. Franchise partners use it to:

1. Register their firm online with official documents, an authorised signatory and contact persons.
2. Read and accept a franchise agreement that is personalised with their own details.
3. Verify their email address and mobile number.
4. Go through a two-step internal approval: **Accounts** first, then **Manager**.
5. Correct and resubmit their application as many times as needed if it is rejected.

After final approval, the portal **automatically generates the official agreement PDF**. The **Manager** downloads it and emails it to the franchisee from inside the portal. Franchisees never download the PDF from the portal.

## 2. Goals and success measures

| Goal | How we will know |
|---|---|
| Fully online onboarding | Every application from registration to agreement email happens inside the portal, with no paper |
| Clear accountability | Every decision records who made it, when, and why (for rejections) |
| Nothing stuck in a queue | Automatic reminders after 2 business days, and Admin alerts after 5 |
| Protected documents | Franchisees and Accounts users can never reach an agreement PDF, even by guessing a link |
| No duplicate franchises | The same PAN or GST number can never be registered twice |
| Works on any device | Every screen is usable on desktop, tablet and mobile |

**Expected volume:** 10–30 applications per month at launch. The design must support growth without rework.

## 3. Key decisions from discovery

These decisions came from the product owner's answers and override or extend the original PDF.

| # | Topic | Decision |
|---|---|---|
| D1 | Fees and money | **No fees, payments or financial calculations** anywhere in the portal |
| D2 | Franchise Model | Stays a **free-text** field. There is no fixed list of models |
| D3 | Agreement text | Agreement text is **personalised automatically** with the applicant's details using merge fields (Section 10.4) |
| D4 | Resubmission after Manager rejection | Goes **straight back to the Manager**, not through Accounts again. **No limit** on resubmissions |
| D5 | Applicant | A separate **Applicant / Authorised Signatory** section is added. The applicant can be the owner, a partner, a director or an authorised representative. The applicant is the account owner whose email and mobile are verified |
| D6 | Duplicates | **PAN** is the primary duplicate check, and **GST** is also checked if provided. A matching PAN or GST is **blocked**. A matching email or mobile triggers a **warning and an Admin review**, not a block |
| D7 | Extra fields | Address, territory, bank details, incorporation documents and Aadhaar are **not needed** |
| D8 | PDF access | **Only the Manager can download** the agreement PDF. The Manager emails it to the franchisee from the portal and can resend it. Every email is logged |
| D9 | PDF footer | Wording is: *"This is a computer-generated digital agreement and does not require any physical or digital signature."* |
| D10 | Accounts assignment | Any Accounts user can pick up an unassigned application, after which it is assigned to that user. Admin can reassign it |
| D11 | Notifications | Email notifications go to the Franchisee, Accounts, Manager and Admin (Section 11) |
| D12 | Reminders | A reminder is sent after **2 business days** pending with Accounts or Manager, and then every 2 business days. **Admin is alerted after 5 business days.** Admin can change these intervals. Reminders never approve or reject anything |
| D13 | Branding | The organisation's logo, colours and custom domain will be used. These details will be supplied later, so the build must make them easy to plug in |
| D14 | Database | **MongoDB** replaces the Supabase stack recommended in the original PDF. The portal gets its own backend server (Node.js) for login, permissions, files, PDFs, emails and reminders (Section 15.1) |
| D15 | Agreement as PDF | Admin can **upload the franchise agreement as a PDF** instead of typing it. This is the default for new versions; typed agreements with merge fields remain available. A PDF agreement is shown to applicants exactly as uploaded and is **not personalised** (merge fields apply to typed agreements only). Applicants' details appear in the final agreement PDF's details pages instead (Section 9.2) |

## 4. Users and roles

There are four roles. **Only Admin can create Accounts and Manager users.** Public registration can only ever create a Franchise User. Admin accounts are created during setup and never through any public screen.

| Role | Purpose | Summary of what they do |
|---|---|---|
| **Admin** | Owns and oversees the portal | Manages agreement content and internal users, sees every application, resolves duplicate cases, reassigns Accounts reviews, monitors approvals and reminders, changes settings, views audit and email logs |
| **Accounts** | First-level reviewer | Picks up new applications, checks details and documents, then approves or rejects with a reason |
| **Manager** | Second-level and final approver | Reviews Accounts-approved applications, approves or rejects with a reason, downloads the generated PDF, emails it to the franchisee and resends it when needed |
| **Franchise User** | Applicant | Registers, verifies email and mobile, tracks status, reads rejection reasons, edits and resubmits. Cannot download the agreement PDF |

### 4.1 Permission matrix

✅ = allowed  ❌ = not allowed  👁 = view only

| Capability | Admin | Accounts | Manager | Franchise User |
|---|---|---|---|---|
| Register publicly | ❌ | ❌ | ❌ | ✅ |
| View own registration | — | — | — | ✅ |
| Edit own registration | — | — | — | ✅ only when Rejected |
| View all registrations | ✅ | ✅ only those at or after the Accounts stage that are relevant to them (see 13.2) | ✅ only Accounts-approved ones | ❌ |
| View uploaded documents | ✅ | ✅ | ✅ | ✅ own only |
| Pick up and assign an application to self | ❌ | ✅ | ❌ | ❌ |
| Reassign an Accounts review | ✅ | ❌ | ❌ | ❌ |
| Approve or reject at the Accounts stage | ❌ | ✅ assignee only | ❌ | ❌ |
| Approve or reject at the Manager stage | ❌ | ❌ | ✅ | ❌ |
| Resolve duplicate flags | ✅ | ❌ | ❌ | ❌ |
| View agreement PDF record and email history | 👁 (see open question Q1) | ❌ | ✅ | ❌ |
| **Download agreement PDF** | ❌ (see Q1) | ❌ | ✅ | ❌ |
| Email or resend the agreement to the franchisee | ❌ | ❌ | ✅ | ❌ |
| Manage agreement content and versions | ✅ | ❌ | ❌ | ❌ |
| Create, edit and deactivate Accounts and Manager users | ✅ | ❌ | ❌ | ❌ |
| Change settings (reminders, OTP, files, holidays, branding) | ✅ | ❌ | ❌ | ❌ |
| View audit log | ✅ | ❌ | ❌ | ❌ |

**All of these permissions must be enforced by the backend server on every request.** Hiding buttons in the screen is not enough.

---

## 5. End-to-end workflow

```
 ADMIN                 APPLICANT                         ACCOUNTS              MANAGER
 ─────                 ─────────                         ────────              ───────
 Publish agreement ──► Fill registration form
                       (Firm → Documents → Signatory
                        → Contacts → Agreement)
                       Tick "I agree" → Register
                              │
                       Duplicate check (PAN/GST = block;
                       email/mobile = flag for Admin)
                              │
                       Verify email OTP + mobile OTP
                              │
                       Set password → account created
                              │
                       Status: PENDING ACCOUNTS ──────► Pick up (assign)
                                                        Review
                                                        ├─ Reject (reason) ──► REJECTED BY ACCOUNTS
                                                        │                       Applicant edits & resubmits
                                                        │                       → back to PENDING ACCOUNTS
                                                        └─ Approve ────────────► PENDING MANAGER ──► Review
                                                                                  ├─ Reject (reason) ──► REJECTED BY MANAGER
                                                                                  │                       Applicant edits & resubmits
                                                                                  │                       → straight back to PENDING MANAGER
                                                                                  └─ Approve ──► APPROVED
                                                                                                 PDF auto-generated
                                                                                                 Manager downloads / emails
                                                                                                 PDF to franchisee (log kept)
```

### 5.1 Step by step

1. **Admin publishes an agreement version.** Registration is closed until one active version exists. The registration page then shows "Registration is currently unavailable".
2. **The applicant opens the public registration page** and fills in four sections: Franchise Details, Official Documents, Applicant / Authorised Signatory, and Contact Persons.
3. **The applicant reads the personalised agreement.** It is shown after the form, with their details filled in. They tick the mandatory checkbox, and the **Register** button only becomes active once it is ticked.
4. **Duplicate check on Register:**
   - If the PAN or GST is already registered, the registration is **blocked** with a clear message (Section 10.1).
   - If the email or mobile matches an existing registration, the applicant sees a **warning** and can continue. The application gets a **Duplicate flag** that Admin must resolve.
5. **Verification:** the portal sends an **email OTP** and an **SMS OTP** to the signatory's email and mobile. Both must succeed. OTPs expire after a configurable time (default 10 minutes), and the applicant can request a new one after a cooldown (default 60 seconds).
6. **Account creation:** the applicant sets a password, the Franchise User account is created, the registration is saved and linked to it, and the agreement acceptance is recorded. Status becomes **Pending Accounts**. Emails go to the applicant (submitted), all Accounts users (new application waiting) and Admin (new registration).
7. **Accounts review:** any Accounts user picks up an unassigned application, which then becomes assigned to them. They approve or reject.
   - **Approve:** status becomes **Pending Manager**. The history records "Accounts Approved" with the reviewer and time. Managers and Admin are emailed, and the applicant is emailed that Accounts approved.
   - **Reject:** a reason is mandatory. Status becomes **Rejected by Accounts**. The applicant is emailed the reason and resubmission instructions.
8. **Manager review:**
   - **Approve:** status becomes **Approved**. The agreement reference number is generated, the **PDF is generated automatically** and stored securely, and the applicant and Admin are emailed.
   - **Reject:** a reason is mandatory. Status becomes **Rejected by Manager** and the applicant is emailed.
9. **Resubmission:** the applicant edits and resubmits.
   - After an Accounts rejection, the application goes back to **Pending Accounts**, assigned to the same Accounts user if they are still active, otherwise unassigned.
   - After a Manager rejection, it goes **straight back to Pending Manager**.
   - Every earlier version and decision is kept. There is no limit on resubmissions.
10. **Agreement delivery:** the Manager opens the approved application, downloads the PDF if needed, and uses **Send Agreement to Franchisee** to email it as an attachment to the signatory's registered email. Every send or resend is logged with recipient, date, time, status and sender.
11. **Reminders** run in the background for anything waiting too long (Section 10.8).

---

## 6. Application statuses

### 6.1 Status list

| Status | Meaning | Who is waiting | What the applicant can do |
|---|---|---|---|
| **Pending Verification** | Register clicked, but the email and/or mobile OTP is not yet completed | Applicant | Complete OTPs |
| **Pending Accounts** | Submitted and verified, waiting for Accounts (unassigned or assigned) | Accounts | View only |
| **Rejected by Accounts** | Accounts rejected the application with a reason | Applicant | Edit and resubmit |
| **Pending Manager** | Accounts approved, waiting for the Manager | Manager | View only |
| **Rejected by Manager** | Manager rejected the application with a reason | Applicant | Edit and resubmit |
| **Approved** | Final approval done and PDF generated | — | View only |

**Notes:**
- **"Accounts Approved"** from the original PDF is recorded as a **history event**, not as a separate waiting status, because the application moves to the Manager immediately. On the applicant's screen, *Pending Manager* is labelled **"Accounts Approved – Awaiting Manager Approval"**.
- **"Draft"** from the original PDF: an applicant cannot have a server-side account before verification, so in-progress form data is **auto-saved in the applicant's browser** until they click Register. See open question Q3.
- **Duplicate flag** is a separate marker, not a status. See Section 10.1.
- **Assignment** (Unassigned, or assigned to an Accounts user) is a separate field, not a status.

### 6.2 Allowed status changes

Only these transitions are allowed. Every other change is rejected by the server.

| From | To | Triggered by |
|---|---|---|
| (new) | Pending Verification | Applicant clicks Register |
| Pending Verification | Pending Accounts | Both OTPs verified and password set |
| Pending Accounts | Pending Manager | Assigned Accounts user approves |
| Pending Accounts | Rejected by Accounts | Assigned Accounts user rejects with a reason |
| Rejected by Accounts | Pending Accounts | Applicant resubmits |
| Pending Manager | Approved | Manager approves (this also triggers PDF generation) |
| Pending Manager | Rejected by Manager | Manager rejects with a reason |
| Rejected by Manager | Pending Manager | Applicant resubmits |

Records left in **Pending Verification** for more than 7 days are deleted automatically, along with their uploaded files. This retention period is configurable. These records never became accounts, so no real customer data is lost.

---

## 7. Screens

All screens use the organisation's logo and colours from Settings, and every screen must work on desktop, tablet and mobile.

### 7.1 Public screens

#### P1. Landing / Login page
- Organisation logo, portal name and a short description.
- **Login form** for all four roles, using one shared login screen:
  - *Email or Mobile Number*: Franchise Users can use either. Internal users use their email or username.
  - *Password*
  - **Login** button, **Forgot Password?** link, and a **Register as a Franchise Partner** link.
- After login, the role is read from the database and the user lands on their own dashboard. There is no role selector.
- After 5 failed attempts in 15 minutes, the account is temporarily locked and a message is shown.

#### P2. Franchise Registration page
One long page with a progress indicator and five clearly separated sections (Section 8 has the full field list):
1. Franchise Details
2. Official Documents
3. Applicant / Authorised Signatory
4. Contact Persons (repeatable)
5. Franchise Agreement (read, then tick "I agree")

Behaviour:
- Errors are shown next to each field as the applicant leaves it, and again on Register.
- Progress is saved in the browser so that a page refresh doesn't lose typed text. Files must be re-selected after a refresh, and the page says so.
- The agreement section fills in merge fields live from what has been typed.
- The **Register** button stays disabled until the agreement checkbox is ticked.
- On Register, the duplicate check runs first (Section 10.1), then the applicant goes to P3.

#### P3. Verification page
- Shows the masked email (`li***@gmail.com`) and masked mobile (`******4321`).
- **Email OTP** box with Verify and Resend buttons.
- **Mobile OTP** box with Verify and Resend buttons.
- Countdown timers for expiry and for the resend cooldown.
- Each box shows a ✅ once verified. When both are verified, the page continues to P4.
- After 5 wrong attempts on one OTP, that OTP is invalidated and the applicant must request a new one.

#### P4. Set Password page
- *Password* and *Confirm Password* fields with strength rules shown: at least 8 characters, with an uppercase letter, a lowercase letter, a number and a special character.
- **Create Account** creates the account, finalises the submission and goes to P5.

#### P5. Registration Success page
- Shows "Your application has been submitted", the **Application ID** and the current status (Pending Accounts).
- Provides a **Go to My Dashboard** button.

#### P6. Forgot / Reset Password
- The user enters their email or mobile, receives an OTP or reset link, and sets a new password.
- The same screen is used by all roles.
- The message is always "If an account exists, we've sent instructions", so the screen never reveals whether an account exists.

### 7.2 Franchise User screens

Menu: **Dashboard · My Application · My Profile · Logout**

#### F1. Dashboard
- **Status card** with a large status badge and a plain-English explanation. For example: *"Your application is with our Accounts team for review."*
- **Progress tracker** with four steps: Submitted → Accounts Review → Manager Review → Approved. The current step is highlighted, and a rejected step is shown in red.
- **Rejection banner**, shown only if rejected. It includes the latest reason, who rejected it (Accounts or Manager), the date, and an **Edit & Resubmit** button.
- **Approved banner**, shown only if approved: *"Your franchise agreement has been approved. Our Manager will email the agreement to [email]."* The franchisee never sees a download button.
- **Agreement acceptance info**: version accepted, and the date and time.

#### F2. My Application (view)
- Read-only view of every section as submitted: firm, documents (thumbnails or file names that open in a viewer), signatory and all contacts.
- **History timeline** showing submission, each resubmission, every Accounts and Manager decision with its date, and the rejection reasons. Internal reviewer names are shown as "Accounts Team" or "Manager", not personal names.
- Earlier submissions can be viewed through a **Version** selector (v1, v2, …).

#### F3. Edit & Resubmit
- Only available when the status is **Rejected by Accounts** or **Rejected by Manager**.
- The same form as P2, pre-filled with the last submission, with the rejection reason pinned at the top.
- Any field and document can be changed. Contacts can be added or removed.
- **The signatory's email and mobile cannot be changed here**, because they are the login identity. Changing them is done in My Profile with OTP re-verification.
- The agreement section shows the **same agreement version originally accepted**, re-personalised with the edited details. The applicant must tick the checkbox again (see Section 10.4).
- The PAN and GST duplicate check runs again, excluding this applicant's own registration.
- **Resubmit** sends the application to Pending Accounts or Pending Manager (Section 5.1, step 9). A confirmation screen and email follow.

#### F4. My Profile
- Shows the signatory's name, email and mobile.
- **Change Password**.
- **Change email or mobile**, which requires an OTP to the new value plus the current password. This is allowed only when the application is not under review.

### 7.3 Accounts screens

Menu: **Dashboard · Pending Applications · My Reviewed Applications · Logout**

#### A1. Dashboard
- **Summary cards:** Unassigned (waiting to be picked up), Assigned to Me, Approved by Me (this month), Rejected by Me (this month), Overdue (over 2 business days).
- A short list of the oldest waiting applications.

#### A2. Pending Applications (list)
- **Two tabs:** *Unassigned* and *Assigned to Me*. A third tab, *All Pending*, shows applications assigned to other Accounts users as read-only.
- **Columns:** Application ID, Firm Name, Firm Type, PAN, Signatory Name, Submitted / Resubmitted On, Business Days Waiting, Assigned To, Duplicate Flag ⚠, Resubmission count.
- **Search:** Application ID, Firm Name, PAN, GST, signatory name, email or mobile.
- **Filters:** Firm Type, date range, Overdue only, Flagged only, Resubmitted only.
- **Sort:** oldest first by default.
- **Pick Up** button on unassigned rows assigns the application to the current user. The server prevents two users picking up the same one; the second user sees "Already picked up by [name]".

#### A3. Application Review (detail)
- **Header:** Application ID, status, assigned reviewer, submitted date, business days waiting, and a duplicate flag banner if flagged.
- **Sections:** Franchise Details, Official Documents (in-page viewer for images and PDFs), Applicant / Authorised Signatory, Contact Persons, Agreement Acceptance (version, date, time).
- **"Changes since last review"** highlighting appears on resubmissions, showing changed fields and replaced documents.
- **History timeline** with full reviewer names.
- **Actions,** shown only to the assigned user:
  - **Approve:** a confirmation dialog appears, then the status changes.
  - **Reject:** a dialog with a mandatory **Reason** box (at least 10 characters) appears, then the status changes.
- If the application is flagged as a possible duplicate, **Approve is disabled** until Admin resolves the flag. Reject is still allowed. See open question Q4.

#### A4. My Reviewed Applications
- A list of applications this user has approved or rejected, with the decision, date and current status. These are read-only.

### 7.4 Manager screens

Menu: **Dashboard · Pending Approvals · Approved · Rejected · Generated Agreements · Logout**

#### M1. Dashboard
- **Summary cards:** Pending Approval, Overdue (over 2 business days), Approved (this month), Rejected (this month), Agreements Not Yet Emailed.

#### M2. Pending Approvals (list)
- Only applications in **Pending Manager**.
- **Columns:** Application ID, Firm Name, Firm Type, Accounts Approved By, Accounts Approved On, Business Days Waiting, Resubmission count.
- Search, filters and sort work the same way as A2.

#### M3. Application Review (detail)
- Has the same sections as A3, **plus** the Accounts decision (reviewer, date and time) and "Changes since last review" on resubmissions.
- **Actions:** **Approve** (confirmation, then PDF generation with a progress indicator and a success message) and **Reject** (mandatory reason).
- Any Manager can act. There is no assignment at the Manager stage.

#### M4. Approved / Rejected lists
- Read-only lists with search and filters. Each row opens a read-only detail page.

#### M5. Generated Agreements
- **Columns:** Agreement Reference No., Firm Name, Approved On, PDF Generated On, Last Emailed On, Email Status, Times Sent.
- **Row actions:**
  - **View** opens the PDF in the browser.
  - **Download** downloads the PDF. This is the only download point in the whole portal.
  - **Send to Franchisee / Resend** opens a dialog with the prefilled recipient (signatory's registered email, read-only), a subject, an editable message body from a template, and the PDF attached. Pressing **Send** emails it, and a success or failure message is shown.
  - **Email History** shows every send attempt: recipient, date and time, status (Sent / Failed), sent by, and the error message on failure.
- If PDF generation failed, the row shows **Generation Failed** with a **Retry Generation** button.

### 7.5 Admin screens

Menu: **Dashboard · Franchise Registrations · Duplicate Review · Approval Tracking · Approved Applications · Rejected Applications · Generated Agreements · Agreement Content · Accounts Users · Manager Users · Audit Log · Settings · Logout**

#### AD1. Dashboard
- **Summary cards:** Total Registrations, Pending Verification, Pending Accounts, Pending Manager, Approved, Rejected (Accounts and Manager), Duplicate Cases Open, Overdue (over 5 business days), Total Accounts Users, Total Manager Users, Generated Agreement PDFs, Agreements Not Yet Emailed.
- **Charts:** registrations per month, and average days spent at each stage.
- **Alerts panel** listing applications pending for more than 5 business days.

#### AD2. Franchise Registrations
- Every registration in every status, with search (ID, firm, PAN, GST, name, email, mobile) and filters (status, firm type, date range, assigned reviewer, flagged, overdue).
- **Export to Excel/CSV** of the list view.
- The detail page is read-only for Admin and contains all sections, documents, full history and acceptance details.
- **Reassign Accounts reviewer** action, available on Pending Accounts applications: choose an active Accounts user, enter an optional note, and the change is logged. The new assignee is emailed.

#### AD3. Duplicate Review
- A list of applications with an **open duplicate flag**, showing which field matched (email or mobile) and the matching registration(s).
- A **side-by-side comparison** of the two registrations.
- **Actions:**
  - **Mark as Not a Duplicate:** a note is required, the flag is cleared, and Accounts can approve.
  - **Confirm Duplicate:** a note is required, and Admin asks the assigned Accounts user to reject the application with that note as the reason. Admin does not approve or reject directly.
- Every decision is logged.

#### AD4. Approval Tracking
- A pipeline view with columns Pending Accounts, Pending Manager, Approved and Rejected, with counts and days waiting.
- An **Overdue** list showing the reminders sent and their dates.

#### AD5. Approved / Rejected Applications
- Read-only lists with search, filters and export.
- The rejected list shows the stage (Accounts or Manager), the reason, the reviewer and whether the application has been resubmitted.

#### AD6. Generated Agreements
- The same list as M5, with **View** and **Email History** only. Admin's access to the PDF itself depends on open question Q1. Admin cannot send or resend.

#### AD7. Agreement Content Management
- **List of versions** showing Version No., Title, Status (Draft / Active / Inactive), Created By, Created On, Published On, and the number of acceptances.
- **Upload PDF agreement** (default, D15): Admin enters a title and uploads a PDF (PDF only, up to 10 MB, not password-protected; the file content is checked). A draft's PDF can be replaced; a published one cannot. Preview shows the PDF exactly as applicants will see it.
- **Type an agreement** (alternative): uses a rich-text editor with headings, bold, lists and numbered clauses, plus an **Insert Merge Field** menu (Section 10.4).
  - Only **Draft** versions can be edited.
  - A version that has been published is **locked forever**. To change it, Admin uses **Duplicate as New Draft**.
- **Preview** shows the agreement rendered with sample data, both as the applicant will see it and as it will look in the PDF.
- **Publish / Activate** makes the version the single active one and automatically deactivates the previous one. A confirmation is shown first.
- **Deactivate** is allowed, but if no version is active, the registration page is closed and a warning is shown.

#### AD8. Accounts Users / AD9. Manager Users
- A list showing Name, Email, Username, Mobile, Status (Active / Inactive), Created On and Last Login.
- **Create user:** Name, Email, Username, Mobile (optional) and Role (fixed by which screen it is created on). The user receives an email to set their password.
- **Edit**, **Deactivate / Reactivate** and **Send password reset** actions are available. Users are never permanently deleted, so history stays intact.
- Deactivating an Accounts user who has assigned applications asks Admin to reassign them first.

#### AD10. Audit Log
- A searchable and filterable log of every important action: logins, failed logins, registrations, decisions, reassignments, duplicate resolutions, agreement version changes, user management, settings changes, PDF generation, PDF views and downloads, and agreement emails.
- **Columns:** Date and time, User, Role, Action, Application / Record, Details, IP address.
- The log is read-only. Nobody can edit or delete entries.

#### AD11. Settings
See Section 14 for the full list.

---

## 8. Forms and fields

**Shared rules:**
- Required fields are marked with *.
- Text fields are trimmed of leading and trailing spaces.
- Error messages say exactly what to fix, for example *"PAN must be 10 characters like ABCDE1234F"*.

### 8.1 Section 1: Franchise Details

| Field | Type | Required | Rules |
|---|---|---|---|
| Franchise Model | Text | Yes | 2–100 characters; free text (D2) |
| Firm Type | Dropdown | Yes | Sole Proprietorship · Partnership Firm · Limited Liability Partnership · One Person Company · Private Limited Company |
| Firm Name | Text | Yes | 2–150 characters |

### 8.2 Section 2: Official Documents

| Field | Type | Required | Rules |
|---|---|---|---|
| Official PAN Number | Text | Yes | Automatically converted to UPPERCASE. Format `AAAAA9999A` (5 letters, 4 digits, 1 letter). Must not already be registered (Section 10.1) |
| Official PAN Image | File | Yes | JPG, PNG or PDF; max 5 MB |
| GST Number | Text | No | UPPERCASE; 15 characters in GSTIN format (2-digit state code + 10-character PAN + 1 entity character + "Z" + 1 check character). **Characters 3–12 must match the Official PAN** (Section 10.2). Must not already be registered |
| GST Certificate | File | Conditional | **Required if a GST Number is entered**; otherwise hidden or optional. JPG, PNG or PDF; max 5 MB |
| Rental Agreement | File | No | JPG, PNG or PDF; max 10 MB |

### 8.3 Section 3: Applicant / Authorised Signatory (new)

This person owns the portal login and receives all applicant emails.

| Field | Type | Required | Rules |
|---|---|---|---|
| Full Name | Text | Yes | 2–100 characters; letters, spaces, dots and apostrophes |
| Capacity / Designation | Dropdown | Yes | Owner / Proprietor · Partner · Director · Authorised Representative |
| Email ID | Email | Yes | Valid email format. **Verified by OTP.** This is the login email |
| Mobile Number | Number | Yes | 10-digit Indian mobile starting with 6–9; shown with a fixed +91 prefix. **Verified by OTP.** This is the login mobile |
| ID Proof | File | Yes | JPG, PNG or PDF; max 5 MB |
| Photograph | Image | Yes | JPG or PNG; max 2 MB |

### 8.4 Section 4: Contact Persons (repeatable)

The first contact section is shown by default.
- An **Add New Contact** button adds an identical section, with no upper limit.
- Every added section has a **Remove** button. The first section cannot be removed.
- A **"Same as Applicant / Authorised Signatory"** checkbox on Contact 1 copies the signatory's details and files into it, so they don't have to be typed twice.

| Field | Type | Required | Rules |
|---|---|---|---|
| Name | Text | Yes | 2–100 characters |
| Mobile Number | Number | Yes | 10-digit Indian mobile |
| Email ID | Email | Yes | Valid format |
| ID Proof | File | Yes | JPG, PNG or PDF; max 5 MB |
| Photograph | Image | Yes | JPG or PNG; max 2 MB |

Contact persons are **not** OTP-verified. Only the signatory is verified (D5). Each contact's details and files are stored separately and linked to the registration.

### 8.5 Section 5: Franchise Agreement

- The active agreement version is shown in a scrollable panel. A **PDF agreement** is shown page by page exactly as uploaded, with *Open in new tab* and *Download* links; this works on phones too. A **typed agreement** is **personalised with the details entered above**. Any merge fields that are still blank appear as highlighted "[Firm Name]" placeholders.
- A version label is shown, for example "Agreement Version 3".
- **Mandatory checkbox:** ☐ *"I have read and agree to all the terms and conditions mentioned in this franchise agreement."*
- The **Register** button is disabled until the checkbox is ticked and the form is valid.

### 8.6 File upload rules

These apply everywhere.
- Allowed types are checked by file content, not just the extension: JPG, PNG and PDF for documents, and JPG and PNG for photographs.
- The default size limits are as listed above, and Admin can change them in Settings.
- A preview or thumbnail is shown after upload, with a **Replace** option.
- Files are stored privately and are never reachable by a public link. They are viewed only through short-lived, permission-checked links.

---

## 9. Agreement PDF

### 9.1 When it is created
The PDF is generated **automatically when the Manager approves**. Nobody presses a "Generate" button. If generation fails, the approval still stands, the record shows *Generation Failed*, Admin and the Manager are alerted, and the Manager can use **Retry Generation**.

### 9.2 Contents, in order
1. Organisation logo and **Agreement title**.
2. **Agreement Reference Number** (Section 10.5) and agreement version number.
3. **Franchise details:** Firm Name, Franchise Model, Firm Type.
4. **Official details:** PAN Number, and GST Number if provided.
5. **Applicant / Authorised Signatory:** Name, Capacity, Email, Mobile.
6. **Contact persons:** Name, Mobile and Email for each contact, as a table.
7. **Agreement content:** the exact agreement version the applicant accepted. For a typed agreement, merge fields are filled from the approved data. For a PDF agreement, the uploaded PDF's pages are added unchanged after the details pages (items 1–6), and the mandatory footer is stamped on every page, including the uploaded ones.
8. **Acceptance record:** "Accepted online by [Signatory Name] on [date, time]".
9. **Manager approval date** and **agreement generation date**.

### 9.3 Format
- A4 size, printable, professional layout using brand colours. The page number appears as "Page X of Y".
- **A mandatory footer on every page**, centred and readable:
  > *This is a computer-generated digital agreement and does not require any physical or digital signature.*
- There are no signature fields of any kind.

### 9.4 Access and delivery
- The PDF is stored privately.
- **Only the Manager can download it.** Admin's access is pending open question Q1. Accounts users and Franchise Users have no access at all, and the server refuses any attempt even with a direct link.
- The Manager emails it to the franchisee as an attachment from screen M5. Every send is logged, and the Manager can resend at any time.
- Every view, download and email is written to the audit log.
- The PDF is **kept permanently** for administrative records. If it is regenerated after a failure, the earlier file is kept too.

---

## 10. Business rules and logic

> **Note:** There are **no fee, payment or financial calculations** in this product (D1). The "logic" in this portal is validation, duplicate detection, workflow rules, personalisation, numbering and business-day timing.

### 10.1 Duplicate registration check

This runs when the applicant clicks Register and again on Resubmit.

| Match found on… | Compared against | Result |
|---|---|---|
| **PAN** | All registrations except abandoned *Pending Verification* records and the applicant's own registration | **Blocked.** *"A franchise registration with this PAN already exists. If you believe this is an error, please contact [support email]."* |
| **GST** (if entered) | Same as above | **Blocked** with the same style of message for GST |
| **Signatory email or mobile** that already belongs to an existing **user account** | User accounts | **Blocked**, because one email or mobile can have only one login. *"An account already exists with this email/mobile. Please log in instead."* |
| **Email or mobile** of the signatory or any contact matching the **signatory or contacts of another registration** | All other registrations | **Warning shown, and the applicant can continue.** *"This email/mobile is already linked to another registration. Your application will be reviewed by our team."* The application gets a **Duplicate flag** listing the matched field and the matched registration(s) |

**Rules for duplicate flags:**
- Admin is emailed when a flag is raised, and the flag appears in **Duplicate Review** (AD3).
- Accounts **cannot approve** a flagged application until Admin marks it "Not a Duplicate". Accounts can still reject.
- Admin's resolution, note, date and time are recorded in the history and the audit log.
- To guarantee the PAN and GST rules even when two people submit at the same moment, the database itself must enforce **one registration per PAN** and **one per GST**.

### 10.2 Field validation logic
- **PAN:** must match `^[A-Z]{5}[0-9]{4}[A-Z]$`.
- **GST:** must match `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$`. **Characters 3–12 must equal the Official PAN.** If they don't, the error is *"GST number does not belong to the PAN entered"*.
- **Mobile:** must match `^[6-9][0-9]{9}$`.
- **Email:** must be a standard email format. Email addresses are compared case-insensitively.
- **The same validation runs in the browser and again on the server.**

### 10.3 Verification logic
- An email OTP and an SMS OTP are sent, each 6 digits.
- They expire after the configured time (default **10 minutes**). Resend is allowed after a **60-second** cooldown, up to **5 resends per hour**.
- **5 wrong attempts** invalidate the OTP.
- The account is created only after **both** OTPs are verified and a password is set.

### 10.4 Agreement personalisation and version rules

**Merge fields** that Admin can insert into agreement text:

| Merge field | Filled with |
|---|---|
| `{{firm_name}}` | Firm Name |
| `{{firm_type}}` | Firm Type |
| `{{franchise_model}}` | Franchise Model |
| `{{pan_number}}` | Official PAN Number |
| `{{gst_number}}` | GST Number, or "Not Applicable" |
| `{{signatory_name}}` | Applicant / Authorised Signatory name |
| `{{signatory_capacity}}` | Owner / Partner / Director / Authorised Representative |
| `{{signatory_email}}` / `{{signatory_mobile}}` | Signatory contact details |
| `{{acceptance_date}}` | Date the applicant accepted |
| `{{agreement_reference_no}}` | Reference number. Shows "To be issued on approval" until approved |
| `{{approval_date}}` | Manager approval date. Shows "To be issued on approval" until approved |
| `{{organisation_name}}` | Organisation name from Settings |

**Version rules:**
- Exactly **one active version** is allowed at a time. Published versions can never be edited.
- **Each acceptance records:** the version ID, the date and time, the user, the registration, and a **snapshot of exactly what the applicant saw**: the personalised text for a typed agreement, or the stored PDF file and its digital fingerprint (SHA-256) for a PDF agreement. Acceptance records and agreement files are never changed or deleted.
- If Admin publishes a new version while an applicant is filling in the form, the submit is refused with a message asking them to read and accept the latest version.
- **A registration stays on the version it first accepted**, even after Admin publishes a newer one (from the original PDF, Section 5.3).
- **On resubmission,** the applicant sees the **same version** re-personalised with their edited details and must tick the checkbox again. A new acceptance record is stored, and the older ones are kept.
- **The PDF uses** the registration's accepted version, filled with the final approved data.

### 10.5 Agreement reference number
- **Format:** `FRN/YYYY/NNNN`, for example `FRN/2026/0001`. The sequence restarts each calendar year.
- **Assigned at the moment of Manager approval.** It is unique, never reused, and never changes.
- The prefix can be set in Settings. See open question Q2.

### 10.6 Accounts assignment
- A new or resubmitted application with no active assignee goes into the **Unassigned** queue.
- **Pick Up** assigns it to the current Accounts user. If two users click at the same moment, only one succeeds.
- **Only the assignee** can approve or reject it.
- **Admin can reassign** it to any active Accounts user. Every assignment and reassignment is logged with who did it, when, the old and new assignee, and the note.
- When an application rejected by Accounts is resubmitted, it is automatically **re-assigned to the same Accounts user** if they are still active, so they can verify their own requested corrections. Otherwise it goes back to Unassigned.
- There is **no assignment at the Manager stage**. Any Manager can act.

### 10.7 Approval and rejection rules
- A rejection **reason is mandatory**, at least 10 characters and at most 2000.
- Every decision records the reviewer ID, role, decision, reason, date and time (Indian Standard Time is shown, and UTC is stored), and the submission version reviewed.
- The server checks that the user has the right role, that the application is in the right status, and, for Accounts, that the user is the assignee and that there is no open duplicate flag. Only then does it change the status.
- **Submission versions:** each resubmission creates a new version (v1, v2, …) containing all the data and document references at that time. Earlier versions are never overwritten.

### 10.8 Reminders and business-day timing
- **Business days** are Monday to Friday, excluding public holidays that Admin enters in Settings.
- **The pending clock starts** when an application enters *Pending Accounts* or *Pending Manager*, including on resubmission.

| Stage | First reminder | Repeat | Sent to |
|---|---|---|---|
| Pending Accounts | After **2** business days | Every **2** business days until decided | The assigned Accounts user, or **all** Accounts users if unassigned |
| Pending Manager | After **2** business days | Every **2** business days until decided | All Manager users |
| Either stage | After **5** business days | Every 2 business days, using the same repeat interval | **Admin** (escalation alert) |

- All three numbers are **configurable in Settings**.
- The reminder check runs automatically **once every business day at 9:00 AM IST**. The time is configurable.
- **Reminders never change a status, approve or reject.**
- Every reminder sent is logged and visible in Approval Tracking (AD4).

### 10.9 Applicant edit permissions by status

| Status | Applicant permission |
|---|---|
| Pending Verification | Complete verification only |
| Pending Accounts | View only |
| Rejected by Accounts | **Edit and resubmit** |
| Pending Manager | View only |
| Rejected by Manager | **Edit and resubmit** |
| Approved | View only |

---

## 11. Notifications

All notifications are sent **by email** (D11). SMS is used **only for the mobile OTP**. Every email shows the organisation's branding and a link to the portal, and every email sent is stored in the notification log.

| # | Event | Franchisee | Accounts | Manager | Admin |
|---|---|---|---|---|---|
| N1 | Email OTP for verification | ✅ OTP email | | | |
| N2 | Registration submitted (account created) | ✅ "Application submitted", with the Application ID | ✅ All Accounts users: "New application waiting for verification" | | ✅ "New registration" |
| N3 | Duplicate flag raised | | | | ✅ "Possible duplicate needs review" |
| N4 | Application picked up or reassigned | | ✅ New assignee (on reassignment) | | |
| N5 | Accounts approved | ✅ "Accounts approved – now with Manager" | | ✅ All Managers: "Application waiting for final approval" | ✅ |
| N6 | Accounts rejected | ✅ "Correction requested", with the **reason** and resubmission steps | | | ✅ |
| N7 | Resubmitted after an Accounts rejection | ✅ Confirmation | ✅ Assignee, or all if unassigned | | ✅ |
| N8 | Manager approved (final) | ✅ "Application approved – agreement generated; our Manager will email it to you" | | | ✅ "Final approval + PDF generated" |
| N9 | Manager rejected | ✅ "Correction requested", with the **reason** and resubmission steps | | | ✅ |
| N10 | Resubmitted after a Manager rejection | ✅ Confirmation | | ✅ All Managers | ✅ |
| N11 | Agreement emailed by the Manager | ✅ The agreement email with the PDF attached | | | |
| N12 | PDF generation failed | | | ✅ | ✅ |
| N13 | Pending reminder (2 business days, then repeated) | | ✅ | ✅ | |
| N14 | Overdue escalation (5 business days) | | | | ✅ |
| N15 | Internal user created or password reset | | ✅ / ✅ "Set your password" link | | |

**Notes:**
- "Correction requested" in the owner's notification list is the **rejection email** (N6 / N9). There is no separate "request correction" action.
- Rejection emails always include the **reason** and **instructions for resubmitting**.
- Email templates (subject and body) can be edited by Admin in Settings and can use the same merge fields as the agreement.
- **A failed email is retried** automatically up to 3 times. After that it is marked *Failed* in the log.

---

## 12. Data the portal stores

This section describes business entities. The developer designs the actual MongoDB collections and indexes.

| Record | What it holds |
|---|---|
| **User** | Name, email, username (internal users), mobile, role, active/inactive, created by, last login |
| **Franchise Registration** | Application ID, Franchise Model, Firm Type, Firm Name, PAN, GST, status, current submission version, duplicate flag status, assigned Accounts user, linked Franchise User, created and updated dates |
| **Applicant / Authorised Signatory** | Name, capacity, email, mobile, ID proof reference, photo reference, linked to the registration |
| **Contact Person** | Name, mobile, email, ID proof reference, photo reference, order number, linked to the registration |
| **Document** | File reference, document type (PAN, GST, Rental, ID Proof, Photo), owner (registration, signatory or contact), size, type, uploaded on, submission version |
| **Submission Version** | Full snapshot of the registration, signatory, contacts and document references at each submit or resubmit |
| **Agreement Version** | Version number, title, format (PDF or typed text), content (with merge fields) or PDF file details (name, size, pages, fingerprint, storage key), status (Draft/Active/Inactive), created/published by and dates |
| **Agreement Acceptance** | Registration, user, agreement version, snapshot (personalised text or PDF file and fingerprint), accepted date and time, submission version |
| **Approval History** | Registration, stage (Accounts/Manager), decision, reason, reviewer, date and time, submission version |
| **Assignment History** | Registration, from user, to user, action (pick-up / reassign / auto-reassign), by whom, note, date and time |
| **Duplicate Flag** | Registration, matched field, matched registration(s), status (Open/Not Duplicate/Confirmed), resolved by, note, date and time |
| **Generated Agreement** | Registration, reference number, file reference, generated on, generation status, error message, version of the agreement used |
| **Agreement Email Log** | Generated agreement, recipient email, sent by, date and time, status (Sent/Failed), error message |
| **Notification Log** | Recipient, event, channel (email/SMS), subject, date and time, status |
| **Reminder Log** | Registration, stage, reminder type (reminder/escalation), recipients, date and time |
| **OTP Record** | Target (email/mobile), hashed code, expiry, attempts, used flag |
| **Settings** | All values in Section 14 |
| **Public Holidays** | Date and name |
| **Audit Log** | Who, role, action, target record, details, IP address, date and time |

**Data rules:**
- **Nothing is ever hard-deleted** except abandoned Pending Verification records (Section 6.2) and expired OTPs.
- Users and agreement versions are deactivated, not deleted.
- **Every change to data structure or indexes is made through a versioned migration script.** Existing data is never reset, and collections are never dropped.
- Status changes that touch several records (for example, approval + history entry + reference number) are saved together in a single **MongoDB transaction**, so a half-finished change can never be left behind.

---

## 13. Security

### 13.1 Authentication
- One login screen for all roles. The role always comes from the database.
- Passwords follow the strength rules in P4 and are stored only as a strong one-way hash (bcrypt or Argon2), never in plain text.
- Login sessions use secure, HTTP-only cookies. Login tokens are never stored where page scripts can read them.
- Accounts are locked after repeated failed logins. Forgot Password works for all roles.
- Sessions time out after 30 minutes of inactivity. This is configurable.
- Internal users are created only by Admin. The first Admin is created during setup.

### 13.2 Authorisation
Authorisation is enforced by the backend server on every request. A central permission check runs before any data is read or changed, and every database query is limited to the records that role is allowed to see. The frontend never connects to MongoDB directly.

| Role | Can access |
|---|---|
| **Franchise User** | Only their own registration, documents, history and profile. Never any agreement PDF |
| **Accounts** | Registrations in Pending Accounts, plus those they reviewed before (read-only), plus their documents. Never agreement PDFs or the PDF list |
| **Manager** | Registrations in Pending Manager, Approved and Rejected by Manager, plus Accounts-reviewed history and documents. Generated PDFs and agreement emails |
| **Admin** | Everything except PDF download, which is pending open question Q1 |

**Rules:**
- **Status changes happen only through server-side actions** that check role, status, assignment and duplicate flag. A user can never set a status directly.
- **Files are kept in private storage.** They are accessed through short-lived links (for example, valid for 5 minutes) that are issued only after a permission check.

### 13.3 Data protection
- PAN, GST and identity documents are treated as sensitive. PAN is masked in list views (`ABCDE****F`) and shown in full only on detail pages.
- All traffic uses HTTPS, and file contents are checked on upload.
- API keys for the email and SMS providers are kept server-side only.
- **The audit log** (AD10) records all important actions and cannot be edited.

---

## 14. Admin settings

| Setting | Default |
|---|---|
| Organisation name, logo, primary and secondary colours, support email and phone | To be provided (D13) |
| Agreement reference prefix | `FRN` |
| OTP expiry (minutes) / resend cooldown (seconds) / max attempts | 10 / 60 / 5 |
| Pending Verification retention (days) | 7 |
| First reminder after (business days) | 2 |
| Repeat reminder every (business days) | 2 |
| Admin escalation after (business days) | 5 |
| Daily reminder run time | 09:00 IST |
| Public holiday list | Empty, added by Admin |
| File size limits (documents / photographs / rental agreement) | 5 MB / 2 MB / 10 MB |
| Session timeout (minutes) | 30 |
| Email templates (subject and body for N1–N15) | Default templates provided |
| Agreement email template (N11) | Default template provided |

All settings changes are written to the audit log.

---

## 15. Non-functional requirements

| Area | Requirement |
|---|---|
| **Responsive** | Fully usable at mobile (from 360 px wide), tablet and desktop sizes. Forms stack in one column on mobile, and tables become cards or scroll inside their own container |
| **Performance** | Pages load within 3 seconds on a normal 4G connection. Lists are paginated at 20 rows by default. PDF generation finishes within 30 seconds |
| **Scale** | Built for 10–30 applications per month, with no design limits up to thousands per month |
| **Availability** | Hosted on managed cloud services with daily database backups |
| **Accessibility** | Readable contrast, labelled fields, keyboard navigation, and errors announced next to their fields |
| **Browsers** | Latest versions of Chrome, Edge, Safari and Firefox, including mobile Chrome and Safari |
| **Language and formats** | English. Dates are shown as DD-MM-YYYY and times in IST |
| **Branding** | Logo, colours and domain are configurable without code changes (D13) |
| **No mock data** | The final product uses real authentication, verification, email, SMS, storage and PDF generation |

### 15.1 Recommended technology (from the original requirements)

| Area | Recommendation |
|---|---|
| Frontend | React, TypeScript, Vite, Tailwind CSS |
| Backend server | Node.js + Express + TypeScript (REST API). Handles login, permissions, validation, workflow, files, PDFs, emails and reminders |
| Database | **MongoDB** (MongoDB Atlas, managed cloud), using Mongoose for data models. Unique indexes on PAN, GST and login email/mobile; transactions for workflow changes |
| Authentication | Built into the backend: hashed passwords, secure HTTP-only cookie sessions (JWT), role checks on every request, login lockout and password reset |
| File storage | A private cloud storage bucket, such as AWS S3. Files are never public. The backend checks permissions and then streams the file or issues a link valid for a few minutes. Only file references are kept in MongoDB |
| PDF generation | A server-side PDF library in the backend, run automatically after Manager approval |
| Scheduled reminders | A daily background job in the backend, using a MongoDB-backed job scheduler so it runs exactly once each day even if more than one server is running |
| Migrations | A MongoDB migration tool, such as migrate-mongo, for index and data-structure changes |
| Email | A transactional email service, such as Resend, SendGrid or Amazon SES, to be chosen |
| SMS OTP | An Indian SMS gateway with DLT-registered templates, such as MSG91 or Twilio, to be chosen |

---

## 16. Acceptance checklist

The build is complete only when every item passes.

**Registration and verification**
- [ ] Registration is closed when no agreement version is active, and opens once one is published.
- [ ] All field validations work, including PAN format, GST format, GST-to-PAN match and mobile format.
- [ ] GST Certificate becomes required when a GST Number is entered.
- [ ] Contacts can be added without limit and removed, but Contact 1 cannot be removed.
- [ ] "Same as Signatory" copies the signatory's details correctly.
- [ ] The agreement shows the applicant's details live, and Register stays disabled until the checkbox is ticked.
- [ ] A duplicate PAN or GST is blocked with the correct message.
- [ ] An existing account email or mobile is blocked with "please log in".
- [ ] An email or mobile matching another registration shows a warning, raises a flag and emails Admin.
- [ ] Email and SMS OTPs work, including expiry, resend cooldown and attempt limits. The account is not created until both are verified.
- [ ] The acceptance record stores the version, date, time and snapshot (personalised text, or the PDF file and fingerprint).
- [ ] Admin can upload, preview, replace (draft only), publish and deactivate a PDF agreement; non-PDF, oversized and password-protected files are refused.
- [ ] The active PDF agreement is readable on the registration page on a 360 px phone, and older accepted versions remain available after a new version is published.

**Workflow**
- [ ] A new application appears as Unassigned to Accounts, and Pick Up assigns it. Two users cannot pick up the same application.
- [ ] Only the assignee can approve or reject, and Approve is disabled while a duplicate flag is open.
- [ ] Admin can reassign, resolve duplicate flags, and everything is logged.
- [ ] Accounts Approve moves the application to Pending Manager. Accounts Reject requires a reason.
- [ ] Resubmission after an Accounts rejection returns to Pending Accounts, assigned to the same reviewer.
- [ ] Manager Approve sets the status to Approved, assigns the reference number and auto-generates the PDF. Manager Reject requires a reason.
- [ ] Resubmission after a Manager rejection returns **straight to Pending Manager**.
- [ ] Unlimited resubmissions are possible, and all versions and decisions remain viewable.
- [ ] A new agreement version doesn't change the version an existing registration accepted.

**PDF and delivery**
- [ ] The PDF contains every item in 9.2 and has the exact footer text on **every page**.
- [ ] The Manager can view, download, send and resend the PDF, and the email history logs recipient, date, time and status.
- [ ] Accounts and Franchise Users **cannot** reach the PDF, even with a direct link or a direct API call.
- [ ] Admin's access matches the decision on Q1.
- [ ] Generation failure shows Retry Generation and sends alerts.

**Notifications and reminders**
- [ ] Every notification in Section 11 is sent to the right people with the right content.
- [ ] Reminders fire after 2 business days and then every 2 business days, skipping weekends and holidays. The Admin alert fires after 5 business days.
- [ ] Changing the intervals in Settings takes effect.
- [ ] Reminders never change a status.

**Roles, security and quality**
- [ ] All four roles have been tested independently, and every menu item, button and form works.
- [ ] Public registration can never create an Admin, Accounts or Manager user.
- [ ] Changing a URL or ID never reveals another user's data.
- [ ] The audit log records all actions listed in AD10.
- [ ] Layout works on desktop, tablet and mobile.
- [ ] No mock data remains, and all database changes were made through migration scripts.
- [ ] Calling the backend API directly (without the screens) still respects every permission rule.

---

## 17. Out of scope (version 1)

- Fees, payments, invoices or any financial calculation.
- A fixed catalogue of franchise models.
- Address, territory, bank details, incorporation documents and Aadhaar fields.
- Digital, electronic or physical signatures.
- Franchisee download of the agreement from the portal.
- Agreement expiry, renewal tracking and revocation (Q5).
- SMS notifications other than the mobile OTP.
- A native mobile app (the responsive web app covers mobile).
- Multiple languages.

---

## 18. Assumptions and open questions

### 18.1 Assumptions made
These are defaults the team will follow unless the product owner says otherwise.

| # | Assumption |
|---|---|
| A1 | The **Applicant / Authorised Signatory** is the account owner. Their email and mobile are OTP-verified and used for login. Contact persons are not verified |
| A2 | One Franchise User account holds **one** registration |
| A3 | The applicant receives the "Accounts approved" email (the owner listed "application approved"). This matches the original PDF |
| A4 | The rejection email is the "correction requested" email. There is no separate correction action |
| A5 | A resubmission after an Accounts rejection is re-assigned to the same Accounts reviewer if they are active |
| A6 | Business days are Monday to Friday minus the holidays Admin enters |
| A7 | Reference number format `FRN/YYYY/NNNN` |
| A8 | Files: JPG, PNG or PDF; 5 MB for documents, 2 MB for photographs, 10 MB for rental agreements |
| A9 | The agreement email goes to the signatory's registered email only |
| A10 | The footer uses the owner's new wording (D9) instead of the original PDF's wording |
| A11 | The **Application ID** is issued when verification completes (Step 4), so abandoned attempts don't leave gaps in the numbering |
| A12 | Duplicate checks (PAN, GST, email, mobile) compare against registrations that **completed verification**. Unverified attempts never block or flag anyone. The Admin "possible duplicate" email (N3) is sent once the flagged application completes verification |
| A13 | Files are uploaded as soon as they are chosen and are kept privately for **24 hours** until the applicant clicks Register. Unused files are then discarded |
| A14 | There is no business limit on contact persons. A technical safety limit of **100** per application applies |
| A15 | The **Application ID** format is `APP-YYYY-NNNN` (for example `APP-2026-0001`), numbered per calendar year |
| A16 | Both verification codes are sent automatically when the verification page opens. "Resend" allows up to 6 codes per hour for each of email and mobile (the first plus 5 resends) |
| A17 | When a Franchise User changes their login email or mobile, the current application details are updated too. Earlier submission versions keep the details as they were, and a security notice is emailed to the old address |
| A18 | **Overdue** means waiting **more than** the "first reminder after" number of business days in Settings (default 2), counted from when the application entered its current stage. Weekends and Admin holidays don't count |
| A19 | **Edit & Resubmit:** unchanged documents are kept automatically; only replaced files are uploaded again. The duplicate check runs again on every resubmission, but only **new** email/mobile matches raise a warning and flag (matches already reviewed by Admin are not raised again) |
| A20 | Accounts users see the full Pending Accounts queue (others' applications read-only) plus everything they reviewed before. The Admin "Reassign" button on the registrations screen arrives with step 7; the reassign function already works and is used when deactivating an Accounts user |
| A21 | The Manager also cannot approve while a possible-duplicate flag is open (this can happen after a resubmission); Reject is still allowed. This matches the Accounts rule (Q4) |
| A22 | The PDF uses the standard built-in fonts. Ordinary English letters, numbers and punctuation print normally; the rupee sign prints as "Rs." and characters from other scripts print as "?". A Unicode font can be added later if names or text in other scripts are needed |
| A23 | For an uploaded (PDF) agreement, each uploaded page is placed unchanged on an A4 page, scaled down slightly if needed, so the mandatory footer never covers its content |
| A24 | Agreement emails sent from the portal are logged with recipient, subject, sender, time and status. In development, the test mailbox lists the attachment's name and size rather than storing the file |

### 18.2 Open questions for the product owner

| # | Question | Default if not answered |
|---|---|---|
| **Q1** | The original PDF said **Admin and Manager** can view and download the PDF. The new answer says **only the Manager** can download it. Should Admin be able to **view** the PDF (without downloading), **view and download**, or see **only the record and email history**? | Admin sees the record and email history only, with no view or download |
| **Q2** | Is the reference number format `FRN/2026/0001` acceptable, or do you have your own format? | `FRN/YYYY/NNNN` |
| **Q3** | The original "Draft" status: is browser-only auto-save enough, or should applicants be able to save a draft and come back on another device? That would mean verifying email first, before filling the form | Browser-only auto-save |
| **Q4** | While a duplicate flag is open, should Accounts be **blocked from approving** until Admin resolves it? | Yes, blocked |
| **Q5** | Does an agreement ever **expire, need renewal, or get revoked**? This was not answered and is left out of version 1 | Out of scope for v1 |
| **Q6** | When a person is an **Authorised Representative**, should they upload an **authorisation letter or board resolution**? | Not required |
| **Q7** | Should the Manager be able to add **CC recipients**, such as contact persons, when emailing the agreement? | No, the signatory only |
| **Q8** | Brand details: logo files, colour codes, domain, sender email address (for example `noreply@yourdomain.com`), support contact, and the choice of email and SMS provider | Placeholders until supplied |
