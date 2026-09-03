import { canAny, type Permission, type PermissionSubject } from '@/server/auth/permissions'

/**
 * Navigation definition. Data, not JSX, so the server layout can filter it by
 * permission and hand a plain serialisable list to the client sidebar. Icons
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
  /** Visible when the actor holds at least one of these. */
  anyOf: readonly Permission[]
}

export interface NavSection {
  title: string | null
  items: readonly NavItem[]
}

export const MAIN_NAV: readonly NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: 'dashboard', anyOf: ['dashboard.view'] },
  { href: '/bookings', label: 'Bookings', icon: 'bookings', anyOf: ['booking.read', 'booking.readOwn'] },
  { href: '/kits', label: 'Kits', icon: 'kits', anyOf: ['kit.read'] },
  { href: '/assets', label: 'Equipment', icon: 'assets', anyOf: ['asset.read'] },
  { href: '/editors', label: 'Editors', icon: 'editors', anyOf: ['editor.read'] },
  { href: '/issues', label: 'Issues', icon: 'issues', anyOf: ['issue.read'] },
  { href: '/reports', label: 'Reports', icon: 'reports', anyOf: ['report.read'] },
]

export const ADMIN_NAV: readonly NavItem[] = [
  { href: '/admin/users', label: 'Users', icon: 'users', anyOf: ['admin.users.manage'] },
  { href: '/admin/categories', label: 'Categories', icon: 'categories', anyOf: ['admin.categories.manage'] },
  { href: '/admin/software', label: 'Software', icon: 'software', anyOf: ['admin.software.manage'] },
  { href: '/admin/checklists', label: 'Checklist Templates', icon: 'checklists', anyOf: ['admin.checklists.manage'] },
  { href: '/admin/audit-logs', label: 'Audit Logs', icon: 'audit', anyOf: ['admin.audit.read'] },
  { href: '/admin/settings', label: 'Settings', icon: 'settings', anyOf: ['admin.settings.manage'] },
]

/** The sections a given actor may see. Empty sections are dropped. */
export function navigationFor(subject: PermissionSubject): NavSection[] {
  const sections: NavSection[] = [
    { title: null, items: MAIN_NAV.filter((item) => canAny(subject, item.anyOf)) },
    { title: 'Administration', items: ADMIN_NAV.filter((item) => canAny(subject, item.anyOf)) },
  ]
  return sections.filter((section) => section.items.length > 0)
}
