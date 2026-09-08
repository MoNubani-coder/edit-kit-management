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
