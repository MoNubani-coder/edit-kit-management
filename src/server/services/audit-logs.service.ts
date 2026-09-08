import 'server-only'

import type { Actor } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/session'
import { env } from '@/lib/env'
import type { AuditListParams } from '@/lib/validation/audit'
import { type AuditActorOption, auditLogSpan, type AuditLogResult, listAuditActors, listAuditLogPage } from '@/server/dal/audit.dal'
import { prisma } from '@/server/db/prisma'

/**
 * Reading the audit log.
 *
 * There is one function and it authorises before it reads, because the log is
 * the one place where every actor's activity sits side by side: who signed in
 * and failed, who cancelled whose booking, whose account was suspended. That
 * is an administrator's view and nobody else's, so the gate is
 * `admin.audit.read` and there is no scoped variant - a role that may see part
 * of the log does not exist.
 *
 * There is deliberately no write half and no actions file. The log is
 * append-only in the database, and nothing in the application should be able
 * to edit or remove an entry, including an administrator holding this page.
 */

export interface AuditLogPage {
  actor: Actor
  result: AuditLogResult
  actors: AuditActorOption[]
  span: { total: number; earliest: Date | null; latest: Date | null }
  timeZone: string
}

export async function loadAuditLogPage(params: AuditListParams): Promise<AuditLogPage> {
  const actor = await requirePermission('admin.audit.read')
  const timeZone = env.APP_TIMEZONE

  const [result, actors, span] = await Promise.all([
    listAuditLogPage(prisma, params, timeZone),
    listAuditActors(prisma),
    auditLogSpan(prisma),
  ])

  return { actor, result, actors, span, timeZone }
}
