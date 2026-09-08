# DEVELOPMENT.md

Running log of what exists, what to test, and what comes next.

- **Current phase:** 13 of 13 — Testing and deployment — ✅ **complete**
- **Status:** verified against PostgreSQL 16.15 — six migrations applied (none
  new in Phases 8–13), zero drift, the database's constraints now proved by the
  test suite itself, 671/671 Vitest tests (two consecutive runs, database,
  filesystem and numbering counters unchanged), 16/16 Playwright specs on a
  dedicated E2E database, typecheck + lint clean, production build clean
- **Last updated:** 2026-09-07 (Phase 13)
- **The roadmap is complete.** What remains is listed under "Open decisions
  carried forward" at the end of this file.

### Fix: the /login ↔ /dashboard redirect loop

Signing in could end in ERR_TOO_MANY_REDIRECTS. The request gate reads only the
session cookie, so a cookie the database rejects looked signed in there and was
redirected from `/login` to `/dashboard`, while the page resolved the same
cookie against the database and redirected back to `/login`. Two conditions
triggered it: a revoked `sessionVersion` (the command-line password reset bumps
it), and an unreachable database, which the session read treated as a
sign-out.

The gate no longer redirects a cookie holder away from `/login`; the login page
is the authority, using the same database-backed path the protected pages use.
A session read now answers signed in, anonymous or unresolved, and only a
definitive answer ends a session or clears a cookie. An outage gives a bounded
error page, JSON 503 or a retryable action failure, and leaves the session
alone. Design in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) AD-21; regression
cover in `tests/integration/auth-redirect-loop.test.ts` (19) and
`tests/integration/auth-outage.test.ts` (7).

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
npm run db:migrate     # applies all six migrations
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
1c. Adjacent booking starting the instant the previous one ends → allowed (half-open window, Phase 7)
1d. Zero-length booking (start = end) → rejected
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

Full detail in ARCHITECTURE.md §7. Both are resolved:

- **R-1 — how does an external editor sign?** ✅ **Resolved:** external editors
  sign in person on the authenticated engineer's tablet or device during
  handover and return. No external `User` account is required. Phase 8 builds
  exactly that flow.
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

## Phase 3 — Dashboard and login redesign (complete)

Design and rationale: [docs/ARCHITECTURE.md §12](docs/ARCHITECTURE.md), AD-13
(business time zone), AD-14 (the dashboard derives, never stores).

**What exists**

- `src/lib/datetime.ts` — business-time helpers on `Intl` only:
  `businessDayRange`, `startOfBusinessDay`, `isSameBusinessDay`,
  `formatDate` (`03 Sep 2026`), `formatTime` (`14:30`), `formatDateTime`,
  `formatRelative`, `humanDuration`, `describeDue`. Default zone `Asia/Dubai`
  (`APP_TIMEZONE`).
- `src/server/dal/dashboard.dal.ts` — one indexed query per figure with
  explicit selects and limits; booking reads take `visibilityFor(actor)`.
- `src/server/services/dashboard.service.ts` — `buildDashboard(db, actor, {
  now, timeZone })` gates every section with `can()` / `canAny()` and runs the
  permitted queries concurrently; `loadDashboard()` = `requirePermission` +
  build; `quickActionsFor(actor)` links only to routes that exist.
- `src/features/dashboard/components/` — `DashboardView` (renders non-null
  sections), `KpiCard`, `SectionCard`, `BookingsTable` (today / upcoming /
  overdue / history variants), `IssuesTable`, `ActivityFeed`, `QuickActions`,
  `EditorDashboard`. Shared `StatusBadge` (booking, issue, severity tones) and
  `EmptyState` under `src/components/common/`.
- `src/app/(app)/dashboard/page.tsx` (`force-dynamic`) and `loading.tsx`
  (skeleton). The permission-debug list is gone.
- Login redesign: `src/app/(auth)/layout.tsx` (dark branded panel + card
  column, stacked below `lg`) and `src/app/(auth)/login/page.tsx` (card with
  EK mark, "Sign in", footer "Internal use only · Access is logged").
  `login-form.tsx` and all sign-in behaviour are unchanged.
- Theme: `src/components/theme/theme-provider.tsx` (next-themes, class on
  `<html>`, `localStorage` key `ekms-theme`, CSP nonce passed to the anti-flash
  script) and `src/components/theme/pull-cord-theme-toggle.tsx` (the pull-cord
  switch: Pointer Events drag with 40 px clamp / 24 px threshold, tap, Enter and
  Space, `aria-label` per state, reduced-motion aware). Tokens for both modes
  in `src/app/globals.css`; root layout adds Manrope and
  `suppressHydrationWarning`. See ARCHITECTURE.md AD-15 and §12.7.
- Visual redesign (ARCHITECTURE.md §12.8): tokenised `Button`, `Badge` (dot
  variant), `Input`, `Label`, `Alert`, `EmptyState`, `PageHeader` (eyebrow),
  `StatusPage`; `AppShell` rebuilt as a top-navigation command bar (no
  sidebar): brand, horizontal primary navigation with teal underline,
  *Administration* dropdown, date, role chip, compact pull-cord and account
  menu with sign-out; below `lg` a menu button opens a navigation panel.
  `PageHeader` is the workspace header (breadcrumb eyebrow, title, actions,
  optional `SectionTabs`); `SectionTabs` gives Kits and Equipment status tabs
  and Administration section tabs (`features/admin/components/admin-tabs.tsx`).
  Dashboard: "Operations status" board (`StatStrip` with two rows of three),
  `SectionCard` with tinted header and count chip, table restyle, timeline
  activity feed, shortcut chips. Bookings: search and quick filters
  (`listBookingsForActor` options, still scoped by `visibilityFor`) above a
  wide list. Login frame and card restyled to the same tokens. `src/lib/constants/branding.ts` holds the
  tagline and brand highlights.
- Tests: `tests/unit/datetime.test.ts`, `tests/integration/dashboard.test.ts`,
  `tests/component/pull-cord-theme-toggle.test.tsx` (jsdom + Testing Library).

**Verification — Phase 3 (2026-09-03)**

| Check | Result |
|---|---|
| `npm test` (14 files) | ✅ **114 / 114** |
| `scripts/db/verify-constraints.sql` | ✅ 30 / 30 PASS |
| `prisma migrate status` | ✅ 3 migrations, up to date — **no schema or index change was needed** (§12.4) |
| `prisma migrate diff --exit-code` | ✅ No difference detected |
| `npm run check` | ✅ clean |
| `npm run build` | ✅ clean |
| HTTP smoke test (`next start`, curl) | ✅ login page shows brand, "Sign in", footer, nonce on scripts, no environment/permission text; ADMIN dashboard renders all six tiles, quick actions, today / upcoming / issues / activity with sign-in events; VIEWER renders tiles without issues or quick actions; EDITOR renders current booking / upcoming return / history only; no permission strings anywhere |

**What the dashboard tests prove** (`tests/integration/dashboard.test.ts`,
rolled back, fixed `now` = 21:00 UTC 3 Sep = 01:00 Dubai 4 Sep):

1. unauthenticated `loadDashboard()` → UnauthorizedError
2. ADMIN: +2 available, +1 reserved, +3 checked out, +1 maintenance kits
   (inactive and retired kits excluded), +2 assets in maintenance, +2 active
   maintenance records, +3 open issues, +2 overdue (one by time, one flagged)
3. ENGINEER: all operational sections, no sign-in events in the feed
4. VIEWER: tiles and bookings, no issues, no maintenance-record hint, no quick
   actions, no sign-in events
5. EDITOR: only own bookings in history, other editor's absent, current booking
   is the earliest live one; editor without a profile gets empty sections
6–10. counts above, each against a delta measured in the same transaction
11. 00:30 Dubai collection is "today", 23:30 Dubai the night before is not,
    cancelled and tomorrow excluded — and the same instant on a UTC calendar
    gives the wrong answer
12. upcoming returns ascend by expected return and exclude overdue
13. activity capped at 10, newest first, auth events first for admins
14. far-future `now` yields empty lists, not errors
15. serialised dashboard contains no passwordHash / payload / IP / user-agent /
    email; activity rows carry exactly action, actorName, createdAt, entityId,
    entityType, id, summary

**Decisions taken in Phase 3**

| Decision | Reason |
|---|---|
| Kit / asset tiles read stored status; overdue is derived (AD-14) | The workflows own kit and asset status; overdue was always meant to be computed at read time (R-3) |
| `booking.overdueGraceHours` not applied on the dashboard | A kit an hour late should be visible to the engineer now; grace governs the sweep and notifications |
| "Today" = collections starting today or returns due today, CANCELLED excluded | What the store needs each morning; a kit out all week is not "today's" |
| Editor's "current booking" = earliest live booking | The most urgent thing to show; a stale OVERDUE booking must not hide behind a future reservation |
| Auth events in the feed only for `admin.audit.read` | Sign-ins are security telemetry; the operational feed for engineers stays operational |
| Quick actions link to list pages only | No booking or issue creation form exists yet; a button to nowhere is worse than none |
| `Intl`-based date helper, no library | One dependency fewer; output identical across hosts; Dubai has no DST but the helper handles zones that do |
| Dashboard page is `force-dynamic` | Live counts must never be prerendered or cached |
| shadcn/ui, DataTable, ConfirmDialog, Stepper, breadcrumbs deferred | Nothing in Phase 3 needed them; adopt them with the first CRUD screens in Phase 4 rather than restyle twice |
| `next-themes` with `attribute="class"`, default `system` | Persistence, OS preference and the anti-flash script for free; the script takes the CSP nonce, so the strict policy is untouched |
| Colours as CSS tokens, not per-component `dark:` sprinkles | One place to tune both modes; components stay palette-free |
| Theme state in `localStorage`, not the database | It must survive sign-out and apply on the login page, where there is no user |
| Pull-cord gesture state in refs; keyboard via native click only | Pointer events can outrun a render; two activation paths would double-toggle |
| Manrope for display, Inter for body; one teal accent | Distinct voice without hurting dense-table legibility; one accent keeps the navy identity calm |
| Instrument strip instead of six KPI boxes | Changes the dashboard's rhythm - the strongest single differentiator from a stock admin template |

**Manual browser checks worth doing**

- [ ] `/login` at 1366×768, tablet portrait and a narrow window: split layout
  above `lg`, stacked brand header below; focus rings on inputs and buttons;
  password show/hide; empty submit shows field errors; wrong password shows the
  generic message; spinner while submitting.
- [ ] `/login?callbackUrl=/kits` → lands on `/kits`; sign-out from the header
  returns to `/login`.
- [ ] Dashboard as ADMIN, ENGINEER, VIEWER, EDITOR: tiles and sections match
  §12.2; no permission strings anywhere; dates read `03 Sep 2026` / `14:30`.
- [ ] Insert a CHECKED_OUT booking with `expectedReturnDate` in the past (psql)
  and confirm the Overdue tile, the amber section and the "Overdue by" column.
- [ ] Devtools: no CSP violations on `/login` or `/dashboard`; the loading
  skeleton appears on a throttled connection.
- [ ] Theme: pull the cord with the mouse past ~24 px → light mode, bulb lit;
  pull again → dark; touch-drag on a tablet; tap the bulb without dragging;
  Tab to it and press Enter, then Space; refresh keeps the choice; sign out and
  back in keeps it; `/login` and the app agree; no hydration warning in the
  console; with "reduce motion" enabled the switch still works without the
  spring-back.
- [ ] Redesign: command bar, Administration dropdown, account menu, workspace
  headers with tabs, the operations board, panels and the login card read as
  one product at 1366×768 (full horizontal navigation), on a tablet and in a
  narrow window (menu button panel), in both modes; no sidebar anywhere.
- [ ] Bookings: search a booking number or editor, click each filter chip, and
  clear filters from the empty state.

---

## Phase 4 — Equipment / asset management (complete)

Design and rationale: [docs/ARCHITECTURE.md §13](docs/ARCHITECTURE.md) and
AD-16. User-facing name: **Equipment**. Routes: `/assets`, `/assets/new`,
`/assets/[id]` (tabs: Accessories, Maintenance, Issues, History),
`/assets/[id]/edit`, `/admin/categories`.

**What exists**

- `src/lib/validation/assets.ts` — Zod schemas for equipment, accessories and
  categories (shared by forms and actions) and the tolerant list-parameter
  parser (`q`, `category`, `view`, `assignment`, `sort`, `dir`, `page`,
  `pageSize`).
- `src/server/dal/assets.dal.ts` — paginated list with search / filters /
  sort, status counts, exact-barcode lookup, detail, lifecycle context, unified
  history. `src/server/dal/catalogue.dal.ts` — categories (with equipment
  counts) and accessory types.
- `src/server/services/assets.service.ts` — `allowedStatusTransitions`,
  `assertStatusTransition`, `removalBlocker`, `isAvailableForUse`;
  `createAsset` (AST number inside the transaction), `updateAsset` (status log
  + audit), `removeAsset` (soft), `addAccessory` / `updateAccessory` /
  `removeAccessory`; page loaders. `categories.service.ts` — create, update,
  activate / deactivate. `errors.ts` — `DomainError` and the P2002 → field
  mapping; the `action()` wrapper returns DomainErrors as `rejected` results.
- `src/server/actions/assets.actions.ts`, `accessories.actions.ts`,
  `categories.actions.ts` — form-action wrappers around `action()`.
- `src/features/assets/` — toolbar (GET form; the search box is the barcode
  scan target), sortable paginated table, create / edit form (status choices =
  allowed transitions, reason on change), summary panels, accessories panel
  with inline add / edit (URL-driven) and remove, maintenance and issue panels,
  history timeline. `src/features/admin/components/` — category form and
  activate / deactivate toggle. New primitives: `Select`, `Textarea`,
  `FormField`, `Pagination`, `ConfirmSubmitButton`; `AssetStatusBadge`,
  `MaintenanceStatusBadge`.
- Tests: `tests/integration/assets.service.test.ts` (each test in
  `withRollback`) and `tests/integration/assets.actions.test.ts` (the real
  Server Actions; the whole file runs inside one PostgreSQL transaction that
  `afterAll` rolls back — `@/server/db/prisma` is mocked with a proxy onto the
  transaction client, so the real numbering service, audit writes and rows all
  disappear with it). `npm test` therefore leaves the development database and
  the `ASSET` counter exactly as found; the suite asserts this itself after the
  rollback (counter unchanged, no asset, no test users).

**Verification — Phase 4 (2026-09-05)**

| Check | Result |
|---|---|
| `npm test` (16 files) | ✅ **138 / 138** |
| `scripts/db/verify-constraints.sql` | ✅ 30 / 30 PASS |
| `prisma migrate status` | ✅ 3 migrations, up to date — no schema change needed |
| `prisma migrate diff --exit-code` | ✅ No difference detected |
| `npm run check` | ✅ clean |
| `npm run build` | ✅ clean |
| HTTP smoke test (`next start`) | ✅ list, tabs, filters, pagination, barcode redirect, detail tabs, new / edit forms, categories admin; VIEWER cannot reach `/assets/new` (403) |

**Decisions taken in Phase 4**

| Decision | Reason |
|---|---|
| Workflow statuses (RESERVED, CHECKED_OUT, MAINTENANCE) cannot be edited by hand | They mean "a booking / an inspection / a maintenance record owns this"; the edit form must not bypass those workflows (AD-16) |
| Active maintenance blocks AVAILABLE and removal | Equipment on the bench is not bookable, whatever its stored status says |
| Kit members cannot be retired or removed | Kit contents are managed in Phase 5; retiring in place would silently break the kit |
| Soft delete only; detail page still opens with a "Removed" banner | Inspections, issues and audit rows point at the asset forever |
| Exact barcode match redirects from the list | The scanner use case: scan, land on the equipment, no extra tap |
| `Name` is required although the brief omitted it | The schema requires it and the handover form prints it |
| Categories deactivate, never delete | Assets reference them; a deactivated category disappears from pickers only |
| Accessories soft-deleted | `AccessoryInspection` rows from past handovers keep their reference |
| Equipment forms are URL-driven (`?accessory=new`, `?category=<id>`) | State survives refresh and needs no client store; Server Components render the form in place |
| shadcn/ui still not adopted | The token-based primitives (`Select`, `Textarea`, `FormField`, `Pagination`) covered every Phase 4 need; revisit when a dialog or command palette is required |

**Manual browser checks worth doing**

- [ ] `/assets` at 1366×768 and tablet: status tabs, filters, sortable
  headers, pagination (set `?pageSize=5`), both themes; `/assets/new` as ADMIN
  creates and lands on the workspace; duplicate serial shows a field error.
- [ ] Type or scan `ADM-DEMO-100009` in the search box → lands on the
  broadcast monitor; `ADM-DEMO-10000` → normal search results.
- [ ] Edit: status choices are limited; changing status asks for a reason and
  the History tab shows it; try to make an asset AVAILABLE while a maintenance
  record is IN_PROGRESS (psql) → refused with the reason.
- [ ] Accessories: add, edit and remove one; the row disappears but the audit
  entry stays in History.
- [ ] `/admin/categories`: create, edit, deactivate; the category leaves the
  equipment form but stays on existing equipment. As ENGINEER the page is 403.

---

## Phase 5 — Kit management (complete)

Kits on the top-navigation shell: the list workspace, the kit workspace with
Overview / Equipment / Software / Checklist / History tabs, create and edit,
and the equipment composition editor with server-side assignment rules and a
single availability calculation. Design in
[docs/ARCHITECTURE.md §14](docs/ARCHITECTURE.md#14-kits-phase-5).

**What exists**

- Migration `20260905134441_kit_audit_actions` - five new `AuditAction` values
  (`KIT_ASSET_ADDED`, `KIT_ASSET_REMOVED`, `KIT_SOFTWARE_ADDED`,
  `KIT_SOFTWARE_REMOVED`, `KIT_CHECKLIST_CHANGED`). Nothing else in the schema
  changed: `KitAsset.isRequired` already existed, so no required / optional
  migration was needed.
- `src/lib/validation/kits.ts` - kit, membership, software, checklist and
  list-parameter schemas; kit-code pattern (`MBP-03`, `WIN-01`, `AUDIO-01`).
- `src/server/dal/kits.dal.ts` - paginated list with search into kit contents,
  status counts, barcode lookup, availability facts, detail (members grouped
  with accessories, software, checklist, live booking), lifecycle context,
  membership lookups, equipment candidate search, history.
  `catalogue.dal.ts` gained software-application and checklist-template
  readers.
- `src/server/services/kits.service.ts` - lifecycle (`allowedKitStatusTransitions`,
  `kitRemovalBlocker`, `kitAcceptsMembersBlocker`, `memberRemovalBlocker`),
  assignment rules (`assetAssignmentBlocker`, `translateKitAssetError`),
  availability (`evaluateKitAvailability`, `getKitAvailability`), and the
  mutations `createKit`, `updateKit`, `removeKit`, `addKitAsset`,
  `updateKitAsset`, `removeKitAsset`, `addKitSoftware`, `removeKitSoftware`,
  `setKitChecklistTemplate`; page loaders.
- `src/server/actions/kits.actions.ts`, `kit-composition.actions.ts` - all
  `kit.manage`, all through `action()`.
- Pages: `/kits`, `/kits/new`, `/kits/[id]` (tabs), `/kits/[id]/edit`.
- `src/features/kits/` - `hrefs.ts`; components: toolbar, table, form,
  availability badge and notice, overview, equipment panel (grouped by
  category, accessories expandable), asset picker (barcode-friendly),
  member / software / checklist forms, history. `src/components/common/timeline.tsx`
  is the shared timeline; `KitStatusBadge` joined `status-badge.tsx`. Phase 4
  kit links now open the kit workspace.
- Tests: `tests/integration/kits.service.test.ts`,
  `tests/integration/kits.actions.test.ts`.

**Verification — Phase 5 (2026-09-05)**

| Check | Result |
|---|---|
| `npm test` run 1 (18 files) | ✅ **174 / 174** |
| `npm test` run 2 (18 files) | ✅ **174 / 174** |
| Database after both runs | ✅ ASSET counter 14 before and after; 1 kit, 12 assets, 0 test kits / assets / users / bookings / maintenance rows; 0 kit audit rows |
| `scripts/db/verify-constraints.sql` | ✅ 30 / 30 PASS, rolled back |
| `prisma migrate status` | ✅ 4 migrations, up to date |
| `prisma migrate diff --exit-code` | ✅ No difference detected |
| `npm run check` | ✅ clean |
| `npm run build` | ✅ clean, all kit routes compiled |

**What the 36 kit tests prove** (`npm test`; every write inside a rolled-back
transaction, so the AST numbers the fixtures consume are returned):

*Rules* — a kit cannot be created twice with one code; RESERVED / CHECKED_OUT
cannot be chosen by hand; RETIRED and removal need an empty, unbooked kit;
only available, maintenance-free, unassigned equipment can join; the same
equipment twice, equipment in another kit (named), checked-out, reserved,
retired, missing, damaged and removed equipment are all refused; a retired kit
and a kit under handover / checkout accept nothing and release nothing;
equipment held by a booking cannot leave its kit; the database settles a race
for one asset and the operator gets a sentence, not a stack trace.

*Availability* — ready when every required member is available; not ready
with the blocking asset, slot and reason identified; optional problems are
warnings; maintenance in progress or on hold blocks even while the asset's
status still reads available; reserved and checked-out kits report their
booking and editor.

*Configuration and history* — software added, refused as duplicate, removed,
all audited; checklist assigned, unchanged assignment is a no-op, cleared,
unknown template refused; history is newest first, membership events appear
once whether or not they were audited, seeded MBP-02 shows twelve additions.

*Authorisation* — anonymous rejected; VIEWER and ENGINEER read; EDITOR 403;
only ADMIN creates, edits, adds equipment, software or a checklist; every
mutation redirects on success and returns a typed result on failure; no read
exposes emails, ids or credentials.

**Decisions taken in Phase 5**

| Decision | Reason |
|---|---|
| Kit codes are typed, not allocated (`MBP-02`, `WIN-01`, `AUDIO-01`) | They are printed on the cases and quoted by name; `NumberScope.KIT` stays unused |
| Kit status is stored; readiness is computed (AD-17) | "Available" as a status says what the operator decided; "Ready" says what the equipment allows - both are shown, neither pretends to be the other |
| Only AVAILABLE equipment with no active maintenance joins a kit | A kit is issued as a working whole; DAMAGED / MISSING items would only make it not ready |
| Contents freeze from `READY_FOR_HANDOVER` through `RETURN_INSPECTION`, not while merely `RESERVED` | The handover document is signed against the contents; a reservation is not |
| Re-adding equipment to the same kit reactivates the composite row | `kit_assets_kitId_assetId_key` allows one row per pair; the audit entries carry every join and leave |
| Kit software rows are hard-deleted | Handover software checks reference the application, not the row; audit keeps the history |
| Kit removal needs an empty kit | Otherwise the assets would stay "in a kit" that no longer exists |
| ENGINEER still has `kit.read` only | Unchanged from the matrix; revisit if engineers are to compose kits |
| No camera scanning | Keyboard scanners submit the GET picker form with Enter |

**Manual browser checks worth doing**

- [ ] `/kits` at 1366×768 and tablet: status tabs with counts, search box,
  the MBP-02 row showing 12 items / 11 required and "Ready"; both themes.
- [ ] Scan or type `ADM-DEMO-KIT-0002` → lands on MBP-02; type `ADM-DEMO-100009`
  → MBP-02 listed through its broadcast monitor.
- [ ] MBP-02 › Equipment: categories in seed order, the laptop stand marked
  Optional, "5 accessories" on the MacBook expands; Software lists Premiere Pro
  and Media Encoder; Checklist shows the Standard Edit Kit Checklist (12).
- [ ] As ADMIN: create `MBP-03` from `/kits/new`, open Equipment › Add
  equipment, scan a barcode of an item in MBP-02 → "is in kit MBP-02. Remove it
  there first."; add a free asset → Ready; mark one required item DAMAGED from
  the equipment workspace → kit shows "Not ready · 1" with the asset named.
- [ ] Edit: status choices exclude Reserved / Checked out; Retired is offered
  only once the kit is empty; the reason appears in History.
- [ ] As VIEWER: no New kit / Edit / Add buttons; as EDITOR: `/kits` is 403.

**Development-database note**

`number_sequences` for `ASSET` reads 14 while the highest code is
`AST-000012`. Two numbers were consumed by test runs before the Phase 4
suites were isolated; the counter is left as is (development only, and
`npm run db:reset` removes it). Production code does not compensate for it.

---

## Phase 6 — Editor management (complete)

The editor directory on the top-navigation shell: internal and external
editors, the editor workspace with Overview / Active bookings / Booking
history / Issues / Activity tabs, create and edit, optional account linking
for internal editors, deactivation instead of deletion, and the picker search
Phase 7 will use. Design in
[docs/ARCHITECTURE.md §15](docs/ARCHITECTURE.md#15-editors-phase-6) and AD-18.

**What exists**

- Migration `20260905143330_editor_audit_actions` - three new `AuditAction`
  values (`EDITOR_STATUS_CHANGED`, `EDITOR_USER_LINKED`,
  `EDITOR_USER_UNLINKED`). Nothing else changed: `EditorProfile.isExternal`
  (type), `userId` (optional unique account link) and `staffId` (unique)
  already existed.
- `src/lib/validation/editors.ts` - profile, activation, link and
  list-parameter schemas; staff-id pattern (`EDT-2210`, `EXT-5001`).
- `src/server/dal/editors.dal.ts` - paginated directory with per-row booking
  figures, tab counts, exact staff-id lookup, picker search, detail, lifecycle
  context, account-link facts and linkable accounts, paginated active /
  history bookings, issues on the editor's bookings, activity.
- `src/server/services/editors.service.ts` - `editorRemovalBlocker`,
  `editorDeactivationBlocker`, `userLinkBlocker`; `createEditor`,
  `updateEditor`, `setEditorActive`, `linkEditorUser`, `unlinkEditorUser`,
  `removeEditor`; loaders and `searchEditorsForPicker`.
- `src/server/actions/editors.actions.ts` - all `editor.manage`, all through
  `action()`. `server/services/errors.ts` now maps `staffId` and `userId`
  unique violations to their fields.
- Pages: `/editors`, `/editors/new`, `/editors/[id]` (tabs), `/editors/[id]/edit`.
- `src/features/editors/` - `hrefs.ts`; components: badges, toolbar, table,
  form, overview (contact / account / bookings panels), account link and
  unlink forms, deactivate / reactivate / remove forms, bookings table, issues
  panel, activity timeline.
- Tests: `tests/integration/editors.service.test.ts`,
  `tests/integration/editors.actions.test.ts`.

**Verification — Phase 6 (2026-09-05)**

| Check | Result |
|---|---|
| `npm test` run 1 (20 files) | ✅ **198 / 198** |
| `npm test` run 2 (20 files) | ✅ **198 / 198** |
| Database after both runs | ✅ ASSET counter 14 and MAINTENANCE counter 1 before and after; 3 editors, 6 users, 0 bookings, 33 audit rows, 0 test editors / users / bookings / editor audit rows |
| `scripts/db/verify-constraints.sql` | ✅ 31 / 31 PASS, rolled back (1c proves the exact adjacent case, 1d the strict period) |
| `prisma migrate status` | ✅ 6 migrations, up to date |
| `prisma migrate diff --exit-code` | ✅ No difference detected |
| `npm run check` | ✅ clean |
| `npm run build` | ✅ clean, all editor routes compiled |

**What the 24 editor tests prove** (`npm test`; every write inside a rolled-back
transaction):

*Model* — an external editor is created with no account; an internal editor
is created without one and linked later, or linked in the same step; an
external editor cannot take an account; a duplicate staff ID is refused by the
database and reported as a field error; input is normalised (upper-case staff
ID, lower-case email) and malformed values are rejected.

*Directory* — search by name, staff ID, contact number and email; an exact
staff ID resolves directly; type and status filters with tab counts;
pagination and sort; booking figures per row without an N+1; no read exposes
credentials, lockout state or internal ids.

*Bookings* — active bookings are exactly the live statuses, soonest first;
history is every booking newest first, paginated; activity is chronological.

*Lifecycle* — a live booking blocks deactivation; an inactive editor leaves
the picker and the active list while its bookings, detail and audit stay
readable; reactivation returns it; an editor with history cannot be removed;
one without is soft-removed and unlinked; a linked editor cannot become
external; edits are diffed and audited once.

*Accounts* — disabled, deleted and unknown accounts are refused; external
editors cannot be linked; one account cannot serve two editors and one editor
cannot hold two accounts; the seeded internal editor's account is not offered;
the unique index is the final authority.

*Authorisation* — anonymous rejected; ENGINEER reads; VIEWER refused; EDITOR
refused the directory and workspaces while `booking.readOwn` resolves their
own profile; only ADMIN creates, edits, deactivates, links and unlinks; every
mutation redirects on success and returns a typed result on failure.

**Decisions taken in Phase 6**

| Decision | Reason |
|---|---|
| Type is the stored `isExternal` flag, shown as Internal / External | Already in the schema; never inferred from an account, so an internal editor can exist before being linked |
| Accounts are linked, never created, and only to internal editors | External editors sign in person (R-1); creating logins nobody uses would be noise and risk |
| `DISABLED` and deleted accounts cannot be linked; `INVITED` / `SUSPENDED` can | Disabled and deleted are terminal; invited and suspended are transitional states of a real person |
| Deactivation is refused while a live booking exists | A kit out with someone must come back under a live editor; deactivate after return or cancellation |
| Removal is soft and only for profiles with no history | Bookings and signatures reference the profile forever (`ON DELETE RESTRICT`) |
| VIEWER keeps no `editor.read` | Unchanged matrix; the directory holds contact details |
| `kit.manage` stays ADMIN-only | Phase 6 decision as instructed; engineers read kits operationally |
| Linked account email shown to `editor.manage` only | Identifies the account for the administrator; other readers see name, role and status |

**Manual browser checks worth doing**

- [ ] `/editors` at 1366×768 and tablet as ENGINEER: five tabs with counts,
  the seeded Layla Hassan (Internal, linked) and EXT-5001 / EXT-5002
  (External, no account); search `EDT-2210` jumps to the editor; both themes.
- [ ] As ADMIN: create an external editor (no account section shown), then an
  internal one and link `viewer@example.ae`; the Account panel shows the
  account, Unlink works, Activity lists both entries.
- [ ] Try to make the linked editor external → refused with the field error;
  unlink, then it succeeds.
- [ ] Deactivate an editor with no live booking → Inactive badge, no longer in
  the Active tab; Reactivate returns it. Remove is offered only for a profile
  with no bookings.
- [ ] As VIEWER and as EDITOR: `/editors` is 403; the editor's own dashboard
  still shows their bookings.

---

## Line endings

`.gitattributes` (added in Phase 7) normalises every text file to LF in the
repository and on checkout (`* text=auto eol=lf`); Windows-only scripts
(`*.bat`, `*.cmd`, `*.ps1`) keep CRLF and binary assets are never converted.
This ends the "LF will be replaced by CRLF" warnings on Windows and makes the
WSL, Linux container and Windows checkouts byte-identical. Existing files were
**not** mass-rewritten: they are already LF in the repository. If a stray CRLF
file ever appears, `git add --renormalize .` in a dedicated commit fixes it.
Editors should follow the file (VS Code honours `.gitattributes` through
`files.eol: auto`).

---

## Phase 7 — Booking management (complete)

Reservations before handover on the top-navigation shell: the booking
workspace with status tabs and counts, search and server-side pagination; the
four-section create flow (editor, kit, schedule, review); explicit lifecycle
operations; edit within the lifecycle; cancellation with a reason; derived
overdue and due-soon; the booking workspace with Overview, Equipment and
Activity. Design in
[docs/ARCHITECTURE.md §16](docs/ARCHITECTURE.md#16-bookings-phase-7) and AD-19.

**What exists**

- No migration. `BOOKING_CREATED`, `BOOKING_UPDATED`, `BOOKING_STATUS_CHANGED`,
  `BOOKING_CANCELLED` and `KIT_STATUS_CHANGED` already existed; `Booking`
  already carried `engineerId`, `collectionDate`, `expectedReturnDate`,
  `cancelledAt` and `cancelReason`.
- `src/lib/booking-rules.ts` - pure lifecycle table (`MANUAL_TRANSITIONS`,
  `editScopeFor`, `isCancellable`), holding statuses, `isBookingOverdue`,
  `isDueSoon`, half-open `rangesOverlap`, `scheduleErrors`,
  `editorBookingBlocker`.
- `src/lib/validation/bookings.ts` - create / update / cancel schemas with
  `datetime-local` inputs, `parseSchedule` (Dubai wall-clock → instants),
  list and tab parameters. `src/lib/datetime.ts` gained `zonedLocalToDate`
  and `toZonedLocalInput`. `src/lib/env.ts` gained `BOOKING_DUE_SOON_HOURS`
  (default 48).
- `src/server/dal/bookings.dal.ts` (extended) - paginated, sorted workspace
  list with the new filter set, tab counts, detail, `findOverlappingBookings`,
  lifecycle context, engineer lookups, bookable-editor lookup, activity.
  `kits.dal.ts` gained `searchKitCandidates` (kit picker with readiness facts
  and upcoming bookings). `kits.service.ts` gained
  `evaluateKitReadinessForBooking` and a window-aware `evaluateKitAvailability`.
- `src/server/services/bookings.service.ts` - `createBooking` (draft or
  reserve), `reserveBooking`, `returnToDraft`, `markReadyForHandover`,
  `revertReadyForHandover`, `updateBooking`, `cancelBooking`,
  `translateBookingDbError`, `bookingTimeState`; loaders and picker searches.
- `src/server/actions/bookings.actions.ts` - seven actions, all through
  `action()` with `booking.create` / `booking.update` / `booking.cancel`.
- Pages: `/bookings` (rebuilt), `/bookings/new`, `/bookings/[id]` (tabs),
  `/bookings/[id]/edit`.
- `src/features/bookings/` - `hrefs.ts`; components: toolbar, table, time
  badge, schedule block, editor picker, kit picker, booking form, action forms
  (transitions and cancellation), overview, equipment (read-only), activity.
- Tests: `tests/integration/bookings.service.test.ts`,
  `tests/integration/bookings.actions.test.ts`,
  `tests/integration/bookings.boundary.test.ts` (the exact adjacent-booking
  case); the Phase 2 `bookings-scope.test.ts` is unchanged and still passes.
- Migration `20260905230000_booking_half_open_window` (boundary fix, applied
  after the first Phase 7 report): re-creates
  `bookings_no_overlapping_period_per_kit` with a half-open range, `'[)'`, so
  a booking 10:00–12:00 and the next one 12:00–14:00 on the same kit are both
  allowed, and tightens `bookings_period_is_ordered` to `bookingEnd >
  bookingStart` so an empty range cannot bypass the constraint. The earlier
  report's "touching periods overlap" described the closed range Phase 1 had
  shipped; it is no longer the behaviour.

**Verification — Phase 7 (2026-09-05)**

| Check | Result |
|---|---|
| `npm test` run 1 (25 files) | ✅ **237 / 237** |
| `npm test` run 2 (25 files) | ✅ **237 / 237** |
| Database after both runs | ✅ ASSET 14 and MAINTENANCE 1 counters unchanged, no BOOKING counter row created; 0 bookings, 1 kit, 12 assets, 3 editors, 6 users, 33 audit rows before and after |
| `scripts/db/verify-constraints.sql` | ✅ 30 / 30 PASS, rolled back |
| `prisma migrate status` | ✅ 5 migrations, up to date |
| `prisma migrate diff --exit-code` | ✅ No difference detected |
| `npm run check` | ✅ clean |
| `npm run build` | ✅ clean, all booking routes compiled |

**What the 27 booking tests prove** (`npm test`; every write inside a
rolled-back transaction, so even the BK numbers come back):

*Numbering and creation* — `BK-YYYY-NNNNNN` in sequence; a draft holds nothing;
a reservation is audited twice (created, then Draft → Reserved) and leaves the
kit status alone; an active external editor with no staff ID can be booked; an
internal editor without one, an inactive editor, a removed editor, an unknown
editor and an unknown engineer cannot.

*Readiness and schedule* — damaged required equipment, active maintenance and
a retired kit refuse a reservation (a draft is still allowed); end before
start, return after end, collection after end, collection more than 24 h
early, return before collection and a malformed date are refused before any
number is consumed.

*Overlap* — an overlapping reservation names the booking in the way; the
window is half-open, so A 10:00–12:00 and B 12:00–14:00 on one kit both
reserve (service, pre-check and constraint), a draft over the same window and
a booking after a cancellation all succeed, one shared minute is refused; a write that bypasses
the pre-check is refused by the exclusion constraint and translated into a
friendly conflict.

*Workspace* — search by booking number, editor name, staff ID, kit code and
kit barcode; status, due-soon and overdue filters with tab counts; sort and
pagination; overdue and due-soon flags per row; an EDITOR sees only their own
booking and cannot search out of scope; no read exposes credentials or ids.

*Lifecycle* — moving a reservation onto another's window is refused, moving
it elsewhere is audited, swapping in a blocked kit is refused; a booking that
is ready for handover accepts engineer and notes only; completed bookings are
read-only; reserve, release, ready (kit set aside), revert (kit released) and
cancel (kit released, row kept, reason recorded) all behave; cancelled and
checked-out bookings refuse further Phase 7 transitions; the timeline is
newest first with the cancellation reason on top.

*Authorisation* — anonymous rejected; VIEWER reads but cannot create or
cancel; EDITOR cannot create and sees only their own; ENGINEER creates and
edits; ADMIN reserves and cancels; an overlapping reservation through the
action layer returns a sentence, not a stack trace.

**Decisions taken in Phase 7**

| Decision | Reason |
|---|---|
| Create as DRAFT or directly RESERVED; drafts hold nothing | Planners pencil jobs in before the window is settled; the exclusion constraint already excluded DRAFT |
| Booking windows are half-open, [start, end): back-to-back bookings are adjacent, not overlapping | The requirement is that 10:00–12:00 and 12:00–14:00 on one kit both exist; the Phase 1 closed range was replaced by migration, the period check made strict, and the constraint suite and a dedicated test prove the boundary |
| External editors need no staff ID; internal editors do | Phase 7 decision; the handover document and the account link key on the internal staff ID |
| No company field required for external editors | Phase 7 decision; future scope |
| READY_FOR_HANDOVER sets `Kit.status` to RESERVED | "Ready" means the kit is physically set aside; a plain reservation for a future window leaves the kit on the shelf |
| Overdue is derived at read time; no scheduled sweep | Phase 7 decision; `isBookingOverdue` and the dashboard's `overdueWhere` are the same rule |
| Due soon = `BOOKING_DUE_SOON_HOURS` (48) in one env setting | One number, read by the filter, the tab count and the dashboard |
| Checklist snapshot deferred to the handover (Phase 8) | Copying the template at handover start guarantees the checks match the moment of inspection; `Booking.checklistTemplateId` is set now for information |
| `kit.manage` stays ADMIN-only | Phase 7 decision |
| Cancellation from DRAFT, RESERVED or READY_FOR_HANDOVER only | Anything out with an editor is closed by the return workflow |

**Manual browser checks worth doing**

- [ ] `/bookings` as ADMIN: eleven tabs with counts, search by `MBP-02`,
  by an editor's name and by `ADM-DEMO-KIT-0002`; sort by Start and Expected
  return; both themes; tablet width scrolls the table, not the page.
- [ ] `/bookings/new`: search `EDT-2210` → Layla Hassan (Internal) selectable;
  search an external editor with no staff ID → selectable; search `MBP-02` →
  Ready with 12 items and its upcoming bookings; set a window and *Reserve
  kit* → lands on the booking as Reserved.
- [ ] Try to reserve `MBP-02` again for an overlapping window → the form shows
  "already booked under BK-…"; a window starting right after the previous end
  succeeds; end before start and return after end show field errors.
- [ ] Mark a required asset DAMAGED on the equipment workspace → the kit picker
  shows "Not ready" with the asset named and no Select button; a draft can
  still be saved, *Reserve kit* on it is refused with the reason.
- [ ] Booking detail: schedule strip, editor and kit panels with Open links,
  Equipment tab read-only, Activity newest first; *Mark ready for handover*
  sets the kit to Reserved on `/kits`; *Back to reserved* releases it; cancel
  with a reason keeps the row as Cancelled.
- [ ] Edit a reservation's window onto another booking → refused; edit notes
  on a ready booking → allowed; schedule fields read-only there.
- [ ] As the seeded EDITOR (`editor@example.ae`): `/bookings` lists only their
  bookings, another booking's URL is 404, no New booking button. As VIEWER:
  list only. As ENGINEER: create, edit, cancel.
- [ ] Set an expected return in the past on a CHECKED_OUT booking (psql) →
  Overdue badge on the list, the detail and the dashboard agree.

---

## Phase 8 — Handover / collection (complete)

The handover workspace at `/bookings/[id]/handover`: identities, then
equipment, checklist and software, both signatures on the device, and a
completion that moves the booking READY_FOR_HANDOVER → CHECKED_OUT in one
transaction. Design in
[docs/ARCHITECTURE.md §17](docs/ARCHITECTURE.md#17-handover-phase-8) and AD-20.

**What exists**

- No migration. The Phase 1 schema already had the handover document
  (`Inspection` with `lockedAt` and `documentSnapshot`, `AssetInspection`,
  `AccessoryInspection`, `SoftwareCheck`, `BookingChecklistItem`,
  `ChecklistResult`, `Signature`), the one-live-inspection and one-live-
  signature indexes, the immutability triggers and every audit action used.
- `src/lib/validation/handover.ts` - line, checklist, software, signature and
  completion schemas; `parseLineFields` turns `asset.<id>.status`-style form
  fields into typed arrays.
- `src/server/storage/signature-store.ts` - PNG validation (magic bytes,
  ≤ 256 KB), SHA-256, `localSignatureStore` under `STORAGE_LOCAL_PATH`
  (gitignored), `memorySignatureStore` for tests.
- `src/server/dal/handover.dal.ts` - the booking as the handover needs it,
  snapshot sources, the live inspection with every line, the summary for the
  booking page; signature reads never include path or hash.
- `src/server/services/handover.service.ts` - `bookingHandoverBlockers`,
  `verificationVerdict`, `startHandover` (idempotent snapshot),
  `saveEquipmentVerification`, `saveChecklistVerification`,
  `captureSignature`, `completeHandover` (Serializable, row-locked),
  `loadHandoverWorkspace`.
- `src/server/actions/handover.actions.ts` - five actions through `action()`.
- Page: `/bookings/[id]/handover`. `src/features/handover/` - step card,
  identity panels, equipment form, checklist form, signature pad (canvas +
  Pointer Events), start / complete forms, handover summary. The booking
  overview gained the "Start / Continue handover" action and the handover
  summary after checkout; the booking timeline names signature events.
- Tests: `tests/integration/handover.service.test.ts`,
  `tests/integration/handover.actions.test.ts`.

**Verification — Phase 8 (2026-09-07)**

| Check | Result |
|---|---|
| `npm test` run 1 (29 files) | ✅ **278 / 278** |
| `npm test` run 2 (29 files) | ✅ **278 / 278** |
| Database after both runs | ✅ counters unchanged (ASSET 16, MAINTENANCE 1, BOOKING 1); the real dev booking, handover, two signatures and 12 checklist items untouched; no leftover `test-` rows |
| `scripts/db/verify-constraints.sql` | ✅ 31 / 31 PASS, rolled back |
| `prisma migrate status` | ✅ 6 migrations, up to date |
| `prisma migrate diff --exit-code` | ✅ No difference detected |
| `npm run check` | ✅ clean |
| `npm run build` | ✅ clean, `/bookings/[id]/handover` compiled |

**What the 14 handover tests prove** (`npm test`; every write inside a
rolled-back transaction, signature images in memory):

*Snapshot* — starting copies three equipment lines with their accessories, the
software list and the 11 handover-phase checks (the RETURN-only item is
copied to the booking but not offered), once; pressing Start again returns
the same inspection; a template edited afterwards leaves the booking's items
untouched.

*Eligibility* — draft, reserved, cancelled and unknown bookings are refused;
an inactive editor, a kit no longer set aside, a damaged required item and
maintenance in progress or on hold are refused with the reason; a damaged
optional item only warns. A kit with no equipment on it is refused at the page,
at the start and at the verdict, and leaves no inspection or checklist behind.

*Verification* — completion is refused until every required item is handed
over, every required check is answered PASS or not applicable, required
software is installed and both signatures are present; optional failures are
warnings; a bogus line id is refused.

*Signatures* — the editor signature is attributed to the booking's editor and
the engineer signature to the session user whoever holds the device; JPEGs and
malformed PNGs are refused and store nothing; signing again voids the old row
and keeps exactly one live signature per type; reads expose who and when,
never the path or hash.

*Completion* — booking CHECKED_OUT with a server collection time and the
expected return preserved; kit CHECKED_OUT; handed-over assets CHECKED_OUT
with status-log rows, a damaged optional item recorded DAMAGED; the inspection
frozen with the full document; audit and timeline in order; a repeat, a late
edit and a fresh start are refused with sentences and write nothing; the
database trigger refuses any change to the frozen document; a completion
refused at the last moment (maintenance opened after signing) leaves the
booking READY_FOR_HANDOVER, the kit RESERVED and no collection time.

*Authorisation* — anonymous, VIEWER and EDITOR cannot start, sign or complete;
ENGINEER starts, verifies and signs; ADMIN signs as engineer and completes;
the internal EDITOR's own booking still reads afterwards.

**Decisions taken in Phase 8**

| Decision | Reason |
|---|---|
| The checklist is copied into the booking when the handover starts | Phase 7 deferred it here so the checks match the moment of inspection; the template may change afterwards without touching a handover |
| Software is snapshotted per handover (`SoftwareCheck`) | Same reasoning; "required" is read from the kit's current software list since the check row has no such column |
| Signer identity is decided by the server | External editors have no account; a posted id could re-attribute a signature (AD-20) |
| Signature images are files, rows carry path and SHA-256 | AD-4 storage pattern; keeps the database small; hash proves the image later |
| Re-signing voids and inserts | Signature rows are immutable by trigger; one live signature per type by index |
| READY_FOR_HANDOVER means the kit is set aside (`Kit.status = RESERVED`); completion requires it | Anything else means the reservation was reverted or tampered with |
| Handed-over assets become CHECKED_OUT; items recorded missing or damaged take that status | The asset history must say where equipment went (Phase 4 workflow-owned statuses) |
| The assigned engineer is not replaced by the person handing over | Both are recorded: the booking keeps its engineer, the inspection records who started and completed |
| Signature images are not served yet | Needs an authorised file route; arrives with the PDF / return work |
| A kit with no equipment cannot be handed over | It passes the readiness rule trivially, but the handover exists to verify equipment; a document listing none proves nothing. Blocked at handover rather than in Phase 7, so nothing about reservation behaviour changes |

**Manual browser checks worth doing**

- [ ] As ENGINEER, on a READY_FOR_HANDOVER booking: the overview shows *Start
  handover*; the handover page shows booking, editor (type, staff ID, mobile,
  email) and kit; *Start handover* snapshots and the four stages appear.
- [ ] On a DRAFT or RESERVED booking the handover page explains why it cannot
  proceed and offers no Start button; a CHECKED_OUT booking shows the frozen
  summary.
- [ ] On a booking whose kit has no items: the handover page says the kit has
  no equipment and offers no Start button.
- [ ] Equipment: every kit item with make, model, serial and barcode, its
  accessories beneath; mark a required item Missing → stage 4 lists the
  blocker; mark an optional one Damaged → noted only.
- [ ] Checklist: leave a required check unanswered → blocked; fail one →
  blocked; pass all → cleared. Software: Not installed on a required app →
  blocked.
- [ ] Editor signature with the mouse, then with a finger on a tablet; Clear
  redraws the paper; Save without ink shows "Sign in the box before saving";
  Sign again replaces and the timeline shows the replacement.
- [ ] Engineer signature; then *Complete handover* is enabled only after the
  confirmation box is ticked; the booking page shows Checked out, collection
  time, editor and mobile, kit, expected return, "Handed over by", both
  signatures and the equipment / checklist counts; Edit and Cancel are gone.
- [ ] Press Complete twice quickly or from two tabs → one document, a sentence
  on the second.
- [ ] As VIEWER the handover page is 403; as the seeded EDITOR their own
  booking shows the summary and no handover controls.
- [ ] Light and dark themes; 768 px width: stages stack, selects stay touch-sized.

---

## Phase 9 — Return inspection (complete)

The return workspace at `/bookings/[id]/return`: what went out, then equipment
back, return checks, the engineer's confirmation, and a completion that moves
the booking CHECKED_OUT (or OVERDUE) → RETURN_INSPECTION → COMPLETED in one
transaction. Design in
[docs/ARCHITECTURE.md §18](docs/ARCHITECTURE.md#18-return-inspection-phase-9)
and AD-22.

**What exists**

- No migration. The Phase 1 schema already had the RETURN inspection type, the
  `RETURN_EDITOR` / `RETURN_ENGINEER` signature types, the RETURN checklist
  phase, `Booking.actualReturnDate`, the whole `Issue` model and every audit
  action used (`RETURN_STARTED`, `RETURN_COMPLETED`, `ISSUE_CREATED`,
  `ASSET_STATUS_CHANGED`, `KIT_STATUS_CHANGED`, `BOOKING_STATUS_CHANGED`).
- `src/lib/validation/return.ts` - line, accessory, checklist, signature and
  completion schemas, reusing the handover's condition values and
  `parseLineFields`.
- `src/lib/booking-rules.ts` gained `RETURN_START_STATUSES`, `canStartReturn`,
  `returnPunctuality` and `minutesLate` - all pure.
- `src/server/dal/return.dal.ts` - `getHandoverForReturn` (the historical
  source), `getLiveReturn` (the working document, with each line's handover
  condition joined in), `getReturnSummary` (counts, signatures and issues for
  the booking page). No signature path or hash ever leaves.
- `src/server/services/return.service.ts` - `bookingReturnBlockers`,
  `returnVerdict`, `kitStatusAfterReturn`, `startReturn`,
  `saveReturnEquipment`, `saveReturnChecklist`, `captureReturnSignature`,
  `completeReturn` (Serializable, row-locked), `loadReturnWorkspace`.
- `src/server/actions/return.actions.ts` - five actions through `action()`.
- Page: `/bookings/[id]/return`. `src/features/return/` - the handover recap,
  the equipment return form (three big answers per row plus "not checked"),
  the return checklist form, start / complete forms, and the return summary.
  Phase 8's identity panels, step card, signature pad and signature store are
  reused; the pad took an optional `action` prop so one canvas serves both
  phases.
- The booking overview gained the "Start / Continue return" action, the return
  summary with an early / on time / late badge, and new next-step wording for
  the out, overdue and return-inspection states.
- Tests: `tests/integration/return.service.test.ts`,
  `tests/integration/return.actions.test.ts`, `tests/unit/return-rules.test.ts`.

**Verification — Phase 9 (2026-09-07)**

| Check | Result |
|---|---|
| `npm test` run 1 (32 files) | ✅ **310 / 310** |
| `npm test` run 2 (32 files) | ✅ **310 / 310** |
| Phase 8 handover suites | ✅ 14 / 14 |
| Auth redirect-loop + outage suites | ✅ 26 / 26 |
| Animated sign-out suites | ✅ 12 / 12 |
| Booking half-open boundary suite | ✅ 2 / 2 |
| Database after both runs | ✅ counters unchanged (ASSET 16, MAINTENANCE 1, BOOKING 1, no ISSUE row); the real dev booking, handover, two signatures and 12 checklist items untouched; no `RET-` / `RTA-` rows, no issues, no stray inspections or signature files |
| `scripts/db/verify-constraints.sql` | ✅ 29 / 29 constraint checks pass, rolled back (checks 9c and 9d are seed-fixture assertions that the two hand-created dev assets break by design) |
| `prisma migrate status` | ✅ 6 migrations, up to date |
| `prisma migrate diff --exit-code` | ✅ No difference detected |
| `npm run check` | ✅ clean |
| `npm run build` | ✅ clean, `/bookings/[id]/return` compiled |

**What the 32 return tests prove** (`npm test`; every write inside a
rolled-back transaction, signature images in memory):

*The snapshot is the authority* — starting copies the completed handover's
lines, their accessories and the quantity that actually went out, once; the
booking moves to return inspection; pressing Start again returns the same
document. An asset an administrator later takes off the kit is still owed and
flagged as no longer in the kit; an asset added to the kit afterwards is not
part of the return; an item recorded missing or damaged at handover never went
out, so it is not something to account for.

*Eligibility* — draft, reserved, ready-for-handover, completed and unknown
bookings are refused; a booking with no handover, or one whose handover was
never completed, is refused with the reason; an overdue kit is accepted and the
timeline says Overdue → Return inspection.

*Enforcement* — completion is refused while any handed-over item has no answer,
and it names them; required return checks must be answered; the engineer
receiving the kit must have signed; the editor's signature is a warning, not a
blocker; a failed required check is recorded and warned about rather than
blocking; a line id from another return is refused.

*A clean return* — booking COMPLETED with a server `actualReturnDate`,
collection and expected return untouched; every asset AVAILABLE with a status
log naming the booking; kit AVAILABLE; the document frozen with both the
handover and return conditions; the handover's two signatures still live and
unedited alongside the return's two; activity newest-first with the completion
above the start.

*A return with problems* — a damaged asset becomes DAMAGED, one not returned
becomes MISSING, the healthy one AVAILABLE; three issues are raised (missing
HIGH, damaged MEDIUM, accessory LOW) numbered `ISS-`, linked to the booking,
inspection, kit and asset; the kit becomes DAMAGED rather than available; the
accessory's own master data is untouched; asset and kit audits are written; the
summary counts match and expose no storage fields. A returned item already
under repair leaves the kit MAINTENANCE while the booking still closes.

*Safety* — withdrawing the engineer's signature at the last moment refuses the
completion and leaves the booking RETURN_INSPECTION, the kit CHECKED_OUT, every
asset CHECKED_OUT, the inspection unlocked and no issues; a completed return
refuses further edits and the database trigger refuses one too; a second
submit is a sentence, not a second document.

*Authorisation and after* — anonymous, VIEWER and EDITOR cannot start, record,
sign or complete; ENGINEER starts once however often the button is pressed;
the signature is attributed to the session whatever the form claims; ADMIN
completes once with the confirmation box; an internal editor's own completed
booking still reads, without storage details.

*Pure rules* — a return may start only from CHECKED_OUT or OVERDUE; early, on
time and late are derived from the two timestamps with a 15-minute grace
window either side, and lateness is reported in whole minutes.

**Decisions taken in Phase 9**

| Decision | Reason |
|---|---|
| The return is measured against the completed handover, never live kit composition | The kit may have changed since; what was handed out is what is owed (AD-22) |
| A copied line starts NOT_APPLICABLE, meaning "not accounted for yet" | Lets completion insist on an explicit answer for everything that went out, with no new column or enum value |
| Problems warn but never block completion | The kit is physically back and the booking must close with the truth on it; the problem is preserved as an Issue |
| One Issue per damaged or missing asset and accessory, numbered like everything else | Reuses the existing issue model instead of a second problem system |
| Missing asset HIGH, damaged asset MEDIUM, accessory LOW | Rough triage an operator can re-prioritise; a lost asset is the expensive case |
| Asset status follows the recorded condition, with a status log | The asset's history has to say where the equipment ended up |
| The kit is re-evaluated through the Phase 5 readiness service after the assets are put back | A completed booking is not evidence that the kit is fit to go out again |
| Blocked kits become MAINTENANCE when a member is under repair, otherwise DAMAGED | Both are existing statuses that keep the kit out of service with a reason in the audit |
| The engineer's return signature is required, the editor's optional | Kits are often dropped off without the editor; an external editor has no account (AD-20), so requiring their signature would block a legitimate return |
| Lateness is derived, never stored | `expectedReturnDate` and `actualReturnDate` already say it; a completed booking is no longer operationally overdue but its history stays true |
| Software is not re-checked on return | The handover proved the build at collection; re-checking software on a returned machine belongs with re-preparation, not with receipt |
| "Other issue" is a note plus, where it matters, an Issue | Avoids a fifth condition value that would need a migration and would overlap with the issue model |

**Manual browser checks worth doing**

- [ ] As ENGINEER on a CHECKED_OUT booking: the overview shows *Start return
  inspection*; the return page shows booking, editor and kit, then "What went
  out" listing the handed-over items.
- [ ] *Start return inspection* → the booking reads Return inspection, the four
  stages appear, and every handed-over row starts on "Not checked".
- [ ] Mark one item Returned, one Damaged with a note, one Not returned; save.
  Stage 4 lists the two problems as recorded-not-blocking.
- [ ] Leave one row on "Not checked" → stage 4 refuses and names it.
- [ ] Answer the return checks; leave a required one unanswered → refused.
- [ ] Sign as the engineer; leave the editor pad empty → only a warning.
- [ ] Tick the confirmation and complete → booking Completed, actual return
  time shown, an early / on time / late badge, the return summary with counts,
  the issues raised, the return notes, and the handover summary still below it.
- [ ] The kit page: available if everything came back healthy, damaged or in
  maintenance if not, with the reason in its history.
- [ ] The issues raised open from the return summary (with `issue.read`).
- [ ] Press Complete twice quickly or from two tabs → one document, a sentence
  on the second.
- [ ] As VIEWER the return page is 403; as the seeded EDITOR their own booking
  shows the summary and no return controls.
- [ ] Light and dark themes; 768 px width: the answer buttons stay thumb-sized
  and the rows stack.

---

## Phase 10 — Kit labels, photo evidence and file access (complete)

One QR code per kit for the case, optional photo evidence on handovers and
returns, the authorised file route Phase 9 left open, and a kit page that
answers a scan at a glance. Design in
[docs/ARCHITECTURE.md §19](docs/ARCHITECTURE.md#19-kit-labels-photo-evidence-and-file-access-phase-10).

**What exists**

- No migration. `Attachment` (kind INSPECTION_PHOTO, provider, path, SHA-256,
  size, MIME, caption, links to booking and inspection) was already in the
  Phase 1 schema, as was `MAX_UPLOAD_BYTES`.
- One new dependency: `qrcode` (pure JavaScript, server-side SVG), with its
  types as a dev dependency. Nothing new reaches the browser.
- `src/server/services/qr.service.ts` - the scan path `/k/<kit id>`, the
  request-derived origin, and the inline SVG.
- `src/app/k/[id]/page.tsx` - where a scan lands: session and `kit.read`
  required, then a redirect to the kit; unknown or removed kits are a 404.
  `resolveScannedKit` also accepts a kit code or ADM barcode.
- `src/app/(app)/kits/[id]/label/page.tsx` - the printable card, with the
  shell hidden when printing.
- `src/features/kits/components/` gained `kit-operations-panel.tsx` (where the
  kit stands and what to do next), `kit-qr-panel.tsx` and `print-button.tsx`.
  `kitOperations` in the kits service is the pure rule behind the actions.
- `src/server/storage/photo-store.ts` - byte-sniffed type, bounded size,
  generated names, sanitised display names, and `readStoredFile`, the one
  read path for signatures and photos alike, which refuses to leave the store.
- `src/server/dal/attachments.dal.ts`, `src/server/services/photos.service.ts`,
  `src/server/actions/photos.actions.ts` - metadata reads with no paths, the
  upload rule (open inspection only, twelve per inspection), and the two
  actions under `handover.perform` / `return.perform`.
- `src/server/services/files.service.ts` and
  `src/app/api/files/[kind]/[id]/route.ts` - the authorised file route.
- `src/features/photos/components/` - `photo-evidence.tsx` (thumbnails plus a
  camera-first upload row inside the equipment step of both workflows) and
  `photo-strip.tsx` (read-only, grouped by phase, on the booking page).
- Tests: `tests/unit/photo-store.test.ts`, `tests/integration/photos.test.ts`,
  `tests/integration/files.route.test.ts`, `tests/integration/kit-qr.test.ts`.

**Verification — Phase 10 (2026-09-07)**

| Check | Result |
|---|---|
| `npm test` run 1 (36 files) | ✅ **347 / 347** |
| `npm test` run 2 (36 files) | ✅ **347 / 347** |
| Phase 8 handover, Phase 9 return, auth, sign-out and boundary suites | ✅ green in both runs |
| Database after both runs | ✅ counters unchanged (ASSET 16, MAINTENANCE 1, BOOKING 1); the live booking, handover, two signatures untouched; 0 attachments; no test rows |
| Filesystem after both runs | ✅ exactly the two live signature files under `storage/`; no test photos, no test directories |
| `scripts/db/verify-constraints.sql` | ✅ 29 / 29 constraint checks pass, rolled back (9c and 9d are seed-fixture assertions the two hand-created dev assets break by design) |
| `prisma migrate status` | ✅ 6 migrations, up to date |
| `prisma migrate diff --exit-code` | ✅ No difference detected |
| `npm run check` | ✅ clean |
| `npm run build` | ✅ clean; `/k/[id]`, `/kits/[id]/label` and `/api/files/[kind]/[id]` compiled |

**What the 37 Phase 10 tests prove**

*The label* — the payload is `/k/<opaque id>` and carries no kit code, barcode,
editor, booking, purpose or status; the SVG renders at both sizes and does not
spell the payload out as text; a scan resolves by id, code or barcode and
resolves nothing for unknown, empty, oversized, injection-shaped or removed
tokens.

*The kit page* — a free, ready kit offers a booking to someone who may book and
nothing to a viewer or editor; a reserved kit offers its booking; ready for
handover adds the handover for engineers and admins only; out or overdue adds
the return; a part-recorded return is continued; a removed kit offers nothing;
a kit that is free but not fit to go out offers no booking.

*Uploads* — JPEG, PNG and WebP by their bytes; a PDF in a `.jpg` coat refused;
size bounded; hostile filenames reduced to labels and never used in a path;
the read path refusing to leave the store or accept a null byte; handover and
return photos each staying with their own inspection, the handover's surviving
the return; both workflows completing with no photos; nothing written on a
refusal; the frozen-inspection and not-started refusals; the cap.

*The file route* — anonymous 401; a booking reader served with `nosniff`,
`private, no-store`, an inline generated filename and no path, provider or
hash anywhere; ADMIN and VIEWER served; an EDITOR served their own booking's
files and refused another's; unknown ids, unknown kinds and path-shaped ids
refused before any database read; a real row with a missing file answering
410; a signature id refused as a photo and vice versa.

**Decisions taken in Phase 10**

| Decision | Reason |
|---|---|
| One QR per kit, encoding `/k/<kit id>` only | A case label is public to anyone near the case; an opaque id is useless without a login, and it survives a renumbering |
| No in-app camera scanner | Every phone's camera app already opens a URL, with no permission prompt or client library; a scanner is a separate decision if ever wanted |
| Scan route requires a session and `kit.read` | An anonymous scan goes to login and comes back; a stranger with the case learns nothing |
| The origin comes from the request | No new environment variable to keep in step across localhost, LAN and domain |
| Photos are optional, capped at twelve, and only while the inspection is open | Evidence is for disputes, not a checklist; a frozen document keeps its evidence frozen |
| The type is sniffed from the bytes | Client `Content-Type` and extensions are claims |
| Stored names are generated; client names are labels | Nothing the client sends becomes part of a path |
| One read path with a containment check | A tampered row cannot reach outside the store |
| Files are served through `/api/files/<kind>/<id>` with booking-scoped authorisation | Signatures and photos are booking records, so booking permissions decide |
| Unknown and forbidden ids both look like "not found" from outside | The route never confirms which ids exist |
| Missing files answer 410, not 500 | A restored database is an operational state, not a bug |

**Manual browser checks worth doing**

- [ ] Kit page: the "Where this kit stands" panel shows code, name, status,
  readiness, the current booking, editor, engineer, collection and expected
  return, and the blocking / noted reasons.
- [ ] Overview tab: the case label panel shows the QR and its URL, and
  *Printable label* opens the card; Print shows the card alone.
- [ ] Scan the printed code with a phone: signed out it lands on login and then
  on the kit; signed in it opens the kit directly.
- [ ] Handover: add a photo from the camera in the equipment step; it appears as
  a thumbnail and opens full size; the handover completes with or without it.
- [ ] Return: add a damage photo; the handover's photos are unchanged; the
  booking page shows both groups.
- [ ] Open a photo URL signed out → JSON 401. As the seeded EDITOR, open a
  photo from someone else's booking → 403.
- [ ] Upload a PDF renamed `.jpg` → refused with a sentence; upload a 9 MB
  image → refused.
- [ ] Light and dark themes; the label card stays white; 768 px width: the
  panel stacks and the camera button stays thumb-sized.

---

## Phase 11 — Issue management (complete)

The issues module: a real list, a detail page with the lifecycle, reporting by
hand, assignment, photos, and links from the equipment and booking pages.
Returns have been raising issues since Phase 9; this is where they get worked.
Design in [docs/ARCHITECTURE.md §20](docs/ARCHITECTURE.md#20-issue-management-phase-11).

**What exists**

- No migration. The `Issue` model, its type / severity / status enums, the
  `ISSUE_PHOTO` attachment kind, the `ISS-` number scope and the five audit
  actions were all in the Phase 1 schema.
- `src/lib/validation/issues.ts` - report, edit, assign and the four lifecycle
  schemas; list params with seven filters.
- `src/server/dal/issues.dal.ts` - list with filters, search, sort and paging;
  counts per filter; the detail with every link, its photos and any maintenance
  raised from it; the issue's own audit trail; assignable users; asset and kit
  pickers.
- `src/server/services/issues.service.ts` - `ISSUE_TRANSITIONS` and the pure
  rules, `createIssue`, `updateIssue`, `assignIssue`, `startInvestigation`,
  `resolveIssue`, `closeIssue`, `reopenIssue`, and the two page loaders.
- `src/server/actions/issues.actions.ts` - seven actions under `issue.create`
  and `issue.manage`.
- Pages: `/issues` (was a placeholder), `/issues/[id]`, `/issues/new`.
- `src/features/issues/` - the table, the summary panels, the lifecycle forms,
  the photo strip, the history list, the report form, and `hrefs.ts`.
- Photos: `addIssuePhoto` in the Phase 10 service, `getIssuePhotos` and
  `getIssuePhotoFileInternal` in the attachments DAL, an `issue-photo` kind on
  the authorised file route, and `uploadIssuePhotoAction`.
- Links: the equipment Issues tab now opens each issue and offers "Report an
  issue" for that asset; the booking's return summary links were written in
  Phase 9 and now resolve.

**Verification — Phase 11 (2026-09-07)**

| Check | Result |
|---|---|
| `npm test` run 1 (39 files) | ✅ **372 / 372** |
| `npm test` run 2 (39 files) | ✅ **372 / 372** |
| Phases 1–10 suites | ✅ all green, unchanged |
| Database after both runs | ✅ counters unchanged (ASSET 16, MAINTENANCE 1, BOOKING 1, no ISSUE row); the live booking, handover and two signatures untouched; 0 issues, 0 attachments |
| Filesystem after both runs | ✅ the two live signature files only; no test photos, no test directories |
| `scripts/db/verify-constraints.sql` | ✅ 29 / 29 constraint checks pass, rolled back (9c and 9d are seed-fixture assertions the two hand-created dev assets break by design) |
| `prisma migrate status` | ✅ 6 migrations, up to date |
| `prisma migrate diff --exit-code` | ✅ No difference detected |
| `npm run check` | ✅ clean |
| `npm run build` | ✅ clean; `/issues`, `/issues/[id]` and `/issues/new` compiled |

**What the 25 Phase 11 tests prove**

*Reporting* — an issue gets an `ISS-YYYY-NNNNNN` number, its links resolved and
its reporter recorded, and reporting changes no equipment status; naming only an
accessory fills in its asset; every link that does not exist is refused; an
assignee must be an active engineer or administrator.

*The lifecycle* — open → investigating → resolved → closed runs with an audit
line each, and picking up an unowned issue assigns it to whoever did; closing
something never resolved demands a written reason and records who decided;
reopening clears the finished timestamps and keeps the previous resolution;
every transition the table forbids is refused, as are edits and reassignment on
a closed issue; corrections and reassignment work while it is live, including
assigning it to nobody.

*The Phase 9 join* — a return that records a missing item and a missing
accessory raises two issues; both appear in the list pointing at the asset, the
kit and the booking; the return's issue can then be investigated and resolved,
and resolving it leaves the missing asset MISSING.

*Finding them* — all seven filters, the counts behind them, search across
number, title, equipment code and serial, severity ordering, and pagination.

*Permissions* — engineers and admins are offered the transitions; a viewer is
offered none and gets no assignee list; an editor holds nothing; all seven
actions refuse anonymous, VIEWER and EDITOR callers with nothing moved;
validation and lifecycle refusals come back as sentences.

*Photos* — stored with metadata, a sanitised display name and an audit line;
non-images, unknown issues and closed issues refused with nothing written; the
twelve-photo limit; served with `nosniff` and `private, no-store` and no
internals; anonymous 401; a VIEWER refused an equipment-only photo but allowed
one that came from a booking they may read; another booking's editor refused;
and issue photos not served as inspection photos.

**Decisions taken in Phase 11**

| Decision | Reason |
|---|---|
| Resolving an issue never changes asset or kit status | An issue records a fact; returning equipment to service is a deliberate act with the equipment in hand, and belongs to maintenance |
| Closing without a fix requires a written reason | "Closed, no comment" is how a real fault gets forgotten |
| Reopening keeps the previous resolution | The same fault coming back is the same issue, and what was tried last time is the useful part |
| A resolved or closed issue cannot be edited, reassigned or photographed | It is a record at that point; reopen it first |
| Picking an issue up assigns it to the picker when nobody owns it | The person looking at it is the person who owns it |
| Assignees are limited to active ADMIN and ENGINEER accounts | Those are the roles that hold `issue.manage`; assigning work to someone who cannot do it is a dead end |
| Naming only an accessory fills in its asset | So the issue shows on the equipment page, where someone will look for it |
| Issue photos are authorised by `issue.read` **or** the booking rule | An issue may have no booking; one that came from a return is still part of that booking's story |
| Issue photos are a separate route kind | The lookups are separate tables; a signature id must not resolve as a photo, and neither should an inspection photo id |

**Manual browser checks worth doing**

- [ ] As ENGINEER: Issues shows Open by default with counts on each tab;
  search by an asset code finds the return-raised issues for it.
- [ ] Open one raised by a return: the equipment, kit and booking all link out,
  and "Found during" says the return inspection.
- [ ] Press "I am looking at this" → status becomes Being investigated and your
  name appears; resolve with a sentence → Resolved; close → Closed.
- [ ] Reopen it with a reason → Open again, previous resolution still shown in
  History.
- [ ] Try to close an open issue with no reason → refused with a message.
- [ ] Add a photo to a live issue; it opens full size. Close the issue and the
  upload control disappears.
- [ ] From Equipment › a MacBook › Issues: rows open, and "Report an issue"
  pre-fills that asset.
- [ ] As VIEWER: /issues is 403 (no `issue.read`). As the seeded EDITOR: also
  403, and their booking page shows no issues section.
- [ ] Light and dark themes; 768 px width: the lifecycle forms stack.

---

## Phase 12 — Reports and PDF (complete)

Eleven reports over one query layer, and the signed handover and return as a
printable sheet and a PDF drawn from the frozen snapshot. Design in
[docs/ARCHITECTURE.md §21](docs/ARCHITECTURE.md#21-reports-and-documents-phase-12).

**What exists**

- No migration. Everything read here has been in the schema since Phase 1, and
  the documents have been frozen into `Inspection.documentSnapshot` since
  Phases 8 and 9.
- One dependency added: `pdf-lib` (pure JavaScript, no Chromium, no font files
  to bundle).
- `src/server/reports/types.ts` - `ColumnDef`, `ReportRow`, `ReportResult`,
  `ReportParams`, `ReportScope`, `ReportDefinition`, and `paginate`.
- `src/server/reports/filters.ts` - `parseReportQuery` (drops a filter the
  report does not offer; page size 5–200, default 50), `toReportParams` (a
  local `YYYY-MM-DD` becomes an instant in the business time zone, `to`
  inclusive of the whole local day), `reportHref`.
- `src/server/reports/definitions.ts` - the eleven reports. `bookingWhere`
  applies the scope, the kit and editor filters and the free-text search; every
  derived number (days out, days late, days to resolve, days open) is computed
  here, and a `Decimal` cost becomes a plain number.
- `src/server/reports/registry.ts` - `findReport`, `mayRunReport`,
  `reportsFor`, `groupedReportsFor`.
- `src/server/reports/renderers/csv.ts` - UTF-8 byte-order mark, CRLF, RFC 4180
  quoting, and a leading `=`, `+`, `-` or `@` prefixed with an apostrophe.
- `src/server/services/reports.service.ts` - `scopeFor`, `runReport` (an
  unknown id refused exactly like a forbidden one), `loadReportPage`,
  `loadReportCatalogue`, `runReportCsv`.
- `src/server/documents/snapshot.ts` - `readDocument` parsing a stored snapshot
  defensively into one view model; `documentTitle`, `inspectionTypeFor`.
- `src/server/documents/pdf.ts` - `renderDocumentPdf` and the `Sheet` layout
  cursor, WinAnsi-safe text, signature PNGs embedded.
- `src/server/services/documents.service.ts` - `loadDocument`
  (`ok | not-found | forbidden | not-ready`), `mayRead`, `availableDocuments`,
  `signatureImages`, `renderDocument`.
- Pages: `/reports` (was a placeholder) is now the catalogue grouped in three;
  `/reports/[report]` is any report with its filters, paging and export;
  `/bookings/[id]/document/[kind]` is the printable sheet.
- Routes: `/api/reports/[report]` (CSV, attachment) and
  `/api/documents/[kind]/[id]` (PDF, inline, `private, no-store`, `nosniff`,
  409 when nothing is signed yet).
- `src/features/reports/` - the table and the filter bar;
  `src/features/documents/` - the sheet.
- Links: the booking workspace gained a "Signed documents" panel from
  `availableDocuments`, opening the sheet or the PDF.

**Verification — Phase 12 (2026-09-07)**

| Check | Result |
|---|---|
| `npm test` run 1 (41 files) | ✅ **397 / 397** |
| `npm test` run 2 (41 files) | ✅ **397 / 397** |
| Phases 1–11 suites | ✅ all 372 green, unchanged |
| Database after both runs | ✅ counters unchanged (ASSET 16, MAINTENANCE 1, BOOKING 1); the live booking, its handover and two signatures untouched; 0 issues, 0 attachments |
| Filesystem after both runs | ✅ the two live signature files only; no test PDFs, no test directories |
| `scripts/db/verify-constraints.sql` | ✅ 29 / 31 pass, rolled back (9c and 9d are seed-fixture assertions the two hand-created dev assets break by design, unchanged since Phase 10) |
| `prisma migrate status` | ✅ 6 migrations, up to date |
| `prisma migrate diff --exit-code` | ✅ No difference detected |
| `npm run check` | ✅ clean, no warnings |
| `npm run build` | ✅ clean; `/reports`, `/reports/[report]`, `/bookings/[id]/document/[kind]`, `/api/reports/[report]` and `/api/documents/[kind]/[id]` compiled |

**What the 25 Phase 12 tests prove**

*The catalogue and who may run what* — an administrator and an engineer see all
eleven reports, a viewer sees only those whose data they may read, and an
editor cannot reach the area at all; a report the caller may not read is
refused, and so is an unknown id, so ids cannot be enumerated. A run scoped to
one editor profile returns only that editor's rows.

*The reports themselves* — what is out, with the editor's mobile and the days
it has been out; upcoming returns and overdue separating on the same booking as
its expected return moves; booking history with punctuality and a server-side
status filter; kit utilisation and editor history counted from the same
bookings; completed documents with their counts and a document-type filter;
missing and damaged equipment naming the issue that raised it; the inventory
with kit membership, out-now and open issues; maintenance carrying a `Decimal`
cost as a number.

*Filters, paging and CSV* — paging is server-side and the page size is clamped
rather than trusted; a date filter is read in the business time zone and a
malformed one is dropped rather than half-applied; the CSV header matches the
table's columns and the file carries a byte-order mark and CRLF; a value
starting `=` is written as text, not a formula.

*The documents* — the handover carries everything from the snapshot and no
storage path, hash or audit payload; the return shows what went out beside what
came back with its punctuality; **the roadmap's test** — renaming the kit and
swapping an asset's serial number, after which the sheet and a freshly
generated PDF still show what was signed; a partial snapshot renders with
blanks instead of throwing; both PDFs render with the signatures embedded, and
one still renders when the image files are gone.

*Reading a document* — the route serves an administrator, an engineer and a
viewer with dull headers; anonymous is 401; an editor reads their own booking's
document and is refused another's; nothing signed yet is 409, a missing booking
404, an unknown kind 404.

**Manual checks — Phase 12**

- [ ] `/reports` lists eleven reports in three groups; each opens.
- [ ] Currently checked out shows the live booking, its editor and days out.
- [ ] Set a date filter, page, then reload: the URL alone restores the view.
- [ ] Export CSV, open it in Excel: the columns match the table and the
  characters are right.
- [ ] From the live booking: "Signed documents" → the handover sheet; Print
  shows the sheet without the application chrome; Download PDF opens the PDF
  with the signatures in it.
- [ ] Rename the kit, then reopen the document: it still says what was signed.
- [ ] As VIEWER: `/reports` opens but the issues, maintenance and editor
  reports are absent, and typing one's URL is 403. As the seeded EDITOR:
  `/reports` is 403, but their own booking's document opens.
- [ ] Light and dark themes; the sheet stays white ground and dark ink in both.
- [ ] 768 px width: the filter bar stacks and the table scrolls in its own
  container.

---

## Phase 13 — Testing and deployment (complete)

The last roadmap phase. Four test layers, a production image that no longer
ships secrets, and a backup runbook that has been rehearsed. Design in
[docs/ARCHITECTURE.md §22](docs/ARCHITECTURE.md#22-testing-and-deployment-phase-13);
the runbook is [docs/OPERATIONS.md](docs/OPERATIONS.md).

**What exists**

- No migration. Nothing in the schema changed.
- One dependency added: `@playwright/test`, plus its Chromium download.
- `tests/unit/numbering.test.ts` - the reference format per scope, the period
  a scope counts in, the year boundary, the year read in UTC, and the refusal
  when the statement returns nothing.
- `tests/unit/permissions-matrix.test.ts` - the whole grid, one test per
  permission per role, then the properties the grid must have.
- `tests/unit/completion-rules.test.ts` - `bookingHandoverBlockers`,
  `verificationVerdict`, `bookingReturnBlockers`, `returnVerdict` and
  `kitStatusAfterReturn`, asserted on the sentences an engineer reads.
- `tests/integration/constraints.test.ts` - the database's own guarantees,
  each test in its own rolled-back transaction with its own fixtures.
- `tests/e2e/` - the handover → return journey in seven ordered steps, plus
  authentication and RBAC in a browser, and a shared `helpers.ts` that signs
  in, signs out and draws on the signature canvas with the mouse.
- `playwright.config.ts` and `scripts/e2e/prepare.ts` + `cli.ts` - the E2E run
  gets its own database (`ekms_e2e`), its own build directory
  (`NEXT_DIST_DIR=.next-e2e`), its own storage (`./storage-e2e`) and its own
  four seeded accounts. It cannot reach development data.
- `next.config.ts` - `distDir` now reads `NEXT_DIST_DIR`, unset everywhere
  except the E2E run, so two servers never fight over `.next`.
- `.dockerignore` - new, and the important one: `COPY . .` was sending `.env`
  and the signed evidence in `storage/` into the build context.
- `.github/workflows/ci.yml` - four jobs: check, test (with a PostgreSQL 16
  service container, a drift check and the SQL constraint script), the
  Playwright journey, and the production image built then started to prove it
  answers `/api/health`.
- `docs/OPERATIONS.md`, `scripts/ops/backup.sh`, `scripts/ops/restore.sh` -
  deploy, migrate, back up, restore, and what cannot be undone.
- `eslint.config.mjs` and `tsconfig.json` - ignore the E2E artefacts.
- Two fixes the E2E suite found: `/issues` and `/reports` now refuse with
  `requirePermissionForPage`, so an unauthorised visitor gets the 403 page
  instead of the 503 one (AD-26).

**Verification — Phase 13 (2026-09-07)**

| Check | Result |
|---|---|
| `npm test` run 1 (45 files) | ✅ **671 / 671** |
| `npm test` run 2 (45 files) | ✅ **671 / 671** |
| Phases 1–12 suites | ✅ all 397 green, unchanged |
| `npm run test:e2e` (Playwright, Chromium) | ✅ **16 / 16**, on `ekms_e2e` |
| Database after both runs | ✅ counters unchanged (ASSET 16, MAINTENANCE 1, BOOKING 1); 1 booking, 1 inspection, 2 signatures, 14 assets, 98 audit rows, 0 issues, 0 attachments |
| Filesystem after both runs | ✅ the two live signature files only |
| `scripts/db/verify-constraints.sql` | ✅ 29 / 31 pass, rolled back (9c and 9d assert the pristine seed and fail against the two hand-created dev assets, unchanged since Phase 10) |
| `prisma migrate status` | ✅ 6 migrations, up to date |
| `prisma migrate diff --exit-code` | ✅ No difference detected |
| `npm run check` | ✅ clean, no warnings |
| `npm run build` | ✅ clean, 37 routes |
| Backup and restore rehearsal | ✅ backed up the live database read-only, restored into a scratch database, checksums verified, 6 migrations matching, then dropped the scratch database |

**What the 274 new tests prove**

*Numbering* — every scope's reference format including the four-digit kit
padding, a yearly scope rolling to a new period on 1 January while a global one
carries on, the year read in UTC so 23:30 on 31 December in Dubai still counts
as December, a value wider than the padding left intact, and a refusal rather
than a made-up reference when the counter comes back empty.

*Permissions* — 120 cells, one test each, plus: ADMIN holds everything and
nobody else does; every `admin.*` permission belongs to ADMIN alone; VIEWER
holds no permission that mutates anything; EDITOR holds exactly
`dashboard.view`, `booking.readOwn` and `booking.signOwn`; `perform` and
`complete` are always granted together; `manage` never appears without the
matching `read`; and a name the matrix does not declare is refused for
everybody.

*Completion* — a handover cleared, and blocked for each of nine reasons with
the sentence asserted; a required item missing blocks while an optional one
warns; an item that left the kit or entered maintenance since the snapshot
blocks; unanswered required checks are counted in one message with the right
singular; both signatures are demanded and a return signature does not count;
a return needs every handed-over item accounted for but lets a missing or
damaged one through as a warning that promises an issue; the receiving
engineer must sign and the editor's absence is expected; and the kit comes back
AVAILABLE only when the readiness rule says so, MAINTENANCE when it cannot be
judged.

*The database* — the booking exclusion constraint across every status that
holds a kit, containment as well as partial overlap, the half-open boundary
that lets back-to-back bookings through, zero-length and reversed windows
refused, a collection later than the expected return refused; one live
inspection of each type per booking with a voided one exempt; one live
signature of each type per inspection; the locked-inspection trigger against
notes, the frozen document, unlocking and re-pointing, with voiding still
allowed; the signature trigger against the image, the hash, the signer and the
time, with voiding still allowed; the audit log against update, delete and a
bulk delete; the numbering counter incrementing atomically and rolling back
with its transaction; one active kit membership per asset with history kept;
and the maintenance checks, its one-active-record index and the `ON DELETE SET
NULL` that keeps a record when its issue is deleted.

*The journey* — a booking reserved through the pickers, set aside, handed over
with twelve items and twenty-five accessories recorded, every check passed,
both applications installed, two signatures drawn on the canvas and the
handover completed; the signed document read and its PDF downloaded as a real
`%PDF-`; the kit received back, every item accounted for, the return checks
answered, the receiving engineer signed and the return completed; the booking
completed, the kit AVAILABLE again, both documents in place and the booking
listed in the completed-documents report; and another editor unable to reach
any of it. Alongside it: login and callback, a wrong password refused without a
hint, sign-out through the animated menu, `/login` sending a signed-in user to
the dashboard without looping, and each role stopped at the routes it cannot
hold with "Access denied" by name.

**Manual checks — Phase 13**

- [ ] `npm run test:e2e` from a clean checkout: it builds `ekms_e2e`, runs
  Chromium, and the development database's counters do not move.
- [ ] While the E2E run is going, the development server on port 3000 keeps
  working: separate build directory, separate database.
- [ ] `docker build -f docker/Dockerfile -t ekms:latest .` then
  `docker history ekms:latest`: no `.env`, no `storage/`.
- [ ] `docker compose --profile app up -d --build`, then
  `curl -fsS localhost:3000/api/health`.
- [ ] Run `scripts/ops/backup.sh` against a running system, then restore it
  into a scratch database and open the most recent signed document: the
  signature images must appear, not "signature on file".
- [ ] As VIEWER: `/issues` shows "Access denied", not "Temporarily
  unavailable". Same for `/reports` as the seeded EDITOR.

---

## Next: the roadmap is finished

All thirteen phases are complete. What follows is not roadmap work but the
decisions that were deliberately deferred, in the order they are likely to
matter.

**Open decisions carried forward**

- The maintenance workflow itself: records are read-only, they appear in a
  report and an issue can point at one, but nothing creates or advances them.
  This is the largest remaining gap in the product and no phase covers it.
- Whether ENGINEER may manage kits (`kit.manage`) — still ADMIN only.
- Whether the overdue sweep is needed for notifications now that OVERDUE is
  derived at read time.
- Rate-limit store for multi-instance deployment.
- The soft-deleted smoke accounts and the hard-delete-vs-audit question for
  users who have signed in.
- Two constraint-script checks (9c, 9d) assert the pristine seed shape and
  fail against hand-created dev data. The automated suite no longer depends on
  it; either relax those two or keep the script for fresh seeds only.
- `npm audit` advisories in the Prisma CLI's own dependency tree, present
  since before Phase 10; the suggested fix downgrades Prisma.
- Whether reports need an Excel renderer beside CSV, and whether any report
  should be schedulable rather than pulled by hand.
- A real deployment target. The image, the compose profile, the health check
  and the runbook are ready; where it runs, behind what proxy, with what
  backup schedule and what off-host copy, is not decided.
