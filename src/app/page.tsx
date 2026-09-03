import { redirect } from 'next/navigation'

import { HOME_PATH, LOGIN_PATH } from '@/server/auth/route-policy'
import { getCurrentUser } from '@/server/auth/session'

export const dynamic = 'force-dynamic'

/**
 * The root is a dispatcher: signed-in users go to the dashboard, everyone else
 * to sign-in. The proxy normally answers this before rendering; this is the
 * fallback for direct renders.
 */
export default async function RootPage() {
  const actor = await getCurrentUser()
  redirect(actor ? HOME_PATH : LOGIN_PATH)
}
