import type { Actor } from '@/server/auth/session'
import type { Db } from '@/server/db/prisma'
import { getBookingChecklistItems } from '@/server/dal/handover.dal'
import { prepareChecklist } from '@/server/services/bookings.service'

/**
 * Prepares a booking's checklist the way an engineer does before the kit is set
 * aside: every handover-phase check passed. The checklist moved before the
 * handover in the user-directed review (2026-09-08); every scenario that marks
 * a booking ready has to have done this first, exactly as the real flow does.
 */
export async function prepareChecklistFor(db: Db, actor: Actor, bookingId: string): Promise<void> {
  const items = await getBookingChecklistItems(db, bookingId)
  const checks = items.filter((item) => item.phase !== 'RETURN').map((item) => ({ id: item.id, status: 'PASS' as const, notes: undefined }))
  if (checks.length > 0) await prepareChecklist(db, actor, bookingId, { checks })
}
