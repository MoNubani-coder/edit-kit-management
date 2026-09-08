import { canAny, type Permission, type PermissionSubject } from '@/server/auth/permissions'

/**
 * Navigation definition. Data, not JSX, so the server layout can filter it by
 * permission and hand a plain serialisable list to the client command bar. Icons
 * are referenced by name for the same reason - a React component cannot cross
 * the server/client boundary as a prop.
 *
 * Hiding an entry here is a courtesy to the user, not a security control.
 * Every route re-checks permissions on the server.
 */

export type NavIcon =
  | 'dashboard'
  | 'bookings'
  | 'kits'
  | 'assets'
  | 'editors'
  | 'issues'
  | 'reports'
  | 'users'
  | 'categories'
  | 'software'
  | 'checklists'
  | 'audit'
  | 'settings'

export interface NavItem {
  href: string
  label: string
  icon: NavIcon
  /** One line shown on landing pages such as /admin. */
  description: string
  /** Visible when the actor holds at least one of these. */
  anyOf: readonly Permission[]
}

/** What the client shell receives: no permission names cross the boundary. */
export interface NavLink {
  href: string
  label: string
  icon: NavIcon
}

export interface NavSection {
  title: string | null
  items: readonly NavLink[]
}

export const MAIN_NAV: readonly NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: 'dashboard', description: 'Operational overview', anyOf: ['dashboard.view'] },
  { href: '/bookings', label: 'Bookings', icon: 'bookings', description: 'Reservations, handovers and returns', anyOf: ['booking.read', 'booking.readOwn'] },
  { href: '/kits', label: 'Kits', icon: 'kits', description: 'Kit availability and contents', anyOf: ['kit.read'] },
  { href: '/assets', label: 'Equipment', icon: 'assets', description: 'Assets, accessories and maintenance', anyOf: ['asset.read'] },
  // Editors was removed from the primary navigation by the user-directed
  // review (2026-09-08): the requester is typed into the booking now. The
  // directory remains at /editors for historical bookings, reachable by URL
  // with the same permission.
  { href: '/issues', label: 'Issues', icon: 'issues', description: 'Missing, damaged and faulty equipment', anyOf: ['issue.read'] },
  { href: '/reports', label: 'Reports', icon: 'reports', description: 'Operational reports and exports', anyOf: ['report.read'] },
]

export const ADMIN_NAV: readonly NavItem[] = [
  { href: '/admin/users', label: 'Users', icon: 'users', description: 'Accounts, roles, suspension and password resets', anyOf: ['admin.users.manage'] },
  { href: '/admin/categories', label: 'Categories', icon: 'categories', description: 'Equipment categories and accessory types', anyOf: ['admin.categories.manage'] },
  // Software was removed from the administration navigation by the same
  // review: software verification no longer gates a handover. The catalogue
  // remains at /admin/software, reachable by URL with the same permission.
  { href: '/admin/checklists', label: 'Checklist Templates', icon: 'checklists', description: 'Handover and return checklists', anyOf: ['admin.checklists.manage'] },
  { href: '/admin/audit-logs', label: 'Audit Logs', icon: 'audit', description: 'Append-only record of every change', anyOf: ['admin.audit.read'] },
  { href: '/admin/settings', label: 'Settings', icon: 'settings', description: 'Runtime-editable application settings', anyOf: ['admin.settings.manage'] },
]

function toLink({ href, label, icon }: NavItem): NavLink {
  return { href, label, icon }
}

/**
 * The sections a given actor may see, reduced to links. Permission names stay
 * on the server: the client shell only needs where to go and what to call it.
 */
export function navigationFor(subject: PermissionSubject): NavSection[] {
  const sections: NavSection[] = [
    { title: 'Operations', items: MAIN_NAV.filter((item) => canAny(subject, item.anyOf)).map(toLink) },
    { title: 'Administration', items: ADMIN_NAV.filter((item) => canAny(subject, item.anyOf)).map(toLink) },
  ]
  return sections.filter((section) => section.items.length > 0)
}
