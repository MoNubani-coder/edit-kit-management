import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'

import { requirePermissionForPage } from '@/server/auth/page-guards'
import { resolveScannedKit } from '@/server/services/kits.service'
import { prisma } from '@/server/db/prisma'

export const metadata: Metadata = { title: 'Kit' }

export const dynamic = 'force-dynamic'

/**
 * Where a scanned kit label lands.
 *
 * The QR on the case encodes `/k/<kit id>` and nothing else. This page is not
 * public: the proxy sends an anonymous scan to the login page with this path
 * as the callback, so the engineer signs in on their phone and arrives at the
 * kit. With a session and `kit.read` it resolves the id and redirects to the
 * kit workspace; an unknown, removed or malformed id is a plain 404, which
 * tells a stranger holding the case nothing.
 *
 * A kit code is accepted as well, so labels printed from an older sticker run
 * (or typed by hand) still work.
 */
export default async function ScannedKitPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermissionForPage('kit.read')
  const { id } = await params

  const kit = await resolveScannedKit(prisma, id)
  if (!kit) notFound()

  redirect(`/kits/${kit.id}`)
}
