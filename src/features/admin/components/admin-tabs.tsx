import { SectionTabs } from '@/components/common/section-tabs'
import { ADMIN_NAV } from '@/lib/constants/navigation'
import { canAny } from '@/server/auth/permissions'
import type { Actor } from '@/server/auth/session'

/** Horizontal tabs across the administration sections the actor may open. */
export function AdminTabs({ actor, active }: { actor: Actor; active: string | null }) {
  const tabs = ADMIN_NAV.filter((item) => canAny(actor, item.anyOf)).map((item) => ({
    key: item.href,
    label: item.label,
    href: item.href,
  }))

  return <SectionTabs tabs={tabs} active={active} label="Administration sections" />
}
