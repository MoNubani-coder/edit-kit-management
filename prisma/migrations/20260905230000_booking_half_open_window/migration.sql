-- Phase 7 boundary fix: adjacent bookings on one kit.
--
-- The original exclusion constraint used a closed range, '[]', so a booking
-- ending at 12:00 and the next one starting at 12:00 collided. The booking
-- window is half-open, [start, end): the kit is held from the start instant up
-- to, but not including, the end instant, so back-to-back bookings are allowed
-- while any genuine overlap is still refused. The constraint keeps its name,
-- so the application's error translation is unchanged.
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_no_overlapping_period_per_kit";

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_no_overlapping_period_per_kit"
  EXCLUDE USING gist (
    "kitId" WITH =,
    tstzrange("bookingStart", "bookingEnd", '[)') WITH &&
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

-- With a half-open range a zero-length booking (start = end) is an empty range
-- that collides with nothing, so the period must now be strictly ordered.
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_period_is_ordered";

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_period_is_ordered"
  CHECK ("bookingEnd" > "bookingStart");
