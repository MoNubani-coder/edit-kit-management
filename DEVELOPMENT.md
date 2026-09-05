# DEVELOPMENT.md

Running log of what exists, what to test, and what comes next.

- **Current phase:** 3 of 13 — Dashboard, theme switch and visual redesign — ✅ **complete**
- **Status:** verified against PostgreSQL 16.15 — three migrations applied, zero
  drift, 30/30 database constraint tests, 114/114 Vitest tests (auth,
  RBAC, routes, dashboard, time zone, theme switch), HTTP smoke test of the
  built app for every role, typecheck + lint clean, production build clean
- **Last updated:** 2026-09-03 (Phase 3)

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
  `StatusPage`; `AppShell` rebuilt (17.5 rem rail, brand block, grouped
  navigation with teal marker, bottom user panel with sign-out and the
  pull-cord, context top bar with date and initials); dashboard `StatStrip` /
  `Stat` replacing loose KPI cards, `SectionCard` with tinted header and count
  chip, table restyle, timeline activity feed, shortcut chips; login frame and
  card restyled to the same tokens. `src/lib/constants/branding.ts` holds the
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
- [ ] Redesign: rail, top bar, instrument strip, panels and login card read as
  one product at 1366×768, on a tablet and in a narrow window, in both modes.

---

## Next: Phase 4 — Asset management

CRUD for assets and accessories, `AST-NNNNNN` allocation, uniqueness errors as
field errors, soft delete, status transitions writing `AssetStatusLog`,
maintenance records (`MNT-YYYY-NNNNNN`) per asset, and the asset history
timeline. First data-heavy screens: adopt shadcn/ui and build `DataTable`,
`ConfirmDialog` and breadcrumbs here rather than restyling later.

**Open decisions for Phase 4**

- Whether ENGINEER may manage assets and maintenance records (`asset.manage`,
  `maintenance.manage`) or only ADMIN — the matrix currently says ADMIN only.
- Whether the nightly overdue sweep (R-3) lands with bookings in Phase 7 or
  earlier as a standalone job.
- Rate-limit store for multi-instance deployment, if the target is more than
  one container.
- Hard-deleting a user who has ever signed in fails: `audit_logs.actorUserId`
  is `ON DELETE SET NULL`, but the append-only trigger rejects that update.
  Soft delete (`deletedAt`) is the intended operation and works; user
  management in Phase 4 should either rely on it exclusively or switch the
  foreign key to `RESTRICT` (new migration) so the failure reads as a rule,
  not a surprise.
