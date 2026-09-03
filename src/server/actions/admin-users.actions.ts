'use server'

import { AuditAction, UserStatus } from '@prisma/client'
import { headers } from 'next/headers'
import { z } from 'zod'

import { action, ActionError } from '@/server/auth/action'
import { requestContextFrom } from '@/server/auth/credentials'
import { prisma } from '@/server/db/prisma'
import { recordAudit } from '@/server/services/audit.service'

/**
 * Account administration.
 *
 * `setUserStatus` is the one admin mutation that belongs to the authentication
 * phase: suspending or disabling an account must take effect immediately, so
 * it also bumps `sessionVersion`, which invalidates every session that user
 * holds on their next request. Re-activating clears any lockout.
 *
 * The user-management screens arrive in a later phase; this action is what
 * they will call.
 */

const setUserStatusSchema = z.object({
  userId: z.string().min(1, 'Select a user.'),
  status: z.enum([UserStatus.ACTIVE, UserStatus.SUSPENDED, UserStatus.DISABLED]),
  reason: z.string().trim().max(500).optional(),
})

export type SetUserStatusInput = z.input<typeof setUserStatusSchema>

const setUserStatusAction = action({
  permission: 'admin.users.manage',
  schema: setUserStatusSchema,

  async handler({ actor, input }) {
    if (input.userId === actor.id) {
      throw new ActionError('You cannot change the status of your own account.')
    }

    const context = requestContextFrom(await headers())

    return prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: input.userId },
        select: { id: true, email: true, status: true, deletedAt: true },
      })

      if (!target || target.deletedAt) {
        throw new ActionError('User not found.')
      }

      const updated = await tx.user.update({
        where: { id: target.id },
        data: {
          status: input.status,
          // Existing sessions die on their next request (AD-2).
          sessionVersion: { increment: 1 },
          ...(input.status === UserStatus.ACTIVE ? { failedLoginAttempts: 0, lockedUntil: null } : {}),
        },
        select: { id: true, email: true, status: true },
      })

      await recordAudit(tx, {
        action: AuditAction.UPDATE,
        entityType: 'User',
        entityId: target.id,
        actorUserId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        summary: `${actor.email} set ${target.email} to ${input.status}`,
        previousValue: { status: target.status },
        newValue: { status: input.status },
        metadata: input.reason ? { reason: input.reason } : undefined,
        ...context,
      })

      return updated
    })
  },
})

export async function setUserStatus(input: unknown) {
  return setUserStatusAction(input)
}
