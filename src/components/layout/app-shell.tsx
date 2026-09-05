'use client'

import type { UserRole } from '@prisma/client'
import {
  Boxes,
  CalendarRange,
  ChartColumn,
  LayoutDashboard,
  ListChecks,
  Menu,
  MonitorSmartphone,
  ScrollText,
  Settings,
  Tags,
  TriangleAlert,
  UserCog,
  Users,
  Wrench,
  X,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { type ReactNode, useEffect, useState } from 'react'

import { PullCordThemeToggle } from '@/components/theme/pull-cord-theme-toggle'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { NavIcon, NavSection } from '@/lib/constants/navigation'
import { ROLE_LABELS } from '@/lib/constants/roles'
import { cn } from '@/lib/utils/cn'

import { SignOutButton } from './sign-out-button'

/**
 * Authenticated application frame.
 *
 * Left: a navy rail that never changes with the theme - the brand block, the
 * grouped navigation with a teal marker on the active item, and a bottom
 * panel with the signed-in user and the pull-cord theme switch. Right: a
 * slim top bar showing where you are and today's date, then the page.
 *
 * The shell receives navigation already filtered by permission and renders it
 * verbatim; it decides nothing about what the user may do.
 */

const NAV_ICONS: Record<NavIcon, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
  bookings: CalendarRange,
  kits: Boxes,
  assets: MonitorSmartphone,
  editors: Users,
  issues: TriangleAlert,
  reports: ChartColumn,
  users: UserCog,
  categories: Tags,
  software: Wrench,
  checklists: ListChecks,
  audit: ScrollText,
  settings: Settings,
}

export interface ShellUser {
  name: string
  email: string
  role: UserRole
}

interface AppShellProps {
  appName: string
  tagline: string
  todayLabel: string
  user: ShellUser
  sections: NavSection[]
  children: ReactNode
}

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? parts[parts.length - 1][0] : ''
  return `${first}${last}`.toUpperCase() || '?'
}

function Brand({ appName, tagline }: { appName: string; tagline: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-sidebar-line px-5 py-5">
      <div
        role="img"
        aria-label={`${appName} logo`}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent font-display text-[13px] font-extrabold tracking-tight text-white"
      >
        EK
      </div>
      <div className="min-w-0 leading-tight">
        <p className="truncate font-display text-[15px] font-semibold text-sidebar-foreground">{appName}</p>
        <p className="mt-0.5 truncate text-[10.5px] uppercase tracking-[0.12em] text-sidebar-muted">{tagline}</p>
      </div>
    </div>
  )
}

function Navigation({
  sections,
  pathname,
  onNavigate,
}: {
  sections: NavSection[]
  pathname: string
  onNavigate?: () => void
}) {
  return (
    <nav aria-label="Main navigation" className="flex-1 space-y-7 overflow-y-auto px-3 py-5">
      {sections.map((section) => (
        <div key={section.title ?? 'main'}>
          {section.title ? (
            <p className="mb-2 px-3 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-sidebar-muted/80">
              {section.title}
            </p>
          ) : null}
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const Icon = NAV_ICONS[item.icon]
              const active = isActive(pathname, item.href)
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar',
                      active
                        ? 'bg-sidebar-active text-sidebar-foreground before:absolute before:left-0 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-full before:bg-accent'
                        : 'text-sidebar-muted hover:bg-sidebar-active hover:text-sidebar-foreground',
                    )}
                  >
                    <Icon aria-hidden className={cn('h-[18px] w-[18px] shrink-0', active ? 'text-accent-foreground dark:text-accent' : 'opacity-80')} />
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}

function UserPanel({ user }: { user: ShellUser }) {
  return (
    <div className="border-t border-sidebar-line px-4 pb-4 pt-4">
      <div className="flex items-stretch gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3 rounded-lg bg-sidebar-active px-3 py-3">
          <div
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 font-display text-xs font-bold text-sidebar-foreground"
          >
            {initialsOf(user.name)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-sidebar-foreground">{user.name}</p>
            <p className="mt-0.5 truncate text-[11px] text-sidebar-muted">{ROLE_LABELS[user.role]}</p>
          </div>
          <div className="-mr-1 text-sidebar-muted [&_button]:text-sidebar-muted [&_button:hover]:bg-white/10 [&_button:hover]:text-sidebar-foreground">
            <SignOutButton compact />
          </div>
        </div>
        <div className="flex shrink-0 items-start justify-center text-sidebar-muted" title="Theme">
          <PullCordThemeToggle className="text-sidebar-muted hover:text-sidebar-foreground" />
        </div>
      </div>
    </div>
  )
}

function currentSectionLabel(sections: NavSection[], pathname: string): { group: string | null; label: string } {
  for (const section of sections) {
    const match = section.items.find((item) => isActive(pathname, item.href))
    if (match) return { group: section.title, label: match.label }
  }
  if (pathname.startsWith('/admin')) return { group: 'Administration', label: 'Administration' }
  return { group: null, label: 'Edit Kit Management' }
}

export function AppShell({ appName, tagline, todayLabel, user, sections, children }: AppShellProps) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const current = currentSectionLabel(sections, pathname)

  // Links close the drawer themselves (onNavigate); Escape closes it too.
  useEffect(() => {
    if (!mobileOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mobileOpen])

  const rail = (onNavigate?: () => void) => (
    <>
      <Brand appName={appName} tagline={tagline} />
      <Navigation sections={sections} pathname={pathname} onNavigate={onNavigate} />
      <UserPanel user={user} />
    </>
  )

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop rail */}
      <aside className="hidden w-[17.5rem] shrink-0 flex-col border-r border-sidebar-line bg-sidebar text-sidebar-foreground lg:flex">
        {rail()}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 flex lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-slate-950/60"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative flex w-[18rem] max-w-[85vw] flex-col bg-sidebar text-sidebar-foreground shadow-2xl">
            <button
              type="button"
              aria-label="Close navigation"
              className="absolute right-3 top-5 z-10 rounded-md p-1 text-sidebar-muted hover:bg-sidebar-active hover:text-sidebar-foreground"
              onClick={() => setMobileOpen(false)}
            >
              <X aria-hidden className="h-5 w-5" />
            </button>
            {rail(() => setMobileOpen(false))}
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="theme-transition sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-line bg-panel/85 px-4 backdrop-blur sm:px-6 lg:px-10">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Open navigation"
            onClick={() => setMobileOpen(true)}
          >
            <Menu aria-hidden className="h-5 w-5" />
          </Button>

          <div className="min-w-0 flex-1 leading-tight">
            {current.group ? (
              <p className="truncate text-[10.5px] font-semibold uppercase tracking-[0.14em] text-subtle">{current.group}</p>
            ) : null}
            <p className="truncate font-display text-sm font-semibold text-foreground">{current.label}</p>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden rounded-lg border border-line bg-panel px-3 py-1.5 text-xs tabular-nums text-muted sm:inline-flex">
              {todayLabel}
            </span>
            <Badge tone="blue" className="hidden md:inline-flex">
              {ROLE_LABELS[user.role]}
            </Badge>
            <div
              aria-label={user.name}
              title={`${user.name} · ${user.email}`}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-sidebar font-display text-xs font-bold text-sidebar-foreground"
            >
              {initialsOf(user.name)}
            </div>
          </div>
        </header>

        <main className="theme-transition flex-1 px-4 py-7 sm:px-6 lg:px-10">
          <div className="mx-auto w-full max-w-[1600px]">{children}</div>
        </main>
      </div>
    </div>
  )
}
