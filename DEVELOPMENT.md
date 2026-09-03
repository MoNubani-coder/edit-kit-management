# DEVELOPMENT.md

Running log of what exists, what to test, and what comes next.

- **Current phase:** 2 of 13 — Authentication and RBAC — ✅ **complete**
- **Status:** verified against PostgreSQL 16.15 — three migrations applied, zero
  drift, 30/30 database constraint tests, 86/86 Vitest tests (auth,
  RBAC, routes), HTTP smoke test of the built app, typecheck + lint clean,
  production build clean
- **Last updated:** 2026-09-03 (Phase 2)

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
npm run dev            # http://localhost:3000 -> /login
npm run db:studio      # browse data
npm run check          # tsc + eslint
npm test               # vitest: unit + database integration suites
```

Sign in with one of the seeded accounts (see *Signing in locally* below).

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

Set `SEED_ADMIN_PASSWORD`, `SEED_ENGINEER_PASSWORD`, `SEED_EDITOR_PASSWORD` and
`SEED_VIEWER_PASSWORD` (12+ characters each) if you want to choose the local
passwords; leave them empty and the seed generates strong ones and prints them
once.

### 3. Migrate and seed

```powershell
npm run db:migrate     # applies all three migrations
npm run db:seed        # idempotent - safe to re-run
npm run dev
```

The seed prints the sign-in accounts. If `SEED_*_PASSWORD` is not set in `.env`
it generates strong random passwords and prints them **once**. Re-running the
seed never rotates an existing password and says so explicitly; to reset
passwords set the env vars and run `npm run db:reset`.

---

## Signing in locally

The seed creates four local accounts, one per role:

| Role | Email | Editor profile |
|---|---|---|
| ADMIN | `admin@example.ae` | — |
| ENGINEER | `engineer@example.ae` | (engineer profile) |
| EDITOR | `editor@example.ae` | yes — an *internal* editor with a login |
| VIEWER | `viewer@example.ae` | — |

Plus two external editor profiles (`EXT-5001`, `EXT-5002`) with **no** account,
which is the case the schema was designed around.

Passwords come from `SEED_*_PASSWORD` in `.env`; when a variable is empty the
seed generates a random password and prints it **once**. The seed never
re-prints or rotates an existing password. To recover or change one without
re-seeding:

```powershell
npm run auth:reset-password -- viewer@example.ae            # generates and prints a new one
npm run auth:reset-password -- viewer@example.ae "a-long-passphrase-of-your-own"
```

The reset clears any lockout, bumps `sessionVersion` (signing that user out
everywhere) and writes a `PASSWORD_CHANGED` audit row. It refuses to run with
`NODE_ENV=production` unless `RESET_PASSWORD_ALLOW_PRODUCTION=true`.

Five wrong passwords lock an account for 15 minutes (`MAX_LOGIN_ATTEMPTS`,
`LOGIN_LOCKOUT_MINUTES`). The correct password during the lock is told so; a
wrong one is told nothing. Never put real credentials in any committed file.

---

## Phase 2 — Authentication and RBAC (complete)

Design and rationale: [docs/ARCHITECTURE.md §11](docs/ARCHITECTURE.md), AD-2,
AD-3, AD-7, AD-11, AD-12.

**What exists**

- `src/server/auth/` — the auth facade: Auth.js v5 config split into a
  proxy-safe part (`auth.config.ts`) and the full instance with the Credentials
  provider and the database revocation check (`auth.ts`); `credentials.ts`
  (verification, lockout, audit, anti-enumeration); `password.ts` (bcrypt 12);
  `permissions.ts` (the matrix, `can()`); `session.ts` (`getCurrentUser`,
  `requireAuth`, `requirePermission`, `requireRole`, `requireAdmin`);
  `page-guards.ts`; `api.ts` (`withApiAuth`); `action.ts` (`action()`);
  `route-policy.ts`; `rate-limit.ts`; `errors.ts`.
- `src/proxy.ts` — optimistic gate + CSP nonce. `next.config.ts` enables
  `experimental.authInterrupts` for `forbidden()` / `unauthorized()`.
- `src/server/actions/auth.actions.ts` (`signInAction`, `signOutAction`) and
  `admin-users.actions.ts` (`setUserStatus`, the first `action()`-wrapped
  mutation - suspends/disables/reactivates and revokes sessions).
- `src/server/dal/bookings.dal.ts` — actor-scoped reads (EDITOR = own only).
- `src/app/(auth)/login` + `src/features/auth/components/login-form.tsx`;
  `src/app/(app)/` shell layout with permission-filtered navigation
  (`components/layout/app-shell.tsx`, `lib/constants/navigation.ts`);
  placeholder pages for every section, each behind its real permission check;
  `/bookings` lists through the scoped DAL; `forbidden.tsx`, `unauthorized.tsx`,
  `not-found.tsx`; `/api/me` (reference protected route handler).
- `prisma/seed/01-users.ts` — VIEWER account added; hashing through
  `server/auth/password.ts`. `scripts/auth/reset-password.ts`.
- `tests/` — Vitest suites (see below); `vitest.config.mts`.

**Verification — Phase 2 (2026-09-03)**

| Check | Result |
|---|---|
| `prisma migrate status` | ✅ 3 migrations, database up to date — **no schema change was needed**; `User` already had `passwordHash`, `status`, `sessionVersion`, `failedLoginAttempts`, `lockedUntil`, `lastLoginAt` |
| `prisma migrate diff --exit-code` | ✅ No difference detected |
| `scripts/db/verify-constraints.sql` | ✅ 30 / 30 PASS |
| `npm test` (11 files) | ✅ **86 / 86** |
| `npm run check` | ✅ clean |
| `npm run build` | ✅ clean — 19 routes + proxy |
| `npm run db:seed` × 2 | ✅ run 1 created the VIEWER account; run 2 created nothing, printed no password |
| HTTP smoke test (`next start`, curl) | ✅ see below |

Smoke test against the production build (`next start -p 3100`):
`/login` 200 · `/dashboard` anonymous → 307 `/login?callbackUrl=%2Fdashboard` ·
`/admin/users` anonymous → 307 login · `/api/me` anonymous → 401 JSON · `/` → `/login` ·
CSP header with nonce present and the same nonce on the page's scripts ·
wrong password and unknown email → identical `code=invalid_credentials` ·
VIEWER sign-in → `httpOnly` `authjs.session-token` · `/api/me` → 200 with the
VIEWER identity and its five read permissions · `/dashboard` 200 ·
`/bookings` 200 · `/issues` → **403** (VIEWER lacks `issue.read`; page guard) ·
`/admin/users` → **403** (proxy) · `/login` while signed in → 307 `/dashboard` ·
`/nope` → 404 · navigation rendered only Dashboard, Bookings, Kits, Equipment,
Reports · sign-out → session gone, `/api/me` → 401.

**What the 86 tests prove** (`npm test`; needs the local database, leaves it
as found - credentials tests run in rolled-back transactions, the others delete
their `test-*@example.test` rows):

*Authentication* — valid credentials succeed and return exactly the identity the
session is built from · wrong password fails, is counted and audited · unknown
email fails with the same answer · DISABLED / SUSPENDED / INVITED cannot sign in
even with the right password, and a wrong password on a disabled account is
still just "invalid" · lockout after 5 failures, reported only to the correct
password, lifted after the window · SSO-only accounts (no hash) are refused ·
every stored hash is bcrypt cost 12 and never the plaintext · decoy comparison
runs when there is no hash · the `jwt` callback copies role/version at sign-in,
strips the avatar, and kills tokens past the 8 h absolute lifetime · the session
callback exposes exactly id, name, email, role · `revalidateToken` ends sessions
on suspend or version bump.

*RBAC* — ADMIN holds every permission · ENGINEER holds the operational set and
none of `admin.*`, `kit.manage`, `asset.manage`, `editor.manage`,
`maintenance.manage` · VIEWER holds only read permissions · EDITOR holds
`booking.readOwn` but not `booking.read` · unknown roles hold nothing ·
`getCurrentUser` resolves the actor from the database, returns null for
disabled accounts, and takes the role from the row, not the session ·
`requireAuth` → UnauthorizedError; `requirePermission` → ForbiddenError for a
signed-in ENGINEER on `admin.users.manage` · the real `setUserStatus` action
returns `unauthorized` anonymously, `forbidden` for ENGINEER (also with a
forged ADMIN role in the session), `validation` for bad input, succeeds for
ADMIN (status changed, `sessionVersion` bumped, audit written), refuses
self-change · EDITOR lists only own bookings, reads own, gets "not found" for
another editor's, sees nothing without a profile; ENGINEER and VIEWER see all.

*Routes* (proxy driven with real encrypted cookies) — `/login`, `/api/health`,
`/api/auth/*` public · `/dashboard` and `/bookings?tab=…` anonymous → 307
`/login` with `callbackUrl` · valid cookie passes and receives the nonce ·
signed-in on `/login` → `/dashboard` · `/` dispatches · expired
(`authenticatedAt` 9 h ago) and tampered cookies are anonymous · `/api/me`
anonymous → 401 JSON, signed-in → pass · `/admin/users` → 403 rewrite for
ENGINEER, VIEWER, EDITOR; pass for ADMIN; login redirect when anonymous ·
matcher skips static assets and prefetches.

**Decisions taken in Phase 2**

| Decision | Reason |
|---|---|
| Auth.js `5.0.0-beta.32` | The only Auth.js line for the App Router; declares Next 16 support; contained behind the facade (AD-3, R-9) |
| bcrypt cost 12 via `bcryptjs`, not Argon2id | No native build; one hashing function shared by seed, reset script and login |
| Revocation check in the `jwt` callback of the *full* instance, not the proxy's | The proxy must stay database-free; the callback runs for every `auth()` in pages, actions and handlers |
| Absolute 8 h lifetime via `authenticatedAt` in the token | Auth.js's sliding `maxAge` alone never expires an active session |
| Rate limiter inside `authorize()` | Auth.js exposes `/api/auth/callback/credentials` directly; the form action alone would be bypassable |
| Unknown client address is not rate-limit keyed | A shared "unknown" bucket would let one attacker lock out everyone behind a misconfigured proxy |
| Disabled/locked messages only after a correct password | Anything else lets an attacker enumerate accounts (AD-12) |
| Object-level misses are "not found", not 403 | Guessing a booking id must not confirm it exists |
| CSP: nonce + `strict-dynamic` for scripts, `'unsafe-inline'` for styles | Attributes cannot carry a nonce and React sets `style=`; script injection is the real risk |
| Proxy answers JSON 401/403 on `/api/*` | Redirecting a fetch() to an HTML login page is wrong for callers and hides the status |
| `setUserStatus` built now, UI later | The one admin mutation that belongs to auth (immediate revocation); it also gives the tests a real protected mutation |
| ENGINEER gets `booking.cancel`, not `editor.manage` | Cancelling a reservation is routine store work; creating editor profiles is deferred to a Phase 6 decision |

**Manual browser checks worth doing** (the suite cannot drive a browser):

- [ ] Sign in as each seeded role; confirm the sidebar shows only permitted
  entries and the role badge is right.
- [ ] Paste `/admin/users` as VIEWER → in-shell 403 page; as ADMIN → placeholder.
- [ ] Wrong password 5× as one account → the 6th *correct* attempt says locked;
  wait 15 minutes (or reset) and sign in.
- [ ] Open the app in two tabs; suspend the user from `psql` or bump
  `sessionVersion` → the next click in either tab lands on `/login`.
- [ ] Browser devtools: no CSP violations in the console on `/login` and
  `/dashboard`; the session cookie is `HttpOnly`, `SameSite=Lax`.
- [ ] Password visibility toggle, disabled button + spinner while submitting,
  field errors on empty submit, `/login?callbackUrl=/kits` returns to `/kits`.
- [ ] Sign out from the header; back button does not restore a signed-in page.

---

## Verification results — 2026-09-03 (Phase 1)

Everything below was actually run against the WSL database, not inferred.

**Initial Phase 1 verification**

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

**Maintenance refinement** (same day, after adding `MaintenanceRecord`)

| Check | Result |
|---|---|
| `prisma migrate deploy` — `20260903000200_maintenance_records` | ✅ applied cleanly on top of the two existing migrations, which were not touched |
| `prisma migrate status` | ✅ 3 migrations found, "Database schema is up to date!" |
| `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` | ✅ "No difference detected", exit code 0 |
| `prisma db seed` × 2 | ✅ run 1 created `MNT-2026-000001`; run 2 created 0 rows and the `MAINTENANCE` counter stayed at 1 |
| `scripts/db/verify-constraints.sql` (run twice) | ✅ **30 / 30 PASS**, database rolled back both times |
| `npm run check` (tsc + eslint) | ✅ clean |
| `npm run build` (Turbopack, standalone) | ✅ clean |

**What the 30 constraint tests prove** (`scripts/db/verify-constraints.sql`,
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
8. Numbering upsert increments 1 → 2 atomically; **8b.** the new `MAINTENANCE` scope does the same
9. Seed sanity: 12 assets in MBP-02, 2 external editors with no login, no real-looking serials, `AST-` codes contiguous; **9e.** every maintenance number matches `MNT-YYYY-NNNNNN`; **9f.** the seeded calibration is `SCHEDULED` and its asset is still `AVAILABLE`
10. Maintenance (10a–10i): completed-before-started → rejected · `COMPLETED` without `completedAt` → rejected · `IN_PROGRESS` without `startedAt` → rejected · negative cost → rejected · lower-case currency → rejected · second `IN_PROGRESS` record on one asset → rejected, **while a further `SCHEDULED` one is allowed** · hard-deleting an asset with maintenance history → rejected · deleting a linked issue → `issueId` nulled, record retained

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

31 models, 23 enums. Highlights:

- `EditorProfile.userId` is **nullable** so external editors with no login can
  still appear on bookings and sign handovers.
- `Inspection` rows are per-phase; the return never overwrites the handover.
- Every inspection line carries `*Snapshot` columns, so editing an asset cannot
  rewrite a signed document.
- `BookingChecklistItem` (the snapshot) is split from `ChecklistResult` (the
  per-inspection answer) — see ARCHITECTURE.md §3.5.
- `AccessoryType` added so accessory naming is admin-managed, not free text.
- `MaintenanceRecord` (resolves R-7) with `MaintenanceType` and
  `MaintenanceStatus`, linked to `Asset` (required, `Restrict`) and `Issue`
  (optional, `SetNull`), numbered `MNT-YYYY-NNNNNN` from the shared counter.
  Three `AuditAction` values (`MAINTENANCE_CREATED` / `_UPDATED` /
  `_STATUS_CHANGED`) are ready for Phase 4.
- All 86 `DateTime` columns are `TIMESTAMPTZ(3)`, not Prisma's default
  `TIMESTAMP` without time zone.
- 12 trigram GIN indexes declared for global search.

**Migrations — `prisma/migrations/`**

- `20260903000000_init` — generated from the schema.
- `20260903000100_integrity_constraints_and_search_indexes` — hand-written:
  exclusion constraint against double-booking, two CHECK constraints, three
  partial unique indexes, three immutability triggers, trigram indexes, partial
  dashboard indexes.
- `20260903000200_maintenance_records` — generated DDL for the table, enums,
  `NumberScope.MAINTENANCE` and the audit actions, followed by hand-written
  rules: four CHECK constraints (dates ordered, status ⇔ timestamps, cost ≥ 0,
  ISO 4217 currency), a partial unique index (one active record per asset) and
  a partial dashboard index over open records.

**Seed — `prisma/seed/`**

Ordered, idempotent modules. No committed default passwords: seed passwords come
from the environment or are randomly generated and printed once, and re-runs
report "already existed — password unchanged" rather than printing passwords
that were never applied. All sample serials are synthetic (`SN-DEMO-*`).
`06-maintenance.ts` seeds one `SCHEDULED` calibration on the broadcast
monitor, matched on asset + type + title on re-runs so no `MNT-` number is
ever burned; two `maintenance.*` settings join the `AppSetting` seed.

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
- `scripts/db/verify-constraints.sql` — the 30-test integrity suite.

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
| `MaintenanceRecord` added in Phase 1 (R-7) | Retrofitting after Phase 4 would mean migrating asset history; a table now is cheap |
| Maintenance ↔ asset status coupling is a service rule, not a trigger | Whether to restore `AVAILABLE` on completion depends on open issues, which a trigger cannot weigh |
| One *active* maintenance record per asset (partial unique index) | An asset is physically in one workshop; several future `SCHEDULED` jobs remain allowed |
| Maintenance migration = generated DDL + hand-written rules in one file | Keeps the table and the rules that protect it atomic; applied migrations are never edited |

---

## Open questions blocking later phases

Full detail in ARCHITECTURE.md §7. One still needs an answer before the phase
named; the other is now resolved:

- **R-1 — how does an external editor sign?** (blocks Phase 8.) Assumed: the
  editor signs in person on the engineer's tablet. The alternative — remote
  counter-signing — needs accounts for freelancers and an extra booking state.
- **R-7 — is maintenance tracking in scope?** ✅ **Resolved** in the maintenance
  refinement: `MaintenanceRecord` exists with its enums, numbering scope,
  constraints, seed and tests (ARCHITECTURE.md §3.6 and §4.7). Phase 4 builds
  the UI on top of it; nothing needs retrofitting.

Lower priority, assumptions documented and safe to correct later: R-3 (overdue
scheduler), R-4 (what "required checks complete" means), R-5 (timezone), R-6
(concurrent inspection edits), R-8 (signature retention).

**Housekeeping:** Git is installed and Phase 1 is committed (`a9131e7`). The
maintenance refinement and Phase 2 are in the working tree awaiting review and
commit. `.gitignore` excludes `.env` and `storage/`; `.env.example` is tracked.

---

## Next: Phase 3 — Application shell and dashboard

Phase 2 already delivers a working shell (sidebar, header, role badge,
sign-out, permission-filtered navigation). Phase 3 replaces the hand-written
primitives with shadcn/ui, adds the shared components (`DataTable`,
`StatusBadge`, `PageHeader`, `EmptyState`, `ConfirmDialog`, `Stepper`), the
live dashboard tiles and activity panels, breadcrumbs, and the tablet layout
pass (768–1024 px).

**Open decisions for Phase 3**

- Where the user-management screen lands (it is under Administration in the
  navigation; `setUserStatus` exists, password reset and role change do not).
- Whether the dashboard is role-specific (an EDITOR's dashboard is only their
  bookings) or one layout with tiles hidden by permission.
- Rate-limit store for multi-instance deployment, if the deployment target is
  more than one container.
- R-1 still needs an answer before Phase 8.
