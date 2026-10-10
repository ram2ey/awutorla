# Hetzner / Coolify deployment with PostgreSQL

One Node container serves the frontend and same-origin API on **port 3000**.
Ordinary PostgreSQL holds workshop data, staff accounts and revocable sessions.
Private images live in the app's upload volume. No Supabase, Hubtel, SMTP or
browser API keys are required.

## Create the database

Add a **PostgreSQL** resource in Coolify, on the same server and Docker network
as the app. Use PostgreSQL **16+**, a dedicated empty database and its persistent
volume. Keep access private; do not publish port 5432. Copy the **internal
connection URL**. Coolify's default PostgreSQL administrator has the extension,
schema and role creation privileges needed for first startup.

The backend creates native support schemas and applies workshop SQL 01–08. It
records checksums and takes a database lock; restarts skip applied migrations.
Changed historical migrations stop startup. Add/register a new migration for
future schema changes. API queries run under the restricted `authenticated`
role with the actual staff identity and PostgreSQL row-level security.

Existing workshop tables without native migration history are rejected. Do not
replay historical migrations on a newer schema or restore an entire Supabase
system-schema dump over these native schemas.

## Configure the app

Add an Application from [ram2ey/awutorla](https://github.com/ram2ey/awutorla).
Use a GitHub App/deploy key if the repository is private.

| Setting | Value |
| --- | --- |
| Branch | `main` |
| Build pack / strategy | **Dockerfile** |
| Base directory | `/` |
| Dockerfile location | `/Dockerfile` |
| Ports Exposes | `3000` |
| Domain | Your HTTPS domain |
| Port mappings | Empty; traffic goes through Coolify's proxy |
| Persistent storage destination | `/app/uploads` |

Add a named volume for `/app/uploads` **before uploading files**. The app runs
as UID/GID **1000** (`node`); an existing bind mount must be writable by that user.
Do not mount over `/app`, `/app/dist`, `/app/server` or the migration directory.

Set these as **runtime-only** variables:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Private PostgreSQL connection URL |
| `APP_ORIGIN` | Exact HTTPS origin, e.g. `https://atelier.your-domain.com` |
| `BOOTSTRAP_ADMIN_EMAIL` | First admin's email |
| `BOOTSTRAP_ADMIN_PASSWORD` | Unique temporary password, 12–256 characters |
| `BOOTSTRAP_ADMIN_NAME` | First admin's name |

The image sets `NODE_ENV=production`, `PORT=3000`, `UPLOAD_DIR=/app/uploads`.
No build variables are required. Remove old `VITE_SUPABASE_*` settings.
`APP_ORIGIN` has no path or trailing slash. Mutations from other origins are
rejected. Use one canonical domain and redirect aliases through the proxy.

The Dockerfile defines its own `/healthz` check, including database connectivity.
Coolify detects that image health check. Test it inside the app terminal:

```sh
node -e "fetch('http://127.0.0.1:3000/healthz').then(async r=>console.log(r.status,await r.text()))"
```

Relevant official guides: [Dockerfile setup](https://coolify.io/docs/applications/builds/dockerfile),
[runtime variables](https://coolify.io/docs/applications/configuration/environment-variables),
[PostgreSQL](https://coolify.io/docs/databases/postgresql),
[health checks](https://coolify.io/docs/applications/configuration/health-checks).

## Domain and first login

Point the domain's A record at the Hetzner public IPv4 address. Add AAAA only if
the server serves the domain over IPv6. Allow public 80/443 for proxy traffic and
certificate generation. Keep SSH limited to administrative addresses. Do not
publish the app's 3000 port or the database port. Follow Coolify's
[firewall guide](https://coolify.io/docs/core/infrastructure/servers/firewall)
for initial dashboard and terminal access.

Deploy, inspect migration/startup logs, then sign in with the bootstrap password.
Choose a permanent password before working. Remove `BOOTSTRAP_ADMIN_PASSWORD`
from Coolify and redeploy. Bootstrap only runs when the staff table is empty;
later deploys do not reset accounts.

Admins create staff and reset passwords in **Settings → Tailors & Team**.
Temporary passwords must be replaced; a reset revokes existing sessions.
No password-reset email is sent. If the only admin loses access, use the **app**
terminal (enter values at the prompts so they are not saved in shell history):

```sh
read -r -p 'Staff email: ' STAFF_EMAIL
read -r -s -p 'Temporary password: ' STAFF_PASSWORD; echo
export STAFF_EMAIL STAFF_PASSWORD
node server/admin.mjs
unset STAFF_EMAIL STAFF_PASSWORD
```

This resets an existing account's password and sessions, not its role.

## Verify and maintain

- Verify HTTPS login/logout, required password replacement and tailor/admin permissions.
- Save intake with a private image and deposit. Record two manual receipts and
  retry one; the retry must not duplicate it.
- Advance production and record manual SMS sending. No provider is called.
- Test fittings, rework, quality approval and Ready/Delivered progression.
- Changes appear on other visible devices within 15 seconds, or on returning focus.
- Restart the app and confirm records **and existing uploaded images** persist.
- An unsigned browser cannot read `/api/files?path=...`; referenced images cannot
  be deleted through the unused-upload control.

Run `npm run test:container -- https://your-app-domain` for a read-only HTTP check
of health, assets, headers, direct links and anonymous API denial.

Enable scheduled PostgreSQL backups in Coolify and keep copies off the server.
Back up `/app/uploads` separately; database dumps contain metadata, not image
bytes. Pause app writes for a consistent database/file backup and test restoring
both together. Persistent volumes are not backups. Use one app instance on this
server unless shared file storage is added.

Keep Coolify, PostgreSQL and container base images patched. Pull fresh base
images when rebuilding for patches. Back up before schema updates; rolling back
an app image does not roll back its database.

Moving existing Supabase data requires a separate reviewed import. Preserve IDs,
ledger/history rows and measurement revisions. Native staff need new password
hashes/temporary passwords; old Supabase sessions are not used. Copy attachment
bytes and metadata under their recorded paths. Reconcile counts, balances and
private reads before retiring the source. This change does not move hosted data.

## Docker Compose alternative / local test

`compose.yaml` includes the app, PostgreSQL 16 and their persistent volumes.
It can also be used as a Coolify Docker Compose application: configure the same
origin/admin variables plus `POSTGRES_PASSWORD`, and attach the app domain to
port 3000. Use a long random hex/alphanumeric database password so the generated
connection URL needs no escaping. The standalone database resource above lets
Coolify manage PostgreSQL backups directly.

For a disposable local stack, put fake bootstrap credentials, `POSTGRES_PASSWORD`
and `APP_ORIGIN=http://127.0.0.1:3000` in an ignored `.env`, then:

```sh
docker compose -f compose.yaml -f compose.test.yaml up --build -d --wait
npm run test:container
```

The test override binds port 3000 to loopback and allows HTTP cookies. **Do not
use `compose.test.yaml` in production.** CI builds this stack with fake records
and checks PostgreSQL transactions, uploads and persistence after restart.
