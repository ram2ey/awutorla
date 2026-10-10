# Awutorla

Staff-only management for a Ghanaian bespoke tailoring workshop. Customers are
independent records, not login accounts. Progress SMS and payments are recorded
manually. No Hubtel account or SMS provider credentials are required.

React + TypeScript + Vite + Tailwind, with a Node.js API, ordinary PostgreSQL,
staff session cookies and private uploads. Deploy on Hetzner using Coolify.
See [the Coolify deployment guide](docs/COOLIFY.md) for exact settings.

## Development

```bash
npm ci
cp .env.example .env
# Set a dedicated local DATABASE_URL and initial admin credentials in .env.
# Terminal 1: backend (initializes an empty database)
npm run dev:server
# Terminal 2: frontend at http://localhost:5173
npm run dev
npm test
npm run lint
npm run build
```

Only tailors and admins can sign in. Admins create staff accounts in Settings →
Tailors & Team. Register customers through New Intake, using their Ghanaian phone
number. Staff manage orders and master measurements from Clients or the dashboard.

## Manual workshop workflow

- **Progress SMS:** advance through Received → Cutting → Fitting → Finishing →
  Ready → Delivered. Each change saves its history and an SMS record together.
  Copy the phone number/message from SMS History or the dashboard, send it using
  your phone, then select **I sent this SMS**. This records the staff identity and
  confirmation time; it does not send a message or confirm handset delivery.
- **SMS queue:** pending/failed current-stage messages need manual sending. Older
  unsent milestones become outdated rather than being sent after newer progress.
  Previously submitted/uncertain provider records stay visible and cannot be
  resent through this control. Review their original provider report separately.
- **Payments:** record receipt amount, method, actual receipt date, reference and
  notes. The ledger adds payments atomically and safely retries the same submission.
  An excess payment needs explicit confirmation and appears as customer credit.
  These records do not initiate a bank, card or mobile money transaction.
- **Corrections:** admins can reverse an incorrect record and enter a replacement.
  The original stays visible. A correction uses the original receipt date; this
  workflow corrects bookkeeping and is not a cash refund workflow.
- **Measurements:** save values, units and notes together. Blank fields clear the
  corresponding active measurement. A stale version cannot overwrite a newer edit.
  Every order has its own snapshot. Apply the latest master measurements explicitly
  to an active order when required; delivered specifications are archived.
- **Reporting:** monthly net receipts use receipt dates in Ghana, including
  corrections. Outstanding balances include delivered/unpaid orders. Views cover
  overdue orders, unpaid balances, delivered debt, customer credit and unsent SMS.
  Orders, payments and invoices use GHS consistently.
- **Fittings and rework:** use the job card's Fittings & Quality tab. Bookings use
  Ghana time; overlapping appointments for the same staff member are blocked.
  Record completion, cancellation or a missed appointment with its outcome.
  Open rework on a Ready order returns it to Finishing. Admins can reopen a
  delivered order for alterations with a reason; the original history stays visible.
- **Quality gate:** complete tasks, resolve scheduled fittings and close rework,
  then confirm fit, saved measurements, construction and finishing. Ready and
  Delivered require a passing check for the current work version. Task,
  measurement, fitting or rework changes invalidate earlier checks. Existing Ready
  orders need a check too; historical quality approval is never invented.
- **Admin controls:** price and primary assignment changes require an admin, a
  reason and a fresh order version. A lower price that creates credit requires
  explicit confirmation. Audit events retain actor, time and before/after details.
- **Submission review:** admins can resolve old uncertain SMS records with evidence
  from the original report. A verified submission stays closed to manual resending;
  a verified non-submission returns only the current production cycle to the queue.
- **Offline drafts:** within an already verified staff session, cached cards remain
  readable. Master measurement edits can be retained as device-local drafts; sync
  is explicit and version conflicts show the newer saved values. Resolve the
  differences through the customer editor. Signing out clears caches and drafts.
  Payments, intake and SMS confirmation require an online database response.
- **Unused uploads:** Settings → Unused Uploads lists unused images older than 48
  hours. Admins review each permanent deletion. Saved order attachments and recent
  uploads are protected by the database; no cleanup runs automatically.

## Migration and deployment

For a new database, the backend creates native support schemas and applies
migrations 01–08 automatically. It records checksums and never reapplies them on
restart. Historical migrations are not a reset script. Existing workshop tables
without native migration history need a reviewed data import. Back up before
schema changes and review the preservation notes below.

Migration **05** separates customer records from auth profiles, preserves IDs and
relationships, blocks legacy client access and makes workshop files private.
Migration **06_manual_workshop.sql** implements phases 1–4:

- Preserves existing paid totals as opening ledger balances. Their original receipt
  dates are unknown, so they are excluded from monthly receipts until reconciled
  from actual records. Do not infer those dates from order creation or prose notes.
- Captures existing order measurements as `legacy_migration` snapshots of the then
  current master record. This cannot reconstruct their original intake dimensions.
- Stops if legacy orders contain non-GHS currency or negative amounts. Review those
  rows explicitly; the migration does not invent an exchange rate or change money.
- Removes the old automatic sender's claim function. New stage updates use a staff
  database RPC, and manual confirmations are separate staff operations.
- Protects ledger totals, production milestones and order specifications from direct
  API writes. Payment/measurement operations check the real staff identity in SQL.

Migration **07_workshop_operations.sql** adds fitting/rework/quality records,
immutable audit events, audited admin terms, reopening cycles and verified SMS
review. Migration **08_reports_and_recovery.sql** adds server-computed totals,
25-record report/search pages, idempotent measurement draft submissions and storage
protection. Deploy these together with the frontend; don't run an older automatic
sender or reapply an earlier historical migration after 07/08.

Attachment URLs renew when opening a card, returning focus and every 45 minutes
while it is open. The Fabric & Specs tab also provides a refresh control. The service
worker caches the shell and hashed assets; HTML uses the latest deployment first.

The Dockerfile builds the frontend and runs the Node API on port 3000. Configure
`DATABASE_URL` and the HTTPS `APP_ORIGIN` as runtime settings in Coolify. Add
persistent storage at `/app/uploads`; PostgreSQL needs its own volume and backups.
Set the initial admin credentials once, then remove the bootstrap password after
login. Staff passwords use salted scrypt hashes; sessions use revocable HttpOnly
cookies. Admins issue temporary passwords from the team screen. No SMTP is required.

Historical SQL remains in `supabase/migrations`; its auth/storage schemas are now
owned by the app. No Supabase service is needed. Old Edge Function source is not
shipped in the native production image. If retiring an existing Supabase deployment,
disable its previous client APIs and automatic sender after migrating its data;
changing the frontend cannot disable an external service.

After deployment, verify staff login, denial for legacy client accounts, intake with
a deposit, two separately recorded payments, correction permissions, unchanged
order measurements after a master edit, Delivered progression and manual SMS history.
Also verify booking conflicts, rework and a new quality check before Ready, admin-only
terms, an offline measurement conflict, report pagination and referenced-file
deletion denial. Test the Storage deletion trigger with a disposable upload first.

## Validation and local UI fixtures

`npm test` includes PostgreSQL migration/permission/transaction checks via PGlite,
manual workflow/reporting checks and native backend HTTP integration tests.
GitHub CI builds the Docker image and tests actual PostgreSQL through the production
driver, including upload/database persistence after restart.
`npm run test:container -- https://your-app-domain` is a read-only HTTP check.
Docker is required for the full container check; follow [docs/COOLIFY.md](docs/COOLIFY.md).

For UI development without a PostgreSQL installation, run
`node scripts/preview-postgres-ui.mjs` and `npm run dev` in separate terminals.
Open `http://localhost:5173` and use the fake login printed by the fixture server.
It uses an isolated in-memory PostgreSQL database, never your `DATABASE_URL`, and
is excluded from the production image. Stop it before starting the real backend.

See [docs/REASSESSMENT.md](docs/REASSESSMENT.md) for completed findings and remaining work.

Build styling uses Tailwind 4's Vite plugin with the existing atelier configuration,
following the [official upgrade guide](https://tailwindcss.com/docs/upgrade-guide).
Supported browsers are Safari 16.4+, Chrome 111+ and Firefox 128+. Compatible patches
for DOMPurify/source-map-js are locked, and `npm audit` reports no vulnerabilities
as of 9 October 2026. Pages load separately to keep the main production bundle
below the size warning threshold.
