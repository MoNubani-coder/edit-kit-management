import type { AuditAction, Prisma, UserRole } from '@prisma/client'

import type { Db } from '@/server/db/prisma'

/**
 * Audit trail writer.
 *
 * One entry per state change or security-relevant event. Actor identity is
 * snapshotted (`actorName`, `actorRole`) so the log stays readable after the
 * user is deleted. The table is append-only at the database level (see
 * migration 20260903000100), so there is no update or delete here by design.
 *
 * Callers pass the transaction client when the audit entry must commit or roll
 * back together with the change it describes.
 */

export interface AuditEntry {
  action: AuditAction
  entityType: string
  entityId?: string | null

  actorUserId?: string | null
  actorName: string
  actorRole?: UserRole | null

  summary?: string
  previousValue?: Prisma.InputJsonValue
  newValue?: Prisma.InputJsonValue
  metadata?: Prisma.InputJsonValue

  ipAddress?: string | null
  userAgent?: string | null
}

export async function recordAudit(db: Db, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      actorUserId: entry.actorUserId ?? null,
      actorName: entry.actorName,
      actorRole: entry.actorRole ?? null,
      summary: entry.summary ?? null,
      previousValue: entry.previousValue,
      newValue: entry.newValue,
      metadata: entry.metadata,
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent ?? null,
    },
  })
}
