# Go-live guide

How to run the Franchise Online Agreement Portal for real users. Development keeps working as before (`npm run dev`); none of this is needed locally.

## 1. What you need

| Service | Purpose | Examples | Settings in `server/.env` |
|---|---|---|---|
| **MongoDB Atlas** | The live database (a replica set, required for transactions) | Atlas M10 or larger in the Mumbai region (`ap-south-1`), with continuous backup | `MONGODB_URI` |
| **Private file bucket** | Uploaded documents, agreement PDFs | AWS S3 (Mumbai), Cloudflare R2, DigitalOcean Spaces | `STORAGE_PROVIDER=s3`, `S3_*` |
| **Email provider (SMTP)** | Every notification email | Amazon SES, SendGrid, Brevo, Mailgun, Zoho, Microsoft 365 | `EMAIL_PROVIDER=smtp`, `SMTP_*`, `EMAIL_FROM` |
| **SMS gateway** | OTP and applicant SMS | Networkz Systems (already connected) | `SMS_PROVIDER=networkz`, `NETWORKZ_SMS_*` |
| **A host for the server** | Runs the API and serves the website | Any Node.js 20+ host: a VM, Render, Railway, Fly.io, AWS / Azure app services | `NODE_ENV=production`, `CLIENT_ORIGIN`, `CLIENT_DIST_DIR` |
| **A domain with HTTPS** | The address applicants use | `portal.yourcompany.in` | `CLIENT_ORIGIN=https://…` |

All secrets go in the host's environment variables (or `server/.env` on the host), **never** in Git.

## 2. Set up each service

### MongoDB Atlas
1. Create a project and a cluster (M10+ recommended for production backups). Region: Mumbai.
2. Database Access: create a user with *readWrite* on the `franchise_portal` database only.
3. Network Access: allow only the server's outgoing IP address(es).
4. Copy the connection string into `MONGODB_URI` (it starts `mongodb+srv://`), with the database name: `…mongodb.net/franchise_portal?retryWrites=true&w=majority`.
5. The server applies all migrations (indexes) automatically on its first start. Never use `autoIndex`, `dropDatabase` or `deleteMany({})` against it.

### Private file bucket
1. Create a bucket, for example `franchise-portal-files`. **Block all public access.** No bucket policy granting public read.
2. Create an access key limited to that bucket with only `s3:PutObject`, `s3:GetObject` and `s3:DeleteObject` (Delete is used only by the DPDP erasure and the daily clean-up of unverified registrations).
3. Turn on versioning (recommended) as a second safety net.
4. Settings:
   ```
   STORAGE_PROVIDER=s3
   S3_BUCKET=franchise-portal-files
   S3_REGION=ap-south-1
   S3_ACCESS_KEY_ID=…
   S3_SECRET_ACCESS_KEY=…
   # Only for non-AWS providers (R2, Spaces, MinIO):
   S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
   S3_FORCE_PATH_STYLE=false
   ```
   Files are never public: the portal checks permissions and then streams each file itself. The bucket refuses to overwrite an existing file.

### Email (SMTP)
1. In your provider, verify the sending domain (SPF, DKIM and DMARC DNS records) so emails don't land in spam.
2. Create SMTP credentials.
3. Settings:
   ```
   EMAIL_PROVIDER=smtp
   SMTP_HOST=email-smtp.ap-south-1.amazonaws.com
   SMTP_PORT=587            # 465 for implicit TLS
   SMTP_USER=…
   SMTP_PASSWORD=…
   EMAIL_FROM=Franchise Portal <no-reply@yourcompany.in>
   EMAIL_REPLY_TO=support@yourcompany.in   # optional
   ```
   Emails are always sent over TLS. Failed sends are retried 3 times and logged.

### SMS (Networkz)
Already connected. Before go-live:
- Networkz must enable the **transactional route** for sender `NETSYS`.
- In **Admin › SMS Notifications**, enter the DLT template ID and exact approved wording for each message.
- Optional: set up the delivery webhook (see `server/.env.example`).

## 3. Build and start

On the host, from the repository root (production branch only):

```bash
npm ci
npm run build          # type-checks and builds the website into client/dist
npm start              # starts the server in production mode
```

`npm start` runs the server with `NODE_ENV=production`. With `CLIENT_DIST_DIR=../client/dist` (relative to `server/`) the same server also serves the website, so the website and API share one HTTPS address and the login cookies stay first-party. Put the host's HTTPS / load balancer in front of port `PORT` (default 4000).

Required production settings, besides the services above:

```
NODE_ENV=production
CLIENT_ORIGIN=https://portal.yourcompany.in
CLIENT_DIST_DIR=../client/dist
JWT_ACCESS_SECRET=<48+ random characters>   # node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
TRUST_PROXY=1          # number of proxies / load balancers in front of the server
```

**The server refuses to start in production** if it would use the test mailbox, files on its own disk, a local database, a website address without `https`, or a short secret.

Several server instances are fine: the daily 09:00 check runs exactly once per day across all of them.

## 4. First start

1. Start the server once; check the log shows all migrations applied and `API server running`.
2. Create the first Admin login (there is no public way to create one):
   ```bash
   npm run create-admin -w server -- --name "Your Name" --email you@yourcompany.in --username admin
   ```
   It emails a set-password link (so email must already work).
3. Log in as Admin and complete **Settings**: organisation name, logo, colours, support email and phone, registered address, Grievance Officer; check reminder intervals and public holidays.
4. **Agreement Content**: upload and publish the agreement PDF. Registration opens once it is published.
5. **Accounts Users / Manager Users**: create the staff logins.
6. **SMS Notifications**: send a test SMS to your own number.
7. Run one real registration end to end with a test PAN, then erase it via Data Deletion Requests if needed.

Never run `npm run seed:dev` against the live database; it is for development only.

## 5. Git and releases

- All work happens on `development`. `production` changes only through a reviewed pull request (GitHub branch protection: require a pull request with one approving review, block direct and force pushes).
- Deploy from `production` only.

## 6. Before launch checklist

- [ ] Atlas cluster with backups, IP allow-list, least-privilege user
- [ ] Private bucket, public access blocked, limited access key
- [ ] Sending domain verified (SPF, DKIM, DMARC); a test email received
- [ ] Networkz transactional route enabled; DLT wording entered; test SMS received
- [ ] HTTPS address set in `CLIENT_ORIGIN`
- [ ] First Admin created; Settings, agreement, staff users done
- [ ] Privacy Policy and Terms reviewed by a lawyer; legal details filled in Settings
- [ ] `production` branch protected on GitHub
- [ ] `npm test` passes on the release commit
