import type { Metadata } from 'next'

import { ForbiddenView } from '@/components/common/status-page'

export const metadata: Metadata = { title: 'Access denied' }

/**
 * Target of the proxy's 403 rewrite for signed-in users who lack the
 * permission a route requires. The shell layout has already confirmed the
 * session; the page that was requested would have reached the same 403.
 */
export default function ForbiddenPage() {
  return <ForbiddenView />
}
