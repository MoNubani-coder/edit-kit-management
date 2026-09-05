-- =============================================================================
-- Database integrity verification
-- =============================================================================
-- Proves that the constraints in migrations
-- 20260903000100_integrity_constraints_and_search_indexes and
-- 20260903000200_maintenance_records actually reject what they are supposed to
-- reject. Run against a migrated + seeded database:
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
  (SELECT id FROM assets          WHERE "serialNumber" = 'SN-DEMO-MBP02-0001')      AS asset_id,
  (SELECT "categoryId" FROM assets WHERE "serialNumber" = 'SN-DEMO-MBP02-0001')     AS category_id;

DO $$
DECLARE f fx%ROWTYPE;
BEGIN
  SELECT * INTO f FROM fx;
  IF f.kit_id IS NULL OR f.editor_id IS NULL OR f.engineer_id IS NULL
     OR f.admin_id IS NULL OR f.asset_id IS NULL OR f.category_id IS NULL THEN
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
-- Test 1c: an adjacent RESERVED booking is allowed - it starts at the very
-- instant the previous one (t1-a, ending 2030-10-10T17:00:00Z) ends. The
-- window is half-open, [start, end), so the boundary instant belongs to the
-- later booking only (Phase 7, migration 20260905230000).
-- -----------------------------------------------------------------------------
DO $$
DECLARE f fx%ROWTYPE;
BEGIN
  SELECT * INTO f FROM fx;
  BEGIN
    INSERT INTO bookings (id, "bookingNumber", "kitId", "editorId", "engineerId", status,
                          "bookingStart", "bookingEnd", "expectedReturnDate", "createdById", "updatedAt")
    VALUES ('t1-d', 'BK-TEST-000004', f.kit_id, f.editor_id, f.engineer_id, 'RESERVED',
            '2030-10-10T17:00:00Z', '2030-10-20T17:00:00Z', '2030-10-20T17:00:00Z', f.admin_id, now());

    INSERT INTO results (test, status, detail)
    VALUES ('1c. Adjacent booking allowed', 'PASS', 'starts the instant the previous one ends - half-open window');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO results (test, status, detail)
    VALUES ('1c. Adjacent booking allowed', 'FAIL', SQLERRM);
  END;
END $$;


-- -----------------------------------------------------------------------------
-- Test 1d: a zero-length booking (start = end) is rejected. With a half-open
-- range it would be empty and collide with nothing, so the period must be
-- strictly ordered.
-- -----------------------------------------------------------------------------
DO $$
DECLARE f fx%ROWTYPE;
BEGIN
  SELECT * INTO f FROM fx;
  BEGIN
    INSERT INTO bookings (id, "bookingNumber", "kitId", "editorId", "engineerId", status,
                          "bookingStart", "bookingEnd", "expectedReturnDate", "createdById", "updatedAt")
    VALUES ('t1-e', 'BK-TEST-000105', f.kit_id, f.editor_id, f.engineer_id, 'RESERVED',
            '2030-11-01T08:00:00Z', '2030-11-01T08:00:00Z', '2030-11-01T08:00:00Z', f.admin_id, now());

    INSERT INTO results (test, status, detail)
    VALUES ('1d. Zero-length booking rejected', 'FAIL', 'bookingEnd = bookingStart was accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO results (test, status, detail)
    VALUES ('1d. Zero-length booking rejected', 'PASS', SQLERRM);
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
-- Test 8b: the MAINTENANCE numbering scope exists and increments
-- -----------------------------------------------------------------------------
DO $$
DECLARE first_val int; second_val int;
BEGIN
  INSERT INTO number_sequences (id, scope, period, current, "updatedAt")
  VALUES (gen_random_uuid()::text, 'MAINTENANCE', 'TEST', 1, now())
  ON CONFLICT (scope, period) DO UPDATE SET current = number_sequences.current + 1, "updatedAt" = now()
  RETURNING current INTO first_val;

  INSERT INTO number_sequences (id, scope, period, current, "updatedAt")
  VALUES (gen_random_uuid()::text, 'MAINTENANCE', 'TEST', 1, now())
  ON CONFLICT (scope, period) DO UPDATE SET current = number_sequences.current + 1, "updatedAt" = now()
  RETURNING current INTO second_val;

  IF first_val = 1 AND second_val = 2 THEN
    INSERT INTO results (test, status, detail)
    VALUES ('8b. MAINTENANCE scope increments 1 -> 2', 'PASS', 'NumberScope.MAINTENANCE accepted by number_sequences');
  ELSE
    INSERT INTO results (test, status, detail)
    VALUES ('8b. MAINTENANCE scope increments 1 -> 2', 'FAIL', format('got %s then %s', first_val, second_val));
  END IF;
END $$;


-- -----------------------------------------------------------------------------
-- Test 9: seed sanity
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  kit_assets_n int; assets_n int; ext_editors_n int; real_serials_n int; gaps int;
  maint_n int; maint_bad_n int; maint_scheduled_ok bool;
BEGIN
  SELECT count(*) INTO kit_assets_n FROM kit_assets ka JOIN kits k ON k.id = ka."kitId" WHERE k."kitCode" = 'MBP-02';
  SELECT count(*) INTO assets_n FROM assets;
  SELECT count(*) INTO ext_editors_n FROM editor_profiles WHERE "userId" IS NULL;
  SELECT count(*) INTO real_serials_n FROM assets WHERE "serialNumber" NOT LIKE 'SN-DEMO-%';

  -- asset codes should be a contiguous AST-000001..AST-0000NN block
  SELECT count(*) INTO gaps FROM (
    SELECT substring("assetCode" FROM 5)::int AS n FROM assets
  ) s WHERE n > assets_n;

  -- every maintenance number must follow the MNT-YYYY-NNNNNN format
  SELECT count(*), count(*) FILTER (WHERE "maintenanceNumber" !~ '^MNT-\d{4}-\d{6}$')
    INTO maint_n, maint_bad_n
  FROM maintenance_records;

  -- the seeded calibration is SCHEDULED, so its asset must still be bookable
  SELECT (m.status = 'SCHEDULED' AND a.status = 'AVAILABLE')
    INTO maint_scheduled_ok
  FROM maintenance_records m
  JOIN assets a ON a.id = m."assetId"
  WHERE a."serialNumber" = 'SN-DEMO-MBP02-0009' AND m."deletedAt" IS NULL
  ORDER BY m."createdAt"
  LIMIT 1;

  INSERT INTO results (test, status, detail) VALUES
    ('9a. Kit MBP-02 has 12 assets',
      CASE WHEN kit_assets_n = 12 THEN 'PASS' ELSE 'FAIL' END, format('%s kit_assets rows', kit_assets_n)),
    ('9b. Two external editors without login',
      CASE WHEN ext_editors_n = 2 THEN 'PASS' ELSE 'FAIL' END, format('%s editor_profiles with userId NULL', ext_editors_n)),
    ('9c. No real-looking serial numbers',
      CASE WHEN real_serials_n = 0 THEN 'PASS' ELSE 'FAIL' END, format('%s serials not prefixed SN-DEMO-', real_serials_n)),
    ('9d. Asset codes contiguous from AST-000001',
      CASE WHEN gaps = 0 THEN 'PASS' ELSE 'FAIL' END, format('%s assets, %s codes above range', assets_n, gaps)),
    ('9e. Maintenance numbers are MNT-YYYY-NNNNNN',
      CASE WHEN maint_n >= 1 AND maint_bad_n = 0 THEN 'PASS' ELSE 'FAIL' END, format('%s records, %s malformed', maint_n, maint_bad_n)),
    ('9f. Seeded calibration is SCHEDULED, asset still AVAILABLE',
      CASE WHEN maint_scheduled_ok THEN 'PASS' ELSE 'FAIL' END, 'a scheduled record must not take the asset out of service');
END $$;


-- -----------------------------------------------------------------------------
-- Test 10: maintenance records
-- -----------------------------------------------------------------------------
-- Uses a fresh asset: every seeded asset belongs to MBP-02, so a delete would
-- trip the kit_assets FK before ever reaching the maintenance one.
DO $$
DECLARE f fx%ROWTYPE;
BEGIN
  SELECT * INTO f FROM fx;

  INSERT INTO assets (id, "assetCode", "categoryId", name, "updatedAt")
  VALUES ('t10-asset', 'AST-TEST01', f.category_id, 'Constraint Test Asset', now());

  -- 10a. completed before it started
  BEGIN
    INSERT INTO maintenance_records (id, "maintenanceNumber", "assetId", type, status, title,
                                     "startedAt", "completedAt", "createdById", "updatedAt")
    VALUES ('t10-a', 'MNT-TEST-000001', 't10-asset', 'REPAIR', 'COMPLETED', 'reversed dates',
            '2030-01-10T10:00:00Z', '2030-01-01T10:00:00Z', f.admin_id, now());

    INSERT INTO results (test, status, detail)
    VALUES ('10a. Maintenance completed before it started rejected', 'FAIL', 'completedAt < startedAt was accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO results (test, status, detail)
    VALUES ('10a. Maintenance completed before it started rejected', 'PASS', SQLERRM);
  END;

  -- 10b. COMPLETED without a completion date
  BEGIN
    INSERT INTO maintenance_records (id, "maintenanceNumber", "assetId", type, status, title, "createdById", "updatedAt")
    VALUES ('t10-b', 'MNT-TEST-000002', 't10-asset', 'REPAIR', 'COMPLETED', 'no completedAt', f.admin_id, now());

    INSERT INTO results (test, status, detail)
    VALUES ('10b. COMPLETED without completedAt rejected', 'FAIL', 'COMPLETED with NULL completedAt was accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO results (test, status, detail)
    VALUES ('10b. COMPLETED without completedAt rejected', 'PASS', SQLERRM);
  END;

  -- 10c. IN_PROGRESS without a start date
  BEGIN
    INSERT INTO maintenance_records (id, "maintenanceNumber", "assetId", type, status, title, "createdById", "updatedAt")
    VALUES ('t10-c', 'MNT-TEST-000003', 't10-asset', 'REPAIR', 'IN_PROGRESS', 'no startedAt', f.admin_id, now());

    INSERT INTO results (test, status, detail)
    VALUES ('10c. IN_PROGRESS without startedAt rejected', 'FAIL', 'IN_PROGRESS with NULL startedAt was accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO results (test, status, detail)
    VALUES ('10c. IN_PROGRESS without startedAt rejected', 'PASS', SQLERRM);
  END;

  -- 10d. negative cost
  BEGIN
    INSERT INTO maintenance_records (id, "maintenanceNumber", "assetId", type, status, title, cost, "createdById", "updatedAt")
    VALUES ('t10-d', 'MNT-TEST-000004', 't10-asset', 'REPAIR', 'SCHEDULED', 'negative cost', -1.00, f.admin_id, now());

    INSERT INTO results (test, status, detail)
    VALUES ('10d. Negative maintenance cost rejected', 'FAIL', 'cost = -1.00 was accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO results (test, status, detail)
    VALUES ('10d. Negative maintenance cost rejected', 'PASS', SQLERRM);
  END;

  -- 10e. currency must be an upper-case ISO 4217 code
  BEGIN
    INSERT INTO maintenance_records (id, "maintenanceNumber", "assetId", type, status, title, currency, "createdById", "updatedAt")
    VALUES ('t10-e', 'MNT-TEST-000005', 't10-asset', 'REPAIR', 'SCHEDULED', 'bad currency', 'aed', f.admin_id, now());

    INSERT INTO results (test, status, detail)
    VALUES ('10e. Lower-case currency code rejected', 'FAIL', 'currency = aed was accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO results (test, status, detail)
    VALUES ('10e. Lower-case currency code rejected', 'PASS', SQLERRM);
  END;

  -- 10f / 10g. one actively-underway record per asset; further SCHEDULED ones are fine
  INSERT INTO maintenance_records (id, "maintenanceNumber", "assetId", type, status, title, "startedAt", "createdById", "updatedAt")
  VALUES ('t10-f1', 'MNT-TEST-000006', 't10-asset', 'REPAIR', 'IN_PROGRESS', 'first repair', now(), f.admin_id, now());

  BEGIN
    INSERT INTO maintenance_records (id, "maintenanceNumber", "assetId", type, status, title, "startedAt", "createdById", "updatedAt")
    VALUES ('t10-f2', 'MNT-TEST-000007', 't10-asset', 'CALIBRATION', 'IN_PROGRESS', 'second, concurrent', now(), f.admin_id, now());

    INSERT INTO results (test, status, detail)
    VALUES ('10f. Second IN_PROGRESS maintenance on one asset rejected', 'FAIL', 'two live IN_PROGRESS records on one asset accepted');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO results (test, status, detail)
    VALUES ('10f. Second IN_PROGRESS maintenance on one asset rejected', 'PASS', SQLERRM);
  END;

  BEGIN
    INSERT INTO maintenance_records (id, "maintenanceNumber", "assetId", type, status, title, "scheduledFor", "createdById", "updatedAt")
    VALUES ('t10-g', 'MNT-TEST-000008', 't10-asset', 'CALIBRATION', 'SCHEDULED', 'planned for later', now() + interval '30 days', f.admin_id, now());

    INSERT INTO results (test, status, detail)
    VALUES ('10g. SCHEDULED maintenance alongside IN_PROGRESS allowed', 'PASS', 'only actively-underway records are exclusive');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO results (test, status, detail)
    VALUES ('10g. SCHEDULED maintenance alongside IN_PROGRESS allowed', 'FAIL', SQLERRM);
  END;

  -- 10h. an asset with maintenance history cannot be hard-deleted
  BEGIN
    DELETE FROM assets WHERE id = 't10-asset';

    INSERT INTO results (test, status, detail)
    VALUES ('10h. Asset with maintenance history cannot be deleted', 'FAIL', 'asset row deleted despite maintenance_records');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO results (test, status, detail)
    VALUES ('10h. Asset with maintenance history cannot be deleted', 'PASS', SQLERRM);
  END;
END $$;


-- -----------------------------------------------------------------------------
-- Test 10i: the optional Issue link is nulled, not cascaded, when the issue goes
-- -----------------------------------------------------------------------------
DO $$
DECLARE f fx%ROWTYPE; linked text; remaining int;
BEGIN
  SELECT * INTO f FROM fx;

  INSERT INTO issues (id, "issueNumber", type, title, description, "assetId", "reportedById", "updatedAt")
  VALUES ('t10-issue', 'ISS-TEST-000001', 'MALFUNCTION', 'Flickering panel', 'Backlight flickers after warm-up',
          't10-asset', f.admin_id, now());

  INSERT INTO maintenance_records (id, "maintenanceNumber", "assetId", "issueId", type, status, title,
                                   "scheduledFor", "createdById", "updatedAt")
  VALUES ('t10-i', 'MNT-TEST-000009', 't10-asset', 't10-issue', 'REPAIR', 'SCHEDULED', 'Backlight repair',
          now() + interval '7 days', f.admin_id, now());

  SELECT "issueId" INTO linked FROM maintenance_records WHERE id = 't10-i';

  DELETE FROM issues WHERE id = 't10-issue';

  SELECT count(*) INTO remaining FROM maintenance_records WHERE id = 't10-i' AND "issueId" IS NULL;

  IF linked = 't10-issue' AND remaining = 1 THEN
    INSERT INTO results (test, status, detail)
    VALUES ('10i. Maintenance survives removal of its linked issue', 'PASS', 'issueId set to NULL, record retained (ON DELETE SET NULL)');
  ELSE
    INSERT INTO results (test, status, detail)
    VALUES ('10i. Maintenance survives removal of its linked issue', 'FAIL', format('linked=%s remaining=%s', linked, remaining));
  END IF;
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
