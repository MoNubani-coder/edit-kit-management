# DEVELOPMENT.md

Running log of what exists, what to test, and what comes next.

- **Current phase:** 1 of 13 — Architecture and database schema
- **Status:** ✅ complete and **verified against PostgreSQL 16.15** — both
  migrations applied, seed run three times (idempotent), 18/18 database
  constraint tests pass, health endpoint 200, production build clean
- **Last updated:** 2026-09-03

Companion documents: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (design and
rationale) · [docs/ROADMAP.md](docs/ROADMAP.md) (all 13 phases).

---

## Prerequisites

| Tool | Version | Status on this machine |
|---|---|---|
| Node.js | ≥ 22.12 (LTS) | ✅ **24.19.0** — upgraded from 23.11.0 during setup |
| npm | ≥ 10 | ✅ 11.17.0 |
| PostgreSQL | 16 | ✅ **16.15 inside WSL Ubuntu** — installed during setup |
| Docker Desktop | any recent | ❌ not installed (compose file is ready for when it is) |
| Git | any | ❌ not installed — **the repo is not under version control yet** |

> **Node 23 was a blocker, not a warning.** Prisma 7 supports only Node 20.19+,
> 22.12+ and 24.0+. Odd-numbered Node releases are non-LTS and 23 is now
> end-of-life, so `npm install prisma` aborted outright. Node 24.19.0 LTS is now
> installed and `package.json` pins `engines.node >= 22.12` so this cannot
> silently regress.

---

## Day-to-day on this machine

PostgreSQL lives inside WSL and does **not** start automatically after a Windows
reboot. Before `npm run dev`:

```powershell
wsl -u root -e service postgresql start
```

Then the normal loop:

```powershell
npm run dev            # http://localhost:3000
npm run db:studio      # browse data
npm run check          # tsc + eslint
```

`.env` already points at the WSL database
(`postgresql://ekms:ekms_local_dev@localhost:5432/ekms`).

---

## First-time setup on a fresh machine

### 1. PostgreSQL 16 — pick one

**Option A — Docker Desktop (matches the committed compose file)**

```powershell
winget install Docker.DockerDesktop
# start Docker Desktop once, then:
npm run db:up
```

**Option B — PostgreSQL for Windows**

```powershell
winget install PostgreSQL.PostgreSQL.16
```

Then create the `ekms` role and database and point `DATABASE_URL` at them.

**Option C — inside WSL Ubuntu (what this machine uses)**

```powershell
wsl -u root -e bash -c "apt-get update && apt-get install -y postgresql-16 postgresql-contrib-16"
wsl -u root -e bash -c "cd /mnt/c/<path-to-repo> && sed -i 's/\r$//' scripts/db/*.sh scripts/db/*.sql && bash scripts/db/wsl-postgres-setup.sh"
```

`scripts/db/wsl-postgres-setup.sh` is idempotent: it configures `listen_addresses`,
adds a `pg_hba` rule, creates the `ekms` superuser role and the `ekms` database.
The `sed` strips Windows line endings, which bash otherwise chokes on.

> The role is `SUPERUSER` only so the migration can run
> `CREATE EXTENSION btree_gist` and `pg_trgm`. Neither is a "trusted" extension.
> On Azure Database for PostgreSQL, allow-list both via the `azure.extensions`
> server parameter instead of granting superuser.

### 2. Environment

```powershell
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # -> AUTH_SECRET
```

`.env` is git-ignored. `.env.example` documents every variable and **is** committed.

### 3. Migrate and seed

```powershell
npm run db:migrate     # applies both migrations
npm run db:seed        # idempotent - safe to re-run
npm run dev
```

The seed prints the sign-in accounts. If `SEED_*_PASSWORD` is not set in `.env`
it generates strong random passwords and prints them **once**. Re-running the
seed never rotates an existing password and says so explicitly; to reset
passwords set the env vars and run `npm run db:reset`.

---

## Verification results — 2026-09-03

Everything below was actually run against the WSL database, not inferred.

| Check | Result |
|---|---|
| `prisma migrate deploy` — both migrations | ✅ applied cleanly |
| `prisma migrate diff` live DB vs `schema.prisma` | ✅ empty — no drift |
| `prisma db seed` × 3 | ✅ run 1 created everything; runs 2 and 3 created 0 rows, allocated no new `AST-` codes |
| `scripts/db/verify-constraints.sql` (run twice) | ✅ **18 / 18 PASS** |
| `GET /api/health` with DB up | ✅ 200 `{"status":"ok"}` |
| `GET /` | ✅ 200, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` |
| `npm run check` (tsc + eslint) | ✅ clean |
| `npm run build` (Turbopack, standalone) | ✅ clean |

**What the 18 constraint tests prove** (`scripts/db/verify-constraints.sql`,
rolls back — safe to run any time):

1. Overlapping `RESERVED` bookings on one kit → rejected by the exclusion constraint
1b. Overlapping `CANCELLED` booking → allowed (cancelled bookings don't hold the kit)
1c. Adjacent, non-overlapping booking → allowed
2. `bookingEnd < bookingStart` → rejected
3. Second live `HANDOVER` inspection on one booking → rejected; **allowed after voiding the first**
4. Same asset in two kits → rejected
5. `UPDATE` on a locked inspection → rejected by trigger; **voiding it still allowed**
6. `UPDATE` on a signature's image → rejected by trigger; **voiding still allowed**
7. `UPDATE` / `DELETE` on `audit_logs` → both rejected
8. Numbering upsert increments 1 → 2 atomically
9. Seed sanity: 12 assets in MBP-02, 2 external editors with no login, no real-looking serials, `AST-` codes contiguous

Run it yourself:

```powershell
wsl -u root -e bash -c "cd /mnt/c/Users/2latvae602142/source/repos/edit-kit-management && PGPASSWORD=ekms_local_dev psql -h localhost -U ekms -d ekms -f scripts/db/verify-constraints.sql"
```

### Still worth doing by hand

- [ ] Open `npm run db:studio` and eyeball the kit → assets → accessories chain.
  Studio is where you'll notice a wrong slot label or a category that reads
  oddly — things a count can't catch.
- [ ] Stop the WSL database (`wsl -u root -e service postgresql stop`) and hit
  `/api/health` — confirm **503** with no error detail leaked. Start it again.

---

## Working with migrations — read before touching the schema

- **Never run `prisma db push` on this project.** It syncs the schema directly
  and skips migration files — which means it silently omits the exclusion
  constraint, the partial unique indexes and all three immutability triggers.
  Use `npm run db:migrate` (creates + applies a migration) every time.
- Prisma cannot express partial indexes, exclusion constraints, or triggers, so
  those live in hand-written migration SQL. Prisma **ignores** them during drift
  detection, so they are safe. Plain (non-partial) indexes it *does* see — which
  is why the trigram GIN indexes are declared in `schema.prisma` as well as in
  the migration, with matching `map:` names.
- Adding an `AuditAction` enum value is a normal migration. Do not reach for a
  `String` column to avoid it.

---

## Completed in Phase 1

**Database — `prisma/schema.prisma`**

26 models, 17 enums. Highlights:

- `EditorProfile.userId` is **nullable** so external editors with no login can
  still appear on bookings and sign handovers.
- `Inspection` rows are per-phase; the return never overwrites the handover.
- Every inspection line carries `*Snapshot` columns, so editing an asset cannot
  rewrite a signed document.
- `BookingChecklistItem` (the snapshot) is split from `ChecklistResult` (the
  per-inspection answer) — see ARCHITECTURE.md §3.5.
- `AccessoryType` added so accessory naming is admin-managed, not free text.
- All 79 `DateTime` columns are `TIMESTAMPTZ(3)`, not Prisma's default
  `TIMESTAMP` without time zone.
- 11 trigram GIN indexes declared for global search.

**Migrations — `prisma/migrations/`**

- `20260903000000_init` — generated from the schema.
- `20260903000100_integrity_constraints_and_search_indexes` — hand-written:
  exclusion constraint against double-booking, two CHECK constraints, three
  partial unique indexes, three immutability triggers, trigram indexes, partial
  dashboard indexes.

**Seed — `prisma/seed/`**

Ordered, idempotent modules. No committed default passwords: seed passwords come
from the environment or are randomly generated and printed once, and re-runs
report "already existed — password unchanged" rather than printing passwords
that were never applied. All sample serials are synthetic (`SN-DEMO-*`).

**Application skeleton**

- `src/lib/env.ts` — Zod-validated environment, fails fast at startup.
- `src/server/db/prisma.ts` — Prisma 7 client with the `pg` driver adapter and a
  dev-mode singleton; exports the `Db` type services accept.
- `src/server/services/numbering.service.ts` — gap-free, transaction-safe
  reference numbers.
- `src/app/api/health/route.ts` — probe used by the Docker HEALTHCHECK.
- `next.config.ts` — `output: 'standalone'`, security headers, pinned
  Turbopack root.

**Infrastructure and tooling**

- `docker-compose.yml` — Postgres 16 + optional app profile, named volume for
  uploaded evidence.
- `docker/Dockerfile` — three-stage, non-root, healthcheck, standalone output.
- `scripts/db/wsl-postgres-setup.sh` — local Postgres without Docker.
- `scripts/db/verify-constraints.sql` — the 18-test integrity suite.

---

## Decisions taken during Phase 1

| Decision | Reason |
|---|---|
| Node 24.19.0 LTS installed (your choice) | Prisma 7 refuses to install on Node 23 |
| PostgreSQL 16 installed in WSL (your choice) | No Docker on this machine; the migration needed a real database to be trusted |
| Prisma pinned to **7.10.0** | npm's `latest` tag currently points at `8.0.0-rc.12`, a release candidate |
| Prisma driver adapter (`@prisma/adapter-pg`) | Required by Prisma 7 — the client no longer takes a URL |
| `TIMESTAMPTZ` everywhere | Prisma's default loses the time zone; also required for `tstzrange` in the overlap constraint |
| GIN indexes declared in schema *and* migration | Prisma flags undeclared plain indexes as drift and would generate a migration to drop them |
| bcrypt cost 12, not Argon2id | Argon2 needs a native build; bcryptjs is pure JS and portable to Alpine |
| npm install scripts approved for 4 packages | npm 11 blocks postinstall by default; Prisma's engine download needs it |

---

## Open questions blocking later phases

Full detail in ARCHITECTURE.md §7. These two need answers before the phase named:

- **R-1 — how does an external editor sign?** (blocks Phase 8.) Assumed: the
  editor signs in person on the engineer's tablet. The alternative — remote
  counter-signing — needs accounts for freelancers and an extra booking state.
- **R-7 — is maintenance tracking in scope?** (blocks Phase 4.) There is no
  `MaintenanceRecord` entity. `AssetStatusLog` records *that* an asset went into
  maintenance, not what was done, by whom, or the cost. Cheap now, expensive to
  retrofit.

Lower priority, assumptions documented and safe to correct later: R-3 (overdue
scheduler), R-4 (what "required checks complete" means), R-5 (timezone), R-6
(concurrent inspection edits), R-8 (signature retention).

**Housekeeping:** Git is not installed, so nothing is committed yet.
`winget install Git.Git`, then `git init && git add -A && git commit` before
Phase 2 starts — the `.gitignore` is already correct (`.env` excluded,
`.env.example` included, `storage/` excluded).

---

## Next: Phase 2 — Authentication and RBAC

1. Auth.js v5 credentials provider, bcrypt verification, account lockout.
2. `sessionVersion` revocation check in the `jwt` callback.
3. `proxy.ts` (Next.js 16 renamed `middleware.ts`) for optimistic redirects and
   the CSP nonce.
4. Permission matrix — one source of truth for ADMIN / ENGINEER / EDITOR / VIEWER.
5. `requireSession()`, `requirePermission()`, and the `action()` wrapper that
   makes an unauthorised Server Action impossible to write by omission.
6. `/login`, sign-out, idle timeout.

**Phase 2 is done when** each seeded role signs in and is correctly refused
access to routes it should not reach — verified by pasting URLs directly *and*
by invoking a Server Action from the browser console, not just by observing
which buttons render.
