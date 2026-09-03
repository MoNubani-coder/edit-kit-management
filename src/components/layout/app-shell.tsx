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

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { NavIcon, NavSection } from '@/lib/constants/navigation'
import { ROLE_LABELS } from '@/lib/constants/roles'
import { cn } from '@/lib/utils/cn'

import { SignOutButton } from './sign-out-button'

/**
 * Authenticated application frame: sidebar, top bar, content.
 *
 * Receives the navigation already filtered by permission on the server. The
 * shell never decides what the user may do - it only lays out what the server
 * said they may see.
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
  user: ShellUser
  sections: NavSection[]
  children: ReactNode
}

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

function Navigation({ sections, pathname, onNavigate }: { sections: NavSection[]; pathname: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main navigation" className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
      {sections.map((section) => (
        <div key={section.title ?? 'main'}>
          {section.title ? (
            <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
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
                      'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                      active
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-300 hover:bg-slate-800/60 hover:text-white',
                    )}
                  >
                    <Icon aria-hidden className="h-4 w-4 shrink-0" />
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

function Brand({ appName }: { appName: string }) {
  return (
    <div className="flex h-16 items-center gap-3 border-b border-slate-800 px-5">
      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-white text-xs font-bold text-slate-900">
        EK
      </div>
      <div className="leading-tight">
        <p className="text-sm font-semibold text-white">{appName}</p>
        <p className="text-[11px] text-slate-400">Handover &amp; return</p>
      </div>
    </div>
  )
}

export function AppShell({ appName, user, sections, children }: AppShellProps) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  // Links close the drawer themselves (onNavigate); Escape closes it too.
  useEffect(() => {
    if (!mobileOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mobileOpen])

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col bg-slate-900 lg:flex">
        <Brand appName={appName} />
        <Navigation sections={sections} pathname={pathname} />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 flex lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-slate-900/60"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative flex w-72 max-w-[85vw] flex-col bg-slate-900 shadow-xl">
            <Brand appName={appName} />
            <button
              type="button"
              aria-label="Close navigation"
              className="absolute right-3 top-5 rounded-md p-1 text-slate-300 hover:bg-slate-800 hover:text-white"
              onClick={() => setMobileOpen(false)}
            >
              <X aria-hidden className="h-5 w-5" />
            </button>
            <Navigation sections={sections} pathname={pathname} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Open navigation"
            onClick={() => setMobileOpen(true)}
          >
            <Menu aria-hidden className="h-5 w-5" />
          </Button>

          <div className="min-w-0 flex-1" />

          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="truncate text-sm font-medium text-slate-900">{user.name}</p>
              <p className="truncate text-xs text-slate-500">{user.email}</p>
            </div>
            <Badge tone={user.role === 'ADMIN' ? 'slate' : 'neutral'}>{ROLE_LABELS[user.role]}</Badge>
            <div className="hidden sm:block">
              <SignOutButton />
            </div>
            <div className="sm:hidden">
              <SignOutButton compact />
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  )
}
