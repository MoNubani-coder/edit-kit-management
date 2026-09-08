import { Pencil } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { PageHeader } from '@/components/common/page-header'
import { SectionTabs } from '@/components/common/section-tabs'
import { KitStatusBadge } from '@/components/common/status-badge'
import { Alert } from '@/components/ui/alert'
import { buttonVariants } from '@/components/ui/button'
import { KitAvailabilityBadge } from '@/features/kits/components/availability-badge'
import { ChecklistPanel } from '@/features/kits/components/checklist-panel'
import { EquipmentPanel } from '@/features/kits/components/equipment-panel'
import { RemoveKitForm } from '@/features/kits/components/kit-action-forms'
import { KitHistory } from '@/features/kits/components/kit-history'
import { KitOperationsPanel } from '@/features/kits/components/kit-operations-panel'
import { KitOverview } from '@/features/kits/components/kit-overview'
import { KitQrPanel } from '@/features/kits/components/kit-qr-panel'
import { kitHref } from '@/features/kits/hrefs'
import { formatDateTime } from '@/lib/datetime'
import { env } from '@/lib/env'
import { KIT_TAB_LABELS, KIT_TABS, parseKitTab } from '@/lib/validation/kits'
import { requirePermissionForPage } from '@/server/auth/page-guards'
import { prisma } from '@/server/db/prisma'
import {
  kitOperations,
  loadAssetCandidates,
  loadChecklistPreview,
  loadKitChecklistOptions,
  loadKitWorkspace,
} from '@/server/services/kits.service'
import { kitQrCode } from '@/server/services/qr.service'
import { can } from '@/server/auth/permissions'

export const metadata: Metadata = { title: 'Kit' }

export const dynamic = 'force-dynamic'

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/**
 * The kit workspace: header with identity and readiness, then Overview,
 * Equipment, Checklist and History tabs driven by `?tab=`. Form
 * state (which member is being edited, whether the picker is open and what it
 * searched for) also lives in the URL.
 */
export default async function KitDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const actor = await requirePermissionForPage('kit.read')
  const { id } = await params
  const query = await searchParams

  const workspace = await loadKitWorkspace(prisma, actor, id)
  if (!workspace) notFound()

  const { kit, availability, history, canManage, removalBlocker, membersBlocker, memberRemovalBlockers } = workspace
  const timeZone = env.APP_TIMEZONE
  const now = new Date()
  const removed = kit.deletedAt !== null
  const manageable = canManage && !removed
  const tab = parseKitTab(query.tab)

  // Equipment tab state
  const editingMember = tab === 'equipment' && manageable ? first(query.member) ?? null : null
  const pickTerm = tab === 'equipment' ? (first(query.pick) ?? '').trim() : ''
  const pickerOpen = tab === 'equipment' && manageable && !membersBlocker && (first(query.add) === '1' || pickTerm.length > 0)
  const candidates = pickerOpen && pickTerm ? await loadAssetCandidates(prisma, id, pickTerm) : []

  // Checklist tab options. Software is no longer an operational tab: verification
  // does not gate a handover, so the list stays on the record but is not shown.
  const templates = tab === 'checklist' ? await loadKitChecklistOptions(prisma) : []
  const fallbackTemplate = templates.find((template) => template.isDefault) ?? null
  const effectiveTemplateId = kit.checklistTemplate?.id ?? fallbackTemplate?.id ?? null
  const checklistItems = tab === 'checklist' && effectiveTemplateId ? await loadChecklistPreview(prisma, effectiveTemplateId) : []

  const counts: Partial<Record<(typeof KIT_TABS)[number], number>> = {
    equipment: kit.members.length,
    checklist: kit.checklistTemplate?.itemCount,
    history: history.length,
  }
  const tabs = KIT_TABS.map((key) => ({ key, label: KIT_TAB_LABELS[key], href: kitHref(kit.id, key), count: counts[key] }))

  // What a scan should answer immediately: where the kit stands and what to do
  // next. The label is only worth showing for a kit that still exists.
  const operations = kitOperations({ kit: { id: kit.id, status: kit.status, deleted: removed }, availability, liveBooking: kit.liveBooking, actor })
  const qr = removed ? null : await kitQrCode(kit.id)

  return (
    <>
      <PageHeader
        eyebrow={`Operations / Kits / ${kit.kitCode}`}
        title={kit.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-foreground">{kit.kitCode}</span>
            <KitStatusBadge status={kit.status} />
            <KitAvailabilityBadge availability={availability} />
            <span>
              {availability.memberCount} {availability.memberCount === 1 ? 'item' : 'items'}
              {kit.admBarcode ? (
                <>
                  {' '}
                  · <span className="font-mono">{kit.admBarcode}</span>
                </>
              ) : null}
            </span>
          </span>
        }
        actions={
          manageable ? (
            <>
              <RemoveKitForm kitId={kit.id} kitCode={kit.kitCode} blocker={removalBlocker} />
              <Link href={`/kits/${kit.id}/edit`} className={buttonVariants({ variant: 'secondary' })}>
                <Pencil aria-hidden className="h-4 w-4" />
                Edit
              </Link>
            </>
          ) : null
        }
      />

      <div className="space-y-6">
        {removed ? (
          <Alert variant="warning" title="Removed from inventory">
            This kit was removed on {formatDateTime(kit.deletedAt!, timeZone)}. Its history is kept; it no longer appears in lists and cannot be booked.
          </Alert>
        ) : null}

        <KitOperationsPanel
          kit={{ id: kit.id, kitCode: kit.kitCode, name: kit.name, status: kit.status, admBarcode: kit.admBarcode }}
          availability={availability}
          liveBooking={kit.liveBooking}
          operations={operations}
          timeZone={timeZone}
          canReadEditor={can(actor, 'editor.read')}
        />

        <SectionTabs label="Kit sections" tabs={tabs} active={tab} />

        {tab === 'overview' ? (
          <>
            <KitOverview kit={kit} availability={availability} timeZone={timeZone} />
            {qr ? <KitQrPanel kit={{ id: kit.id, kitCode: kit.kitCode, name: kit.name }} qr={qr} /> : null}
          </>
        ) : null}
        {tab === 'equipment' ? (
          <EquipmentPanel
            kit={kit}
            availability={availability}
            canManage={manageable}
            membersBlocker={membersBlocker}
            memberRemovalBlockers={memberRemovalBlockers}
            editing={editingMember}
            picker={pickerOpen ? { open: true, term: pickTerm, candidates } : null}
          />
        ) : null}
        {tab === 'checklist' ? (
          <ChecklistPanel kitId={kit.id} template={kit.checklistTemplate} fallback={fallbackTemplate} items={checklistItems} options={templates} canManage={manageable} />
        ) : null}
        {tab === 'history' ? <KitHistory events={history} timeZone={timeZone} now={now} /> : null}
      </div>
    </>
  )
}
