-- User-approved workflow changes (2026-09-08): the requester is manual booking
-- data, the checklist is prepared before the handover, the recipient signs
-- with a typed name and mobile, and the return records who brought the kit
-- back. Everything here is additive or relaxing; no existing row changes.
--
-- 1. The requester becomes booking-level snapshot data. A booking no longer
--    needs an EditorProfile, so editorId is relaxed to NULL. The relation is
--    kept for every historical booking, and a CHECK keeps the rule that a
--    booking always names somebody - by profile (old) or by name (new).
-- 2. The preparer is the authenticated user (createdById, which already
--    exists). engineerId is relaxed to NULL because an administrator with no
--    engineer profile may now prepare a booking; it is still filled in when
--    the preparer has one.
-- 3. The pre-handover checklist is answered on the booking's own checklist
--    items, before any inspection exists. startHandover seeds those answers
--    into the inspection, so the frozen document is built exactly as before.
-- 4. A return records the person who physically brought the kit back, and a
--    signature records the recipient's mobile. Both are added to the frozen
--    column lists of the existing immutability triggers, in the same
--    migration, so a signed record cannot grow an editable field.

-- --- 1 + 2 + 3. Bookings -------------------------------------------------------
ALTER TABLE "bookings"
  ADD COLUMN "requesterName" TEXT,
  ADD COLUMN "requesterStaffId" TEXT,
  ADD COLUMN "requesterMobile" TEXT,
  ADD COLUMN "projectName" TEXT,
  ADD COLUMN "workOrder" TEXT,
  ADD COLUMN "checklistPreparedAt" TIMESTAMPTZ(3),
  ADD COLUMN "checklistPreparedById" TEXT,
  ALTER COLUMN "editorId" DROP NOT NULL,
  ALTER COLUMN "engineerId" DROP NOT NULL;

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_checklistPreparedById_fkey"
  FOREIGN KEY ("checklistPreparedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Every booking names the person it is for: a profile on the old rows, a
-- typed name on the new ones. Both may be present; neither may be absent.
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_requester_identified"
  CHECK ("editorId" IS NOT NULL OR "requesterName" IS NOT NULL);

-- --- 3. The prepared checklist --------------------------------------------------
ALTER TABLE "booking_checklist_items"
  ADD COLUMN "preparedStatus" "ChecklistStatus",
  ADD COLUMN "preparedNotes" TEXT,
  ADD COLUMN "preparedAt" TIMESTAMPTZ(3),
  ADD COLUMN "preparedById" TEXT;

ALTER TABLE "booking_checklist_items"
  ADD CONSTRAINT "booking_checklist_items_preparedById_fkey"
  FOREIGN KEY ("preparedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- --- 4. Who returned the kit, and the recipient's mobile ------------------------
ALTER TABLE "inspections" ADD COLUMN "returnedByName" TEXT;
ALTER TABLE "signatures"  ADD COLUMN "signerMobile" TEXT;

-- The locked-inspection trigger from 20260903000100, with returnedByName
-- added to the frozen list. Identical otherwise.
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
       OR NEW."returnedByName" IS DISTINCT FROM OLD."returnedByName"
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

-- The signature trigger from 20260903000100, with signerMobile and
-- signerStaffId added to the frozen list. Identical otherwise.
CREATE OR REPLACE FUNCTION "prevent_signature_update"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."imagePath" IS DISTINCT FROM OLD."imagePath"
     OR NEW."imageHash" IS DISTINCT FROM OLD."imageHash"
     OR NEW."signedAt" IS DISTINCT FROM OLD."signedAt"
     OR NEW."signerName" IS DISTINCT FROM OLD."signerName"
     OR NEW."signerStaffId" IS DISTINCT FROM OLD."signerStaffId"
     OR NEW."signerMobile" IS DISTINCT FROM OLD."signerMobile"
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
