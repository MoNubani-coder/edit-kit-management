-- =============================================================================
-- Database integrity verification
-- =============================================================================
-- Proves that the constraints in migration
-- 20260903000100_integrity_constraints_and_search_indexes actually reject what
-- they are supposed to reject. Run against a migrated + seeded database:
--
--   psql "$DATABASE_URL" -f scripts/db/verify-constraints.sql
--
-- Everything runs inside one transaction that is ROLLED BACK at the end, so the
-- database is left exactly as it was found. Each test records PASS or FAIL in a
-- temp table; the final SELECT is the report.
-- =============================================================================

\set ON_ERROR_STOP off
\set QUIET on

BEGIN;

CREATE TEMP TABLE results (
  seq    serial,
  test   text,
  status text,
  detail text
) ON COMMIT DROP;

-- -----------------------------------------------------------------------------
-- Fixtures pulled from seed data
-- -----------------------------------------------------------------------------
CREATE TEMP TABLE fx AS
SELECT
  (SELECT id FROM kits            WHERE "kitCode" = 'MBP-02')                       AS kit_id,
  (SELECT id FROM editor_profiles WHERE "staffId" = 'EXT-5001')                     AS editor_id,
  (SELECT id FROM engineer_profiles LIMIT 1)                                        AS engineer_id,
  (SELECT id FROM users           WHERE role = 'ADMIN' LIMIT 1)                     AS admin_id,
  (SELECT id FROM assets          WHERE "serialNumber" = 'SN-DEMO-MBP02-0001')      AS asset_id;

DO $$
DECLARE f fx%ROWTYPE;
BEGIN
  SELECT * INTO f FROM fx;
  IF f.kit_id IS NULL OR f.editor_id IS NULL OR f.engineer_id IS NULL
     OR f.admin_id IS NULL OR f.asset_id IS NULL THEN
    RAISE EXCEPTION 'Seed data missing - run `npm run db:seed` first.';
  END IF;
END $$;


-- -----------------------------------------------------------------------------
-- Test 1: overlapping RESERVED bookings on one kit are rejected
-- -----------------------------------------------------------------------------
DO $$
DECLARE f fx%ROWTYPE;
BEGIN
  SELECT * INTO f FROM fx;

  INSERT INTO bookings (id, "bookingNumber", "kitId", "editorId", "engineerId", status,
                        "bookingStart", "bookingEnd", "expectedReturnDate", "createdById", "updatedAt")
  VALUES ('t1-a', 'BK-TEST-000001', f.kit_id, f.editor_id, f.engineer_id, 'RESERVED',
          '2030-10-01T08:00:00Z', '2030-10-10T17:00:00Z', '2030-10-10T17:00:00Z', f.admin_id, now());

  BEGIN
    INSERT INTO bookings (id, "bookingNumber", "kitId", "editorId", "engineerId", status,
                          "bookingStart", "bookingEnd", "expectedReturnDate", "createdById", "updatedAt")
    VALUES ('t1-b', 'BK-TEST-000002', f.kit_id, f.editor_id, f.engineer_id, 'RESERVED',
            '2030-10-05T08:00:00Z', '2030-10-15T17:00:00Z', '2030-10-15T17:00:00Z', f.admin_id, now());

    INSERT INTO results (test, status, detail)
    VALUES ('1. Overlapping booking rejected', 'FAIL', 'second overlapping RESERVED booking was accepted');
  EXCEPTION WHEN exclusion_violation THEN
    INSERT INTO results (test, status, detail)
    VALUES ('1. Overlapping booking rejected', 'PASS', SQLERRM);
  END;
END $$;


-- -----------------------------------------------------------------------------
-- Test 1b: an overlapping CANCELLED booking is allowed (not in the constraint)
-- -----------------------------------------------------------------------------
DO $$
DECLARE f fx%ROWTYPE;
BEGIN
  SELECT * INTO f FROM fx;
  BEGIN
    INSERT INTO bookings (id, "bookingNumber", "kitId", "editorId", "engineerId", status,
                          "bookingStart", "bookingEnd", "expectedReturnDate", "createdById", "updatedAt")
    VALUES ('t1-c', 'BK-TEST-000003', f.kit_id, f.editor_id, f.engineer_id, 'CANCELLED',
            '2030-10-05T08:00:00Z', '2030-10-15T17:00:00Z', '2030-10-15T17:00:00Z', f.admin_id, now());

    INSERT INTO results (test, status, detail)
    VALUES ('1b. Overlapping CANCELLED booking allowed', 'PASS', 'cancelled bookings do not hold the kit');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO results (test, status, detail)
    VALUES ('1b. Overlapping CANCELLED booking allowed', 'FAIL', SQLERRM);
  END;
END $$;


-- -----------------------------------------------------------------------------
-- Test 1c: a non-overlapping RESERVED booking is allowed
-- -----------------------------------------------------------------------------
DO $$
DECLARE f fx%ROWTYPE;
BEGIN
  SELECT * INTO f FROM fx;
  BEGIN
    INSERT INTO bookings (id, "bookingNumber", "kitId", "editorId", "engineerId", status,
                          "bookingStart", "bookingEnd", "expectedReturnDate", "createdById", "updatedAt")
    VALUES ('t1-d', 'BK-TEST-000004', f.kit_id, f.editor_id, f.engineer_id, 'RESERVED',
            '2030-10-11T08:00:00Z', '2030-10-20T17:00:00Z', '2030-10-20T17:00:00Z', f.admin_id, now());

    INSERT INTO results (test, status, detail)
    VALUES ('1c. Adjacent non-overlapping booking allowed', 'PASS', 'starts the day after the previous one ends');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO results (test, status, detail)
    VALUES ('1c. Adjacent non-overlapping booking allowed', 'FAIL', SQLERRM);
  END;
END $$;


-- -----------------------------------------------------------------------------
-- Test 2: reversed dates are rejected
-- -----------------------------------------------------------------------------
DO $$
DECLARE f fx%ROWTYPE;
BEGIN
  SELECT * INTO f FROM fx;
  BEGIN
    INSERT INTO bookings (id, "bookingNumber", "kitId", "editorId", "engineerId", status,
                          "bookingStart", "bookingEnd", "expectedReturnDate", "createdById", "updatedAt")
    VALUES ('t2-a', 'BK-TEST-000005', f.kit_id, f.editor_id, f.engineer_id, 'DRAFT',
            '2030-11-10T08:00:00Z', '2030-11-01T17:00:00Z', '2030-11-10T17:00:00Z', f.admin_id, now());

    INSERT INTO results (test, status, detail)
    VALUES ('2. Reversed booking dates rejected', 'FAIL', 'bookingEnd < bookingStart was accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO results (test, status, detail)
    VALUES ('2. Reversed booking dates rejected', 'PASS', SQLERRM);
  END;
END $$;


-- -----------------------------------------------------------------------------
-- Test 3: one live inspection per type per booking; voiding frees the slot
-- -----------------------------------------------------------------------------
DO $$
DECLARE f fx%ROWTYPE;
BEGIN
  SELECT * INTO f FROM fx;

  INSERT INTO inspections (id, "bookingId", type, "startedById", "updatedAt")
  VALUES ('t3-a', 't1-a', 'HANDOVER', f.admin_id, now());

  BEGIN
    INSERT INTO inspections (id, "bookingId", type, "startedById", "updatedAt")
    VALUES ('t3-b', 't1-a', 'HANDOVER', f.admin_id, now());

    INSERT INTO results (test, status, detail)
    VALUES ('3. Second live HANDOVER inspection rejected', 'FAIL', 'two live handovers on one booking accepted');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO results (test, status, detail)
    VALUES ('3. Second live HANDOVER inspection rejected', 'PASS', SQLERRM);
  END;

  -- Void the first; the second must now be accepted.
  UPDATE inspections SET "voidedAt" = now(), "voidReason" = 'test' WHERE id = 't3-a';

  BEGIN
    INSERT INTO inspections (id, "bookingId", type, "startedById", "updatedAt")
    VALUES ('t3-c', 't1-a', 'HANDOVER', f.admin_id, now());

    INSERT INTO results (test, status, detail)
    VALUES ('3b. New HANDOVER allowed after voiding', 'PASS', 'voided inspections do not block a redo');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO results (test, status, detail)
    VALUES ('3b. New HANDOVER allowed after voiding', 'FAIL', SQLERRM);
  END;
END $$;


-- -----------------------------------------------------------------------------
-- Test 4: an asset cannot be an active member of two kits
-- -----------------------------------------------------------------------------
DO $$
DECLARE f fx%ROWTYPE;
BEGIN
  SELECT * INTO f FROM fx;

  INSERT INTO kits (id, "kitCode", name, "updatedAt")
  VALUES ('t4-kit', 'TEST-KIT', 'Constraint Test Kit', now());

  BEGIN
    INSERT INTO kit_assets (id, "kitId", "assetId")
    VALUES ('t4-ka', 't4-kit', f.asset_id);

    INSERT INTO results (test, status, detail)
    VALUES ('4. Asset in two kits rejected', 'FAIL', 'asset already in MBP-02 was added to a second kit');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO results (test, status, detail)
    VALUES ('4. Asset in two kits rejected', 'PASS', SQLERRM);
  END;
END $$;


-- -----------------------------------------------------------------------------
-- Test 5: a locked inspection cannot be edited
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  UPDATE inspections SET "lockedAt" = now(), "generalNotes" = 'signed' WHERE id = 't3-c';

  BEGIN
    UPDATE inspections SET "generalNotes" = 'tampered' WHERE id = 't3-c';

    INSERT INTO results (test, status, detail)
    VALUES ('5. Locked inspection immutable', 'FAIL', 'generalNotes changed on a locked inspection');
  EXCEPTION WHEN integrity_constraint_violation THEN
    INSERT INTO results (test, status, detail)
    VALUES ('5. Locked inspection immutable', 'PASS', SQLERRM);
  END;

  -- Voiding a locked inspection must still be allowed (that is the escape hatch).
  BEGIN
    UPDATE inspections SET "voidedAt" = now(), "voidReason" = 'admin override' WHERE id = 't3-c';

    INSERT INTO results (test, status, detail)
    VALUES ('5b. Locked inspection can still be voided', 'PASS', 'void columns remain writable');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO results (test, status, detail)
    VALUES ('5b. Locked inspection can still be voided', 'FAIL', SQLERRM);
  END;
END $$;


-- -----------------------------------------------------------------------------
-- Test 6: a signature cannot be edited
-- -----------------------------------------------------------------------------
DO $$
DECLARE f fx%ROWTYPE;
BEGIN
  SELECT * INTO f FROM fx;

  INSERT INTO signatures (id, "bookingId", "inspectionId", type, "signerRole", "signerName",
                          "imagePath", "imageHash")
  VALUES ('t6-sig', 't1-a', 't3-c', 'HANDOVER_ENGINEER', 'ENGINEER', 'Test Engineer',
          'signatures/test.png', 'deadbeef');

  BEGIN
    UPDATE signatures SET "imagePath" = 'signatures/swapped.png' WHERE id = 't6-sig';

    INSERT INTO results (test, status, detail)
    VALUES ('6. Signature immutable', 'FAIL', 'imagePath was changed on an existing signature');
  EXCEPTION WHEN integrity_constraint_violation THEN
    INSERT INTO results (test, status, detail)
    VALUES ('6. Signature immutable', 'PASS', SQLERRM);
  END;

  BEGIN
    UPDATE signatures SET "voidedAt" = now(), "voidReason" = 'test' WHERE id = 't6-sig';

    INSERT INTO results (test, status, detail)
    VALUES ('6b. Signature can be voided', 'PASS', 'void columns remain writable');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO results (test, status, detail)
    VALUES ('6b. Signature can be voided', 'FAIL', SQLERRM);
  END;
END $$;


-- -----------------------------------------------------------------------------
-- Test 7: the audit log is append-only
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  INSERT INTO audit_logs (id, action, "entityType", "actorName", summary)
  VALUES ('t7-log', 'ADMIN_OVERRIDE', 'Test', 'Tester', 'original');

  BEGIN
    UPDATE audit_logs SET summary = 'rewritten' WHERE id = 't7-log';
    INSERT INTO results (test, status, detail)
    VALUES ('7. Audit log UPDATE rejected', 'FAIL', 'audit row was updated');
  EXCEPTION WHEN integrity_constraint_violation THEN
    INSERT INTO results (test, status, detail)
    VALUES ('7. Audit log UPDATE rejected', 'PASS', SQLERRM);
  END;

  BEGIN
    DELETE FROM audit_logs WHERE id = 't7-log';
    INSERT INTO results (test, status, detail)
    VALUES ('7b. Audit log DELETE rejected', 'FAIL', 'audit row was deleted');
  EXCEPTION WHEN integrity_constraint_violation THEN
    INSERT INTO results (test, status, detail)
    VALUES ('7b. Audit log DELETE rejected', 'PASS', SQLERRM);
  END;
END $$;


-- -----------------------------------------------------------------------------
-- Test 8: numbering counter is atomic and gap-free within a transaction
-- -----------------------------------------------------------------------------
DO $$
DECLARE first_val int; second_val int;
BEGIN
  INSERT INTO number_sequences (id, scope, period, current, "updatedAt")
  VALUES (gen_random_uuid()::text, 'BOOKING', 'TEST', 1, now())
  ON CONFLICT (scope, period) DO UPDATE SET current = number_sequences.current + 1, "updatedAt" = now()
  RETURNING current INTO first_val;

  INSERT INTO number_sequences (id, scope, period, current, "updatedAt")
  VALUES (gen_random_uuid()::text, 'BOOKING', 'TEST', 1, now())
  ON CONFLICT (scope, period) DO UPDATE SET current = number_sequences.current + 1, "updatedAt" = now()
  RETURNING current INTO second_val;

  IF first_val = 1 AND second_val = 2 THEN
    INSERT INTO results (test, status, detail)
    VALUES ('8. Number sequence increments 1 -> 2', 'PASS', 'upsert-returning path used by numbering.service.ts');
  ELSE
    INSERT INTO results (test, status, detail)
    VALUES ('8. Number sequence increments 1 -> 2', 'FAIL', format('got %s then %s', first_val, second_val));
  END IF;
END $$;


-- -----------------------------------------------------------------------------
-- Test 9: seed sanity
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  kit_assets_n int; assets_n int; ext_editors_n int; real_serials_n int; gaps int;
BEGIN
  SELECT count(*) INTO kit_assets_n FROM kit_assets ka JOIN kits k ON k.id = ka."kitId" WHERE k."kitCode" = 'MBP-02';
  SELECT count(*) INTO assets_n FROM assets;
  SELECT count(*) INTO ext_editors_n FROM editor_profiles WHERE "userId" IS NULL;
  SELECT count(*) INTO real_serials_n FROM assets WHERE "serialNumber" NOT LIKE 'SN-DEMO-%';

  -- asset codes should be a contiguous AST-000001..AST-0000NN block
  SELECT count(*) INTO gaps FROM (
    SELECT substring("assetCode" FROM 5)::int AS n FROM assets
  ) s WHERE n > assets_n;

  INSERT INTO results (test, status, detail) VALUES
    ('9a. Kit MBP-02 has 12 assets',
      CASE WHEN kit_assets_n = 12 THEN 'PASS' ELSE 'FAIL' END, format('%s kit_assets rows', kit_assets_n)),
    ('9b. Two external editors without login',
      CASE WHEN ext_editors_n = 2 THEN 'PASS' ELSE 'FAIL' END, format('%s editor_profiles with userId NULL', ext_editors_n)),
    ('9c. No real-looking serial numbers',
      CASE WHEN real_serials_n = 0 THEN 'PASS' ELSE 'FAIL' END, format('%s serials not prefixed SN-DEMO-', real_serials_n)),
    ('9d. Asset codes contiguous from AST-000001',
      CASE WHEN gaps = 0 THEN 'PASS' ELSE 'FAIL' END, format('%s assets, %s codes above range', assets_n, gaps));
END $$;


-- -----------------------------------------------------------------------------
-- Report
-- -----------------------------------------------------------------------------
\set QUIET off
\pset format aligned
\pset border 2

SELECT status, test, left(detail, 90) AS detail
FROM results
ORDER BY seq;

SELECT
  count(*) FILTER (WHERE status = 'PASS') AS passed,
  count(*) FILTER (WHERE status = 'FAIL') AS failed,
  count(*)                                AS total
FROM results;

-- Leave the database exactly as we found it.
ROLLBACK;
