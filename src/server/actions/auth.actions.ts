'use server'

import { AuditAction } from '@prisma/client'
import { AuthError, CredentialsSignin } from 'next-auth'
import { headers } from 'next/headers'

import { loginFieldErrors, loginSchema, type LoginFormState } from '@/lib/validation/auth'
import { signIn, signOut } from '@/server/auth/auth'
import { requestContextFrom } from '@/server/auth/credentials'
import { LOGIN_PATH, safeRedirectPath } from '@/server/auth/route-policy'
import { getCurrentUser } from '@/server/auth/session'
import { messageForSignInCode } from '@/server/auth/sign-in-codes'
import { prisma } from '@/server/db/prisma'
import { recordAudit } from '@/server/services/audit.service'

/**
 * Sign-in and sign-out Server Actions.
 *
 * These are the only two mutations that are *not* built with the `action()`
 * wrapper: sign-in has no actor yet, and sign-out's whole job is to discard
 * one. Everything else must use the wrapper.
 */

export async function signInAction(
  _previous: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const parsed = loginSchema.safeParse({
    username: formData.get('username'),
    password: formData.get('password'),
    callbackUrl: formData.get('callbackUrl') ?? undefined,
  })

  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Check the highlighted fields.',
      fieldErrors: loginFieldErrors(parsed.error),
    }
  }

  const { username, password, callbackUrl } = parsed.data

  try {
    // On success Auth.js sets the session cookie and throws a redirect, which
    // propagates out of this action to the router.
    await signIn('credentials', {
      username,
      password,
      redirectTo: safeRedirectPath(callbackUrl),
    })
  } catch (error) {
    if (!(error instanceof AuthError)) throw error

    if (error instanceof CredentialsSignin) {
      return { status: 'error', message: messageForSignInCode(error.code) }
    }

    console.error('[auth] sign-in failed', error)
    return { status: 'error', message: 'Sign-in is unavailable right now. Please try again.' }
  }

  // Unreachable: a successful signIn redirects. Kept for type completeness.
  return { status: 'idle' }
}

export async function signOutAction(): Promise<void> {
  const actor = await getCurrentUser()

  if (actor) {
    await recordAudit(prisma, {
      action: AuditAction.LOGOUT,
      entityType: 'User',
      entityId: actor.id,
      actorUserId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      summary: `${actor.email} signed out`,
      ...requestContextFrom(await headers()),
    })
  }

  await signOut({ redirectTo: LOGIN_PATH })
}
