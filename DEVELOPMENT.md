# DEVELOPMENT.md

Running log of what exists, what to test, and what comes next.

- **Current phase:** 6 of 13 — Editor management — ✅ **complete**
- **Status:** verified against PostgreSQL 16.15 — five migrations applied, zero
  drift, 30/30 database constraint tests, 198/198 Vitest tests (two consecutive
  runs, database and numbering counters unchanged), typecheck + lint clean,
  production build clean
- **Last updated:** 2026-09-05 (Phase 6)

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
npm run db:migrate     # applies all five migrations
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
| `scripts/db/verify-constraints.sql` | ✅ 30 / 30 PASS, rolled back |
| `prisma migrate status` | ✅ 5 migrations, up to date |
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

## Next: Phase 7 — Booking management

Booking CRUD with `BK-YYYY-NNNNNN`, the kit availability calendar, the
checklist snapshot on creation, status transitions and cancellation - on the
top-navigation shell with the Bookings tabs already in place. Uses
`getKitAvailability` (Phase 5) before reserving a kit and
`searchEditorsForPicker` (Phase 6) to choose the editor; only active editors
and ready kits may be booked.

**Open decisions carried forward**

- Whether ENGINEER may manage kits (`kit.manage`) — still ADMIN only.
- Whether removing an asset from a kit should also be offered from the
  equipment workspace (today it is a kit operation only).
- Whether the nightly overdue sweep (R-3) lands with bookings in Phase 7 or
  earlier as a standalone job.
- Whether a booking may be created for an editor without a staff ID, and
  whether external editors need a company recorded before their first booking.
- Rate-limit store for multi-instance deployment, if the target is more than
  one container.
- Hard-deleting a user who has ever signed in fails: `audit_logs.actorUserId`
  is `ON DELETE SET NULL`, but the append-only trigger rejects that update.
  Soft delete (`deletedAt`) is the intended operation and works; user
  management should either rely on it exclusively or switch the foreign key to
  `RESTRICT` (new migration) so the failure reads as a rule, not a surprise.
  Concretely: the two disposable HTTP smoke-test accounts
  (`smoke-admin@example.test`, `smoke-editor@example.test`) signed in during
  the Phase 3 / 4 smoke tests and own four `audit_logs` rows, so they cannot be
  hard-deleted without rewriting audit history. They stay as soft-deleted rows
  (`deletedAt` set, `DISABLED`, `passwordHash` NULL) and cannot sign in; they
  are the only non-seed users in the development database.
