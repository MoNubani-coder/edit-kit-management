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

## Phase 6 — Editor management ✅ COMPLETE

Delivered on the top-navigation shell: the editor directory with Internal /
External / Active / Inactive tabs, search by name, staff ID, contact number and
email (an exact staff ID opens the editor), server-side pagination and booking
figures per row; the editor workspace with Overview, Active bookings, Booking
history, Issues and Activity tabs; create and edit with database-enforced staff
ID uniqueness; external editors with no account and internal editors with an
optional, audited account link (AD-18); deactivation instead of deletion, with
history preserved and inactive editors excluded from the booking picker; the
`searchEditorsForPicker` lookup Phase 7 will use; three new `AuditAction`
values by migration. Signatures (Phase 8) already have their
`signerEditorProfileId` target.

**Test:** an external editor with no login appears in the directory, can be
chosen for a booking while active, and keeps every booking after deactivation.
Automated (24 tests).

---

## Phase 7 — Booking management ✅ COMPLETE

Delivered on the top-navigation shell: the booking workspace with eleven
status tabs and counts, search by booking number, editor, staff ID, kit code,
kit name and kit barcode, sort and server-side pagination; the four-section
create flow (editor picker from Phase 6, kit picker with the Phase 5 readiness
verdict and upcoming bookings, Dubai wall-clock schedule, review) saving as a
draft or reserving directly; `BK-YYYY-NNNNNN` allocated in the transaction;
explicit lifecycle operations (reserve, release, ready for handover with the
kit set aside, revert, cancel with a reason); edit within the lifecycle with
re-validation; overlap pre-check with the exclusion constraint as the
authority (half-open window - back-to-back bookings are adjacent, any shared
moment overlaps);
derived overdue and due-soon; the booking workspace with Overview, Equipment
and Activity. The checklist snapshot moves to the handover (Phase 8) so the
checks match the moment of inspection; the kit availability *calendar* view
remains future scope - the kit picker lists upcoming bookings instead.

**Test:** two overlapping reservations for one kit cannot both exist, however
they are submitted; one starting the instant the other ends can. Automated
(27 tests).

**Test:** two overlapping bookings on one kit are rejected — including when both
are submitted at the same moment (the exclusion constraint, not a UI check).

---

## Phase 8 — Handover / collection ✅ COMPLETE

Delivered on the top-navigation shell: the handover workspace at
`/bookings/[id]/handover` for READY_FOR_HANDOVER bookings - identities, then
equipment (every kit item with its accessories, condition per line, case
condition), checklist and software (the booking's checklist copied from the
template when the handover starts, software snapshotted the same way), both
signatures captured on the device with a canvas pad (mouse, touch, stylus) and
attributed by the server, and a completion that re-checks eligibility, the
Phase 5 readiness rule, every answer and both signatures inside one
Serializable, row-locked transaction before freezing the document and moving
the booking to CHECKED_OUT with a server collection time, the kit and the
handed-over equipment to CHECKED_OUT. Idempotent start, one live signature per
type, no second document on a repeat. No migration was needed.

**Test:** an external editor with no account signs on the engineer's tablet
and the kit leaves as CHECKED_OUT with a frozen, signed document; a second
submit changes nothing. Automated (14 tests), including a kit with no
equipment, which is refused.

---

## Phase 9 — Return inspection ✅ COMPLETE

Delivered on the top-navigation shell: the return workspace at
`/bookings/[id]/return` for a kit that is out or overdue - what went out,
then equipment back (every handed-over item and accessory, answered returned,
damaged or not returned on thumb-sized controls), the booking's own
return-phase checks, the receiving engineer's signature on the device with the
editor's optional, and a completion that re-checks the handover it is measured
against, every answer and that signature inside one Serializable, row-locked
transaction before freezing the return document, setting `actualReturnDate`
from the server clock, completing the booking, putting each asset back to the
status its condition implies, raising an Issue per damaged or missing item, and
re-evaluating the kit through the Phase 5 readiness rule rather than assuming
it is available. Lateness is derived from the expected and actual times, never
stored. Idempotent start, no second document on a repeat. No migration was
needed.

**Test:** a kit comes back with one item damaged and one missing; the booking
completes, two issues are raised, the equipment carries the right statuses and
the kit stays out of service with the reason on its history. Automated
(32 tests).

---

## Phase 10 — Kit labels, photo evidence and file access ✅ COMPLETE

Delivered on the top-navigation shell: one QR code per kit encoding only an
opaque `/k/<kit id>` URL, shown on the kit page and on a printable case label,
resolving through a session-and-`kit.read` route to the kit; a kit page that
opens with where the kit stands - status, readiness, current booking, editor,
expected return, warnings - and the contextual actions the lifecycle and the
caller's permissions allow; optional photo evidence on open handovers and
returns, typed by its bytes, bounded, stored under generated names and frozen
with the document it belongs to; and the authorised file route that serves
signatures and photos only to callers who may read the booking they belong to,
with dull headers and no paths, providers or hashes anywhere. No in-app camera
scanner, by decision. No migration was needed.

**Test:** scan a printed label signed out and land on the kit after login; add
a damage photo on a return without touching the handover's; open a photo URL
as the wrong editor and get 403. Automated (37 tests).

---

## Phase 11 — Issue management ✅ COMPLETE

Delivered on the top-navigation shell: the issues list with seven counted
filters and search across number, title, equipment, serial, kit and booking;
the issue detail with what the problem is, what it is about (equipment,
accessory, kit, booking and the inspection that found it, each linked for
readers who hold that permission), the lifecycle - pick it up, resolve it with
a sentence, close it (with a written reason when nothing was fixed), reopen it
when the fault comes back - assignment to an active engineer or administrator,
optional photos through the Phase 10 authorised route, and the issue's own
audit trail as sentences. Reporting by hand from the equipment page or the
list, with every link resolved server-side. `ISS-YYYY-NNNNNN` numbering was
already in use by returns. No migration was needed.

**Test:** a return records a missing item and a missing accessory; both issues
appear against the asset, kit and booking, can be investigated and resolved -
and resolving them leaves the missing asset MISSING, because an issue records a
fact and never moves equipment (AD-24). Automated (25 tests).

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
