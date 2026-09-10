# OPERATIONS.md

Running, backing up and restoring the Edit Kit Management System.

Two things hold the record, and both must be in every backup:

| What | Where | Why it matters |
|---|---|---|
| The database | PostgreSQL 16 | Bookings, inspections, the frozen documents, the append-only audit log |
| The storage directory | `STORAGE_LOCAL_PATH`, `/app/storage` in the image | Signature images and inspection and issue photos |

A database without its storage directory produces documents whose signature
boxes read "signature on file". A storage directory without its database is a
folder of anonymous PNGs. Neither half is a backup on its own.

---

## 1. Deploying

### The image

```bash
docker build -f docker/Dockerfile -t ekms:latest .
```

Three stages: `npm ci`, then `prisma generate` and `next build`, then a runtime
stage carrying only the standalone server, the static assets, the Prisma CLI
and the schema. It runs as the unprivileged `node` user, listens on 3000, and
declares a health check against `/api/health`.

`.dockerignore` keeps `.env`, `storage/`, `node_modules/` and the host's build
output out of the build context. Without it `COPY . .` would bake a real
`.env` and real signature images into a layer.

### Running it

```bash
docker compose --profile app up -d --build
```

`AUTH_SECRET` must be set in the environment; compose fails fast if it is not.
The `app` service mounts a named volume at `/app/storage`. **That volume is not
optional.** Without it every redeploy destroys signed handover evidence.

### Migrations

Migrations are never applied automatically at boot: a container restart loop
would run them repeatedly, and a schema change should be a decision.

```bash
docker compose exec app npx prisma migrate deploy
docker compose exec app npx prisma migrate status
```

Take a backup first (§2). `migrate deploy` applies only migrations that have
not run; it never resets and never generates.

### Required environment

| Variable | Notes |
|---|---|
| `DATABASE_URL` | PostgreSQL 16 with `pg_trgm` and `btree_gist` available |
| `AUTH_SECRET` | 32 characters or more. Rotating it signs everybody out |
| `AUTH_TRUST_HOST` | `true` behind a proxy |
| `APP_TIMEZONE` | The business time zone, `Asia/Dubai` by default |
| `APP_ORG_NAME` | Printed on every document |
| `STORAGE_PROVIDER` | `LOCAL` today; the provider is recorded per file (AD-4) |
| `STORAGE_LOCAL_PATH` | The volume mount, `/app/storage` in the image |
| `AUTH_LOCAL_LOGIN_ENABLED` | `true` (default). Local email + password accounts; keep on for the emergency administrator |
| `AUTH_LDAP_ENABLED` | `false` (default). Corporate directory sign-in; see §6 before turning it on |
| `LDAP_*` | Only read when `AUTH_LDAP_ENABLED=true`; the full list and the rules are in §6 and `.env.example` |

### Checking a deployment

```bash
curl -fsS https://<host>/api/health     # {"status":"ok"} and 200
```

`/api/health` answers 503 when the database is unreachable, and the
application shows a bounded "temporarily unavailable" page rather than
clearing anybody's session. A 503 from a freshly started container with no
database attached is the honest answer, not a failure of the image.

---

## 2. Backup

```bash
DATABASE_URL='postgresql://…' STORAGE_LOCAL_PATH=./storage \
  scripts/ops/backup.sh ./backups/2026-09-07
```

The script is read-only against the database, so it is safe to run while the
application is up. It writes four files:

| File | What it is |
|---|---|
| `database.dump` | `pg_dump --format=custom`, compressed, restorable selectively |
| `storage.tar.gz` | The storage directory |
| `migrations.txt` | Which migrations the dump contains |
| `SHA256SUMS`, `MANIFEST` | Checksums and where the backup came from |

The dump is taken before the archive. A signature row whose file has not been
archived yet still renders a document; a file with no row is invisible. The
order errs towards keeping every row.

**Schedule.** Daily, retained for a month, plus one monthly copy kept for as
long as the equipment disputes it might settle. The audit log and the frozen
documents are the reason: they are evidence, and they only accumulate.

**Off the machine.** A backup on the same host survives a bad deployment, not
a dead disk. Copy each night's directory somewhere else and check that the
copy still passes `sha256sum --check SHA256SUMS`.

---

## 3. Restore

```bash
# Stop the application first.
docker compose stop app

DATABASE_URL='postgresql://…' STORAGE_LOCAL_PATH=./storage \
  scripts/ops/restore.sh ./backups/2026-09-07 --yes

docker compose start app
```

The script verifies the checksums before it touches anything, refuses a target
that already has tables unless `--yes` is given, restores inside a single
transaction so a failure leaves the target as it was, extracts the storage
archive, then prints the row counts and compares the migration list with the
one in the backup.

**Then check it by hand**, because row counts do not prove a document renders:

1. Sign in.
2. Open the most recent completed booking.
3. Open its signed handover document. The signature images must appear, not
   the words "signature on file".
4. Download the PDF.
5. Open `/admin/audit-logs` and confirm the last entries are the ones you
   expect to be last.

If the signature images are missing, the database restored and the storage
archive did not.

### Restoring into a scratch database first

The safe way to rehearse, and the way to check a backup without touching
production:

```bash
createdb ekms_restore_check
DATABASE_URL='postgresql://…/ekms_restore_check' STORAGE_LOCAL_PATH=/tmp/storage-check \
  scripts/ops/restore.sh ./backups/2026-09-07
npx prisma migrate status        # with DATABASE_URL pointing at the scratch database
dropdb ekms_restore_check
```

A backup nobody has restored is a hypothesis. Rehearse it quarterly.

---

## 4. What cannot be undone

- **Applied migrations.** Never edit one that has run anywhere. Write another.
- **Signed inspections.** A database trigger refuses any change to a locked
  inspection except voiding it, and refuses every change to a signature. A
  mistake is corrected by voiding and redoing, which leaves both records.
- **The audit log.** Triggers refuse `UPDATE` and `DELETE`. Nothing in the
  application tries; nothing outside it can either.

These are proved on every test run by `tests/integration/constraints.test.ts`,
and can be checked against a live database with
`psql "$DATABASE_URL" -f scripts/db/verify-constraints.sql`, which rolls
everything back.

---

## 5. Tests, and what each one is for

| Command | What it proves | Needs |
|---|---|---|
| `npm test` | Units, services, actions, routes and the database's own constraints | A PostgreSQL 16 at `DATABASE_URL` |
| `npm run test:e2e` | A booking goes out and comes back, in a browser | The above, plus Chromium |
| `npm run check` | Types and lint | Nothing |
| `npm run build` | The production build compiles | Nothing |
| `psql -f scripts/db/verify-constraints.sql` | The same constraints plus the seeded fixture's shape | A seeded database |

`npm test` runs against the development database inside transactions that are
always rolled back, so it leaves no rows, no files and no numbering gaps.
`npm run test:e2e` cannot use that trick - a browser journey commits - so it
builds a database of its own (`ekms_e2e`), seeds it with its own accounts and
writes its files to `./storage-e2e`. It never touches development data.

The SQL script keeps two checks the automated suite deliberately does not
have: `9c` and `9d` assert the seeded fixture's exact shape, and fail against
any database where equipment has been added by hand. That is useful on a fresh
seed and misleading everywhere else, which is why the automated constraint
tests build their own fixtures instead.

CI runs all of it against a PostgreSQL service container and builds the
production image: `.github/workflows/ci.yml`.

## 6. Directory sign-in (LDAP / Active Directory)

Staff can sign in with their corporate credentials once the directory is
configured. Until then `AUTH_LDAP_ENABLED` stays `false` and nothing in this
section applies: every account is a local one and sign-in works exactly as it
did.

### What the application does

1. The person types a username (or UPN, or email) and their password.
2. If the name is the email of a local account *with a password*, the password
   is checked locally (bcrypt) and never leaves the server. Otherwise:
3. The application connects over TLS, finds the user under
   `LDAP_USER_BASE_DN` with `LDAP_USER_FILTER` (the typed name escaped per
   RFC 4515), and verifies the password by binding as that entry - which is
   what makes the entry and the authenticated person the same account.
   Without a service account it binds directly as
   `<username>@<LDAP_UPN_SUFFIX>` (or the UPN as typed), then looks for that
   exact principal and refuses unless the entry says it is that principal, so
   a shared account name cannot sign somebody in as a colleague.
4. The directory entry's stable id (`LDAP_ID_ATTRIBUTE`, objectGUID by
   default) is looked up in the `accounts` table. A linked account signs in.
   Otherwise the email may be claimed once, and only when the account has no
   local password, no directory link already, and is ACTIVE - so a reassigned
   mailbox cannot inherit somebody else's account and a disabled placeholder
   collects no identity bindings. Anyone else is refused unless
   `LDAP_AUTO_PROVISION=true`.
5. The local `users` row is what the session, RBAC, audit trail and every
   "prepared by / handed over by / received by" read. The directory is not
   consulted again for the life of the session.

The password is used for one bind and is not written anywhere - not to the
database, the audit log, the session, the logs or an error message.

### Connection security

- `ldaps://` on 636 is preferred. `ldap://` on 389 is accepted only with
  `LDAP_STARTTLS=true`, which upgrades the connection before anything is sent.
  They are alternatives: `ldaps://` with `LDAP_STARTTLS=true` is refused at
  startup (LDAPS is already encrypted and answers a StartTLS request with an
  error), and so is `ldap://` without it.
- Certificate validation is always on and cannot be switched off.
- An internal CA is trusted with `LDAP_TLS_CA_FILE=/path/to/ca-bundle.pem`
  (mount it read-only into the container) or by setting `NODE_EXTRA_CA_CERTS`
  for the Node process. If the certificate's name differs from the host in
  `LDAP_URL`, set `LDAP_TLS_SERVERNAME`.
- The service account, if used, needs read access to the user subtree and
  nothing else. Rotate its password like any other secret; it lives only in
  the environment.

### Accounts and roles

- Roles are local. A directory sign-in never changes a role unless
  `LDAP_ROLE_GROUPS_*` are configured; then the most powerful matching group
  decides, and a person in no mapped group keeps the role an administrator
  gave them. ADMIN can only ever come from `LDAP_ROLE_GROUPS_ADMIN`.
- `LDAP_AUTO_PROVISION=false` (default): create the account first with the
  person's corporate email, no password and status ACTIVE - `npm run
  auth:provision-directory-user -- <email> --name "Full Name" --role ENGINEER`
  does exactly that - and their first directory sign-in links it. Unknown
  people, and people whose account is not ACTIVE, see "not set up for this
  application yet"; the refusal is in the audit log with their directory
  username, email and id, which is what an administrator needs to create the
  right account.
- `LDAP_AUTO_PROVISION=true`: the first successful sign-in creates an ACTIVE
  account with `LDAP_DEFAULT_ROLE` (never ADMIN) and the directory's display
  name, email and staff number. The creation is in the audit log.
- Suspending or disabling a directory-backed account, or changing its role,
  takes effect at once exactly as for a local account: the session version is
  bumped and every session ends on its next request.

### If the directory is down

Directory-backed users see "The sign-in service is temporarily unavailable" and
can try again; nothing is locked and no cookie is touched. Local accounts -
the emergency administrator above all - keep signing in, because their
password is checked locally. Existing sessions are unaffected either way,
because the session reads the local database, not the directory.

A refused service account, an unreadable CA file or a base DN the directory
does not know are reported separately ("Sign-in is unavailable right now...
contact an administrator") and logged with the error name only, never a DN or
a password. They are never reported as the person having typed the wrong
password.

If a directory identity has to be cut off in a hurry, suspend the local
account (Administration → Users): its sessions end on the next request and the
directory can no longer sign it in. `npm run auth:reset-password` refuses a
directory-linked account unless `RESET_PASSWORD_ALLOW_DIRECTORY_ACCOUNT=true`
is set, and then it also removes the directory link, so the account moves to
local sign-in rather than accepting both.

### Commissioning checklist (what IT has to provide)

| Item | Used for | Variable |
|---|---|---|
| Directory host and port, and whether it is LDAPS (636) or LDAP+StartTLS (389) | Connecting | `LDAP_URL`, `LDAP_STARTTLS` |
| The CA certificate chain the directory presents, if internal | Trusting the connection | `LDAP_TLS_CA_FILE` / `NODE_EXTRA_CA_CERTS` |
| Base DN of the domain | Search scope | `LDAP_BASE_DN` |
| The OU (or OUs) that hold staff user objects | Confining the user search | `LDAP_USER_BASE_DN` |
| A read-only service account DN and password - or confirmation that direct user bind is preferred, with the UPN suffix | Locating the user before their password is verified | `LDAP_BIND_DN`, `LDAP_BIND_PASSWORD` or `LDAP_UPN_SUFFIX` |
| Which attribute people sign in with (sAMAccountName, userPrincipalName, mail) | The user filter | `LDAP_USER_FILTER`, `LDAP_USERNAME_ATTRIBUTE` |
| The stable identity attribute (objectGUID recommended) | Linking accounts | `LDAP_ID_ATTRIBUTE` |
| Display name, email and staff-number attributes | Names on documents; account email; staff ID | `LDAP_NAME_ATTRIBUTE`, `LDAP_EMAIL_ATTRIBUTE`, `LDAP_STAFF_ID_ATTRIBUTE` |
| Group DNs for ADMIN / ENGINEER / EDITOR / VIEWER, if roles are to follow groups | Role mapping | `LDAP_ROLE_GROUPS_*` |
| Firewall rule from the deployment host to the directory port | Reachability | - |
| Whether new staff should be provisioned automatically, and with which role | Provisioning policy | `LDAP_AUTO_PROVISION`, `LDAP_DEFAULT_ROLE` |

Then: set the variables, keep `AUTH_LOCAL_LOGIN_ENABLED=true`, restart, sign in
as the local administrator, create (or let auto-provisioning create) one test
account, sign in with it, and check the audit log shows `signed in with the
corporate directory`. Only then consider disabling local sign-in - and keep at
least one local ADMIN account in reserve.
