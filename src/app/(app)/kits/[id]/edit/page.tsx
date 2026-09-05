import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { PageHeader } from '@/components/common/page-header'
import { Alert } from '@/components/ui/alert'
import { KitForm } from '@/features/kits/components/kit-form'
import { requirePermissionForPage } from '@/server/auth/page-guards'
import { prisma } from '@/server/db/prisma'
import { loadKitWorkspace } from '@/server/services/kits.service'

export const metadata: Metadata = { title: 'Edit kit' }

export const dynamic = 'force-dynamic'

export default async function EditKitPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermissionForPage('kit.manage')
  const { id } = await params

  const workspace = await loadKitWorkspace(prisma, actor, id)
  if (!workspace || workspace.kit.deletedAt) notFound()

  const { kit, allowedStatuses, lifecycle } = workspace
  const controlled = lifecycle.status === 'RESERVED' || lifecycle.status === 'CHECKED_OUT'

  return (
    <>
      <PageHeader eyebrow={`Operations / Kits / ${kit.kitCode} / Edit`} title={`Edit ${kit.kitCode}`} description={kit.name} />
      <div className="max-w-4xl space-y-6">
        {controlled ? (
          <Alert variant="info" title="Controlled by a booking">
            Status is managed by the booking, handover and return workflows while the kit is {lifecycle.status === 'RESERVED' ? 'reserved' : 'checked out'}. Its details can still be corrected.
          </Alert>
        ) : null}
        {!controlled && lifecycle.memberCount > 0 ? (
          <Alert variant="info" title="Retiring needs an empty kit">
            Remove all equipment from the kit before retiring it, so every asset returns to the available pool.
          </Alert>
        ) : null}
        <KitForm
          mode="edit"
          values={{
            id: kit.id,
            kitCode: kit.kitCode,
            name: kit.name,
            admBarcode: kit.admBarcode ?? '',
            location: kit.location ?? '',
            description: kit.description ?? '',
            notes: kit.notes ?? '',
            suitcaseStatus: kit.suitcaseStatus,
            status: kit.status,
          }}
          allowedStatuses={allowedStatuses}
          cancelHref={`/kits/${kit.id}`}
        />
      </div>
    </>
  )
}
