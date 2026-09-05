# MVP Development Roadmap

Thirteen phases. Each one ends at a state you can actually click through and
sign off, rather than at "the code compiles".

**Definition of done for every phase:** server-side authorization on every new
route and action · Zod validation at every trust boundary · loading and empty
states · audit entries for state changes · `npm run typecheck && npm run lint`
clean · `DEVELOPMENT.md` updated.

---

## Phase 1 — Architecture and database schema ✅ COMPLETE

Schema, migration, seed, Docker, project skeleton, architecture docs.

**Test:** `docker compose up -d db && npm run db:migrate && npm run db:seed`,
then `npm run db:studio` and confirm the seeded kit, its 12 assets and their
accessories.

---

## Phase 2 — Authentication and RBAC ✅ COMPLETE

- Auth.js v5 credentials provider, bcrypt (cost 12), account lockout.
- `sessionVersion` revocation check in the `jwt` callback (AD-2).
- `proxy.ts` optimistic redirect + per-request CSP nonce.
- Permission matrix (`server/auth/permissions.ts`) — the single source of truth
  for all four roles.
- `requireSession()` / `requirePermission()` / the `action()` wrapper.
- `/login`, sign-out, session timeout, `/api/health`.

**Test:** each seeded role signs in and is bounced from routes it should not
reach — including by pasting the URL directly, and by invoking a Server Action
from the console.

---

## Phase 3 — Application shell and dashboard ✅ COMPLETE

Delivered: the live, permission-aware dashboard (six KPI tiles from the
database; today's bookings, upcoming returns, overdue, open issues, recent
activity; an editor-specific view), the shared `StatusBadge`, `PageHeader` and
`EmptyState` primitives, the business-time-zone helper, and the login page
redesign. The shell (sidebar, header, role-filtered navigation) landed in
Phase 2.

Deferred, to be picked up with the first data-heavy screens in Phase 4:
shadcn/ui adoption, `DataTable`, `ConfirmDialog`, `Stepper`, breadcrumbs.

**Test:** tablet width (768–1024 px) is usable, not just narrow desktop.

---

## Phase 4 — Asset management ✅ COMPLETE

Delivered as **Equipment** on the top-navigation shell: paginated, searchable
inventory with status tabs, category and kit-assignment filters and sortable
columns; barcode-scanner path (an exact ADM barcode opens the equipment);
create and edit with `AST-NNNNNN` allocation and database-enforced uniqueness
surfaced as field errors; lifecycle rules (workflow statuses locked, active
maintenance blocks availability, kit members cannot be retired or removed);
soft delete with preserved history; accessories on the managed
`AccessoryType` vocabulary; maintenance and issue panels; the unified history
trail; Administration › Categories (list, create, edit, activate / deactivate).
Maintenance records are read-only here - the maintenance workflow itself is a
later phase.

**Test:** two assets cannot share a serial number or ADM barcode; a soft-deleted
asset disappears from lists but its history survives. Both are automated.

---

## Phase 5 — Kit management ✅ COMPLETE

Delivered on the top-navigation shell: the kit list with status tabs, search
that reaches into kit contents (asset code, barcode, serial) and a kit-barcode
scan path; create and edit with typed kit codes (`MBP-03`, `WIN-01`,
`AUDIO-01`) and database-enforced uniqueness; the kit workspace with Overview,
Equipment (grouped by category, accessories expandable), Software, Checklist
and History tabs; the composition editor with a barcode-friendly picker and
server-side assignment rules backed by the one-active-kit constraint; slot
labels and required / optional membership; software expectations; checklist
template assignment; the single availability calculation (AD-17) reused by the
list, the workspace and the coming booking phases; kit history; audit entries
for every change (five new `AuditAction` values by migration). Reordering
members is by sort order only (no drag-and-drop yet).

**Test:** building "External MBP Edit - 03" end to end from the UI, without
touching code, is now possible: create the kit, scan equipment into it, pick
its software and checklist. Every rule behind it is automated (36 tests).

---

## Phase 6 — Editor management

Editor profiles including external editors with no login; search by name/staff
ID; per-editor booking history.

---

## Phase 7 — Booking management

Booking CRUD, `BK-YYYY-NNNNNN`, kit availability calendar, checklist snapshot on
creation, status transitions, cancellation.

**Test:** two overlapping bookings on one kit are rejected — including when both
are submitted at the same moment (the exclusion constraint, not a UI check).

---

## Phase 8 — Handover workflow

The seven-step wizard. Auto-loads kit contents into inspection lines, per-item
status + notes + photos, software check, checklist, review. Optimistic
concurrency (R-6). Completion transaction: inspection locked, booking
`CHECKED_OUT`, kit and assets `CHECKED_OUT`, audit written.

**Test:** kill the browser mid-wizard and resume; confirm a completed handover
cannot be edited; confirm two tablets editing one inspection get a conflict
dialog rather than silent overwrite.

---

## Phase 9 — Digital signatures

Pointer-events signature pad (mouse, touch, stylus), SHA-256 hashing, IP and
user-agent capture, authorised file serving, void-don't-delete.

**Test:** sign on an actual tablet with a finger. This is the one feature that
cannot be validated with a mouse.

---

## Phase 10 — Return workflow

New `RETURN` inspection, side-by-side handover vs return diff with differences
highlighted, issue prompt on degradation, completion transaction returning
assets to `AVAILABLE` except those with unresolved issues.

**Test:** mark a mouse `MISSING` on return; confirm the handover inspection is
untouched, an Issue is offered, and that asset alone stays out of `AVAILABLE`.

---

## Phase 11 — Issue management

`ISS-YYYY-NNNNNN`, issue list and detail, lifecycle, photos, links from asset and
booking pages.

---

## Phase 12 — Reports and PDF

Report query layer (AD-5) + the ten reports; handover and return PDFs rendered
from `documentSnapshot` (AD-6); CSV export as the first extra renderer.

**Test:** regenerate a handover PDF *after* renaming the kit and swapping an
asset's serial number — the PDF must still show what was signed.

---

## Phase 13 — Testing and deployment

Vitest unit tests (numbering, permissions, handover/return completion),
Testcontainers integration tests proving the DB constraints, Playwright E2E over
handover → return, production Docker build, backup and restore runbook.

---

## Sequencing notes

- **Phases 4–6 are independent** and can run in parallel across developers.
- **Phase 8 is the risk concentration.** It is the largest phase, it owns the
  transactional integrity, and it is where R-4 and R-6 land. Budget accordingly.
- **Phase 9 before Phase 10.** The return workflow reuses the signature pad.
- **R-1 (how external editors sign) is resolved:** external editors sign in
  person on the authenticated engineer's tablet or device during handover and
  return. No external `User` account is required. Phase 8 builds that flow.
- **R-7 (maintenance records) is resolved.** `MaintenanceRecord` landed in the
  Phase 1 maintenance refinement, so Phase 4 builds the maintenance UI over an
  existing, constraint-tested table instead of retrofitting one.
