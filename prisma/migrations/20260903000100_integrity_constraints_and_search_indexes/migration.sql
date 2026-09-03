-- =============================================================================
-- Integrity constraints and search indexes
-- =============================================================================
-- Rules that Prisma's schema language cannot express, but which must hold even
-- under concurrent requests. Application-level checks lose these races; the
-- database does not.
--
-- Documented in docs/ARCHITECTURE.md section 4.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Extensions
-- -----------------------------------------------------------------------------
-- btree_gist : lets a GiST exclusion constraint mix an equality column (kitId)
--              with a range column (the booking period).
-- pg_trgm    : trigram indexes for fast case-insensitive partial-text search.
--
-- NOTE: neither is a "trusted" extension, so these statements require a
-- superuser or an appropriately granted role. On Azure Database for PostgreSQL
-- both must first be allow-listed via the `azure.extensions` server parameter.
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;


-- -----------------------------------------------------------------------------
-- 1. A kit cannot be booked twice over the same period
-- -----------------------------------------------------------------------------
-- Statuses that actually reserve the physical kit. DRAFT, COMPLETED and
-- CANCELLED do not hold the kit, so they are excluded from the constraint and
-- may overlap freely.
--
-- '[]' makes the range inclusive at both ends: a booking ending on the 10th and
-- another starting on the 10th collide, which is the desired behaviour for a
-- kit that must be physically returned before it goes out again.
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_no_overlapping_period_per_kit"
  EXCLUDE USING gist (
    "kitId" WITH =,
    tstzrange("bookingStart", "bookingEnd", '[]') WITH &&
  )
  WHERE (
    "deletedAt" IS NULL
    AND "status" IN (
      'RESERVED',
      'READY_FOR_HANDOVER',
      'CHECKED_OUT',
      'OVERDUE',
      'RETURN_INSPECTION'
    )
  );

-- Guard the range itself. Without this, a typo swapping the dates produces an
-- empty range, which collides with nothing and silently bypasses the constraint
-- above.
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_period_is_ordered"
  CHECK ("bookingEnd" >= "bookingStart");

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_return_after_collection"
  CHECK (
    "collectionDate" IS NULL
    OR "expectedReturnDate" >= "collectionDate"
  );


-- -----------------------------------------------------------------------------
-- 2. One live inspection of each type per booking
-- -----------------------------------------------------------------------------
-- An admin may void a return inspection and redo it, so voided rows are exempt.
-- What must never happen is two *live* handovers on one booking.
CREATE UNIQUE INDEX "inspections_one_live_per_booking_and_type"
  ON "inspections" ("bookingId", "type")
  WHERE "voidedAt" IS NULL;


-- -----------------------------------------------------------------------------
-- 3. One live signature of each type per inspection
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX "signatures_one_live_per_inspection_and_type"
  ON "signatures" ("inspectionId", "type")
  WHERE "voidedAt" IS NULL;


-- -----------------------------------------------------------------------------
-- 4. An asset belongs to at most one kit at a time
-- -----------------------------------------------------------------------------
-- KitAsset rows are soft-removed (removedAt) so historical bookings stay
-- resolvable. Only current membership is constrained.
CREATE UNIQUE INDEX "kit_assets_one_active_kit_per_asset"
  ON "kit_assets" ("assetId")
  WHERE "removedAt" IS NULL;


-- -----------------------------------------------------------------------------
-- 5. Global search indexes
-- -----------------------------------------------------------------------------
-- Exact-match barcode and code lookups are already covered by the B-tree indexes
-- Prisma generated. These trigram indexes cover the partial, case-insensitive
-- "type a few characters" path in the global search box.
CREATE INDEX "assets_name_trgm" ON "assets" USING gin ("name" gin_trgm_ops);
CREATE INDEX "assets_model_trgm" ON "assets" USING gin ("model" gin_trgm_ops);
CREATE INDEX "assets_serial_trgm" ON "assets" USING gin ("serialNumber" gin_trgm_ops);
CREATE INDEX "assets_barcode_trgm" ON "assets" USING gin ("admBarcode" gin_trgm_ops);

CREATE INDEX "kits_name_trgm" ON "kits" USING gin ("name" gin_trgm_ops);
CREATE INDEX "kits_code_trgm" ON "kits" USING gin ("kitCode" gin_trgm_ops);
CREATE INDEX "kits_barcode_trgm" ON "kits" USING gin ("admBarcode" gin_trgm_ops);

CREATE INDEX "editor_profiles_name_trgm" ON "editor_profiles" USING gin ("fullName" gin_trgm_ops);
CREATE INDEX "editor_profiles_staff_trgm" ON "editor_profiles" USING gin ("staffId" gin_trgm_ops);

CREATE INDEX "bookings_number_trgm" ON "bookings" USING gin ("bookingNumber" gin_trgm_ops);
CREATE INDEX "issues_number_trgm" ON "issues" USING gin ("issueNumber" gin_trgm_ops);


-- -----------------------------------------------------------------------------
-- 6. Dashboard / report supporting indexes
-- -----------------------------------------------------------------------------
-- "Overdue returns" and "upcoming returns" scan only live bookings; a partial
-- index keeps completed and cancelled history out of the way permanently.
CREATE INDEX "bookings_active_by_expected_return"
  ON "bookings" ("expectedReturnDate")
  WHERE "deletedAt" IS NULL
    AND "status" IN ('RESERVED', 'READY_FOR_HANDOVER', 'CHECKED_OUT', 'OVERDUE', 'RETURN_INSPECTION');

CREATE INDEX "issues_open_by_reported_at"
  ON "issues" ("reportedAt" DESC)
  WHERE "status" IN ('OPEN', 'UNDER_INVESTIGATION');


-- -----------------------------------------------------------------------------
-- 7. Signed records are append-only at the database level
-- -----------------------------------------------------------------------------
-- Defence in depth behind the application's lockedAt checks: once an inspection
-- is locked, the only column that may change is the void triple. This stops a
-- future code path - or a hand-written UPDATE - from quietly editing a document
-- somebody has signed.
CREATE OR REPLACE FUNCTION "prevent_locked_inspection_update"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."lockedAt" IS NOT NULL THEN
    IF NEW."lockedAt" IS DISTINCT FROM OLD."lockedAt"
       OR NEW."bookingId" IS DISTINCT FROM OLD."bookingId"
       OR NEW."type" IS DISTINCT FROM OLD."type"
       OR NEW."suitcaseStatus" IS DISTINCT FROM OLD."suitcaseStatus"
       OR NEW."generalNotes" IS DISTINCT FROM OLD."generalNotes"
       OR NEW."documentSnapshot" IS DISTINCT FROM OLD."documentSnapshot"
       OR NEW."completedAt" IS DISTINCT FROM OLD."completedAt"
       OR NEW."completedById" IS DISTINCT FROM OLD."completedById"
    THEN
      RAISE EXCEPTION
        'Inspection % is locked and cannot be modified. Void it and create a new inspection instead.',
        OLD."id"
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "inspections_locked_are_immutable"
  BEFORE UPDATE ON "inspections"
  FOR EACH ROW
  EXECUTE FUNCTION "prevent_locked_inspection_update"();


-- A signature is never edited. It is written once, and may only be voided.
CREATE OR REPLACE FUNCTION "prevent_signature_update"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."imagePath" IS DISTINCT FROM OLD."imagePath"
     OR NEW."imageHash" IS DISTINCT FROM OLD."imageHash"
     OR NEW."signedAt" IS DISTINCT FROM OLD."signedAt"
     OR NEW."signerName" IS DISTINCT FROM OLD."signerName"
     OR NEW."type" IS DISTINCT FROM OLD."type"
     OR NEW."inspectionId" IS DISTINCT FROM OLD."inspectionId"
     OR NEW."bookingId" IS DISTINCT FROM OLD."bookingId"
  THEN
    RAISE EXCEPTION
      'Signature % is immutable. Void it and capture a new signature instead.',
      OLD."id"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "signatures_are_immutable"
  BEFORE UPDATE ON "signatures"
  FOR EACH ROW
  EXECUTE FUNCTION "prevent_signature_update"();


-- The audit log is append-only. Nothing in the application updates or deletes
-- it, and nothing should be able to.
CREATE OR REPLACE FUNCTION "prevent_audit_log_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only (attempted %).', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER "audit_logs_are_append_only"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW
  EXECUTE FUNCTION "prevent_audit_log_mutation"();
