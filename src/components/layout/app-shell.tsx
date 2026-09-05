'use client'

import type { UserRole } from '@prisma/client'
import { ChevronDown, Menu, X } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from 'react'

import { PullCordThemeToggle } from '@/components/theme/pull-cord-theme-toggle'
import { Badge } from '@/components/ui/badge'
import type { NavLink, NavSection } from '@/lib/constants/navigation'
import { ROLE_LABELS } from '@/lib/constants/roles'
import { cn } from '@/lib/utils/cn'

import { SignOutButton } from './sign-out-button'

/**
 * Application shell: a single navy command bar across the full width.
 *
 *   [EK] Edit Kit Management System   Dashboard Bookings Kits …  Administration ▾   03 Sep · Role · (cord) · (avatar ▾)
 *
 * The primary sections are horizontal tabs with a teal underline on the active
 * one. Administration is a dropdown (it never occupies permanent space) shown
 * only when the server included that group. The account menu holds identity
 * and sign-out; the pull-cord theme switch sits beside it. Below `lg` the tabs
 * fold into a panel behind a menu button.
 *
 * The shell receives navigation already filtered by permission and renders it
 * verbatim; it decides nothing about what the user may do.
 */

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

const ADMIN_GROUP = 'Administration'

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? parts[parts.length - 1][0] : ''
  return `${first}${last}`.toUpperCase() || '?'
}

/** Closes a popover on outside pointer-down or Escape while it is open. */
function useDismiss(open: boolean, onClose: () => void, ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose, ref])
}

const NAV_ITEM =
  'relative flex h-[60px] items-center gap-1 border-b-2 px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-nav'
const NAV_IDLE = 'border-transparent text-nav-muted hover:text-nav-foreground'
const NAV_ACTIVE = 'border-accent text-nav-foreground'

function Brand({ appName, tagline }: { appName: string; tagline: string }) {
  return (
    <Link
      href="/dashboard"
      className="flex shrink-0 items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-nav"
    >
      <span
        role="img"
        aria-label={`${appName} logo`}
        className="flex h-8 w-8 items-center justify-center rounded-md bg-accent font-display text-[12px] font-extrabold tracking-tight text-white"
      >
        EK
      </span>
      <span className="hidden leading-tight sm:block">
        <span className="block font-display text-[14px] font-semibold text-nav-foreground">{appName}</span>
        <span className="hidden text-[10px] uppercase tracking-[0.14em] text-nav-muted xl:block">{tagline}</span>
      </span>
    </Link>
  )
}

function AdminDropdown({ items, pathname }: { items: readonly NavLink[]; pathname: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLLIElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(open, close, ref)
  const active = pathname.startsWith('/admin')

  return (
    <li ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(NAV_ITEM, active ? NAV_ACTIVE : NAV_IDLE)}
      >
        {ADMIN_GROUP}
        <ChevronDown aria-hidden className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label={ADMIN_GROUP}
          className="theme-transition absolute left-0 top-full z-40 mt-1 w-64 rounded-panel border border-line bg-panel p-1.5 text-foreground shadow-lg"
        >
          {items.map((item) => (
            <Link
              key={item.href}
              role="menuitem"
              href={item.href}
              onClick={close}
              className={cn(
                'flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors hover:bg-panel-header focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isActive(pathname, item.href) ? 'font-semibold text-accent-foreground' : 'text-foreground',
              )}
            >
              {item.label}
              {isActive(pathname, item.href) ? <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" /> : null}
            </Link>
          ))}
        </div>
      ) : null}
    </li>
  )
}

function AccountMenu({ user }: { user: ShellUser }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(open, close, ref)

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${user.name}`}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 rounded-full pl-1 pr-2 py-1 text-nav-muted transition-colors hover:bg-nav-active hover:text-nav-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-nav"
      >
        <span
          aria-hidden
          className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 font-display text-xs font-bold text-nav-foreground"
        >
          {initialsOf(user.name)}
        </span>
        <ChevronDown aria-hidden className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="Account"
          className="theme-transition absolute right-0 top-full z-40 mt-2 w-64 rounded-panel border border-line bg-panel text-foreground shadow-lg"
        >
          <div className="border-b border-line px-4 py-3">
            <p className="truncate text-sm font-semibold text-foreground">{user.name}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
            <div className="mt-2">
              <Badge tone="blue" dot>
                {ROLE_LABELS[user.role]}
              </Badge>
            </div>
          </div>
          <div className="p-1.5" role="none">
            <SignOutButton className="h-9 rounded-lg" />
          </div>
        </div>
      ) : null}
    </div>
  )
}

function MobilePanel({
  sections,
  pathname,
  onNavigate,
}: {
  sections: NavSection[]
  pathname: string
  onNavigate: () => void
}) {
  return (
    <div
      id="mobile-navigation"
      className="theme-transition absolute inset-x-0 top-full z-40 border-b border-nav-line bg-nav px-4 pb-5 pt-2 shadow-2xl lg:hidden"
    >
      {sections.map((section) => (
        <div key={section.title ?? 'main'} className="pt-3">
          {section.title ? (
            <p className="px-3 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-nav-muted/80">{section.title}</p>
          ) : null}
          <ul className="grid gap-0.5 sm:grid-cols-2">
            {section.items.map((item) => {
              const active = isActive(pathname, item.href)
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                      active ? 'bg-nav-active text-nav-foreground' : 'text-nav-muted hover:bg-nav-active hover:text-nav-foreground',
                    )}
                  >
                    {item.label}
                    {active ? <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" /> : null}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}

export function AppShell({ appName, tagline, todayLabel, user, sections, children }: AppShellProps) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const headerRef = useRef<HTMLElement>(null)
  const closeMobile = useCallback(() => setMobileOpen(false), [])
  useDismiss(mobileOpen, closeMobile, headerRef)

  const primary = sections.filter((section) => section.title !== ADMIN_GROUP).flatMap((section) => section.items)
  const admin = sections.find((section) => section.title === ADMIN_GROUP)?.items ?? []

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header
        ref={headerRef}
        className="theme-transition sticky top-0 z-30 border-b border-nav-line bg-nav text-nav-foreground"
      >
        <div className="mx-auto flex h-[60px] w-full max-w-[1600px] items-center gap-6 px-4 sm:px-6 lg:px-8">
          <Brand appName={appName} tagline={tagline} />

          <nav aria-label="Primary" className="hidden h-full flex-1 lg:flex">
            <ul className="flex h-full items-stretch gap-0.5">
              {primary.map((item) => {
                const active = isActive(pathname, item.href)
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(NAV_ITEM, active ? NAV_ACTIVE : NAV_IDLE)}
                    >
                      {item.label}
                    </Link>
                  </li>
                )
              })}
              {admin.length > 0 ? <AdminDropdown items={admin} pathname={pathname} /> : null}
            </ul>
          </nav>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <span className="hidden rounded-md border border-nav-line px-2.5 py-1 text-xs tabular-nums text-nav-muted xl:inline-flex">
              {todayLabel}
            </span>
            <Badge tone="blue" className="hidden md:inline-flex">
              {ROLE_LABELS[user.role]}
            </Badge>
            <div className="-my-1 flex h-[60px] items-start pt-0.5 text-nav-muted hover:text-nav-foreground" title="Theme">
              <PullCordThemeToggle variant="compact" />
            </div>
            <AccountMenu user={user} />
            <button
              type="button"
              aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
              aria-expanded={mobileOpen}
              aria-controls="mobile-navigation"
              onClick={() => setMobileOpen((value) => !value)}
              className="flex h-9 w-9 items-center justify-center rounded-md text-nav-muted transition-colors hover:bg-nav-active hover:text-nav-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-nav lg:hidden"
            >
              {mobileOpen ? <X aria-hidden className="h-5 w-5" /> : <Menu aria-hidden className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {mobileOpen ? <MobilePanel sections={sections} pathname={pathname} onNavigate={closeMobile} /> : null}
      </header>

      <main className="theme-transition flex-1">
        <div className="mx-auto w-full max-w-[1600px] px-4 py-8 sm:px-6 lg:px-8">{children}</div>
      </main>
    </div>
  )
}
