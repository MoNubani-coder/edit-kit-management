import Link from 'next/link'
import type { ReactNode } from 'react'

import { BookingStatusBadge } from '@/components/common/status-badge'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { formatDate, formatDateTime } from '@/lib/datetime'
import type { EditorDetail, LinkableUser } from '@/server/dal/editors.dal'

import { editorHref } from '../hrefs'
import { LinkUserForm, UnlinkUserForm } from './account-forms'
import { EditorActiveBadge, EditorTypeBadge } from './editor-badges'

function Panel({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="theme-transition rounded-panel border border-line bg-panel">
      <header className="border-b border-line bg-panel-header px-5 py-3">
        <h2 className="font-display text-[15px] font-semibold text-foreground">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
      </header>
      <div className="px-5 py-4 text-sm">{children}</div>
    </section>
  )
}

function Field({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">{label}</dt>
      <dd className={mono ? 'mt-1 font-mono text-[13px] text-foreground' : 'mt-1 text-foreground'}>{children}</dd>
    </div>
  )
}

const Empty = () => <span className="text-subtle">—</span>

const USER_STATUS_TONE = { ACTIVE: 'green', INVITED: 'blue', SUSPENDED: 'amber', DISABLED: 'neutral' } as const

/** The Overview tab: contact, account, and the booking figures. */
export function EditorOverview({
  editor,
  canManage,
  linkableUsers,
  timeZone,
}: {
  editor: EditorDetail
  canManage: boolean
  linkableUsers: LinkableUser[]
  timeZone: string
}) {
  const user = editor.linkedUser
  const removed = editor.deletedAt !== null

  return (
    <div className="space-y-6">
      {!editor.isActive && !removed ? (
        <Alert variant="warning" title="Inactive editor">
          This editor cannot be chosen for new bookings. Past bookings, handovers and signatures stay readable here.
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-3">
        <Panel title="Contact">
          <dl className="grid gap-4">
            <Field label="Staff ID" mono>
              {editor.staffId ?? <Empty />}
            </Field>
            <Field label="Contact number">{editor.contactNumber ?? <Empty />}</Field>
            <Field label="Email">{editor.email ?? <Empty />}</Field>
            {editor.isExternal ? <Field label="Company">{editor.company ?? <Empty />}</Field> : <Field label="Department">{editor.department ?? <Empty />}</Field>}
          </dl>
        </Panel>

        <Panel
          title="Account"
          description={editor.isExternal ? 'External editors sign in person on the engineer’s device; no application account is involved.' : 'An internal editor may be linked to one user account, which then sees these bookings as its own.'}
        >
          <dl className="grid gap-4">
            <Field label="Type">
              <span className="flex flex-wrap items-center gap-2">
                <EditorTypeBadge isExternal={editor.isExternal} />
                <EditorActiveBadge isActive={editor.isActive} />
              </span>
            </Field>
            <Field label="Linked user">
              {user ? (
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{user.name}</span>
                  {canManage ? <span className="text-muted">{user.email}</span> : null}
                  <Badge tone="neutral">{user.role.toLowerCase()}</Badge>
                  <Badge tone={user.deleted ? 'red' : USER_STATUS_TONE[user.status]} dot>
                    {user.deleted ? 'Deleted' : user.status.charAt(0) + user.status.slice(1).toLowerCase()}
                  </Badge>
                  {canManage && !removed ? <UnlinkUserForm editorId={editor.id} userName={user.name} /> : null}
                </span>
              ) : (
                <span className="text-subtle">{editor.isExternal ? 'No account' : 'Not linked'}</span>
              )}
            </Field>
          </dl>
          {canManage && !removed && !editor.isExternal && !user ? (
            <div className="mt-4 border-t border-line pt-4">
              <LinkUserForm editorId={editor.id} users={linkableUsers} />
            </div>
          ) : null}
        </Panel>

        <Panel title="Bookings">
          <dl className="grid gap-4">
            <Field label="Active bookings">
              <Link href={editorHref(editor.id, 'active')} className="text-accent-foreground hover:underline">
                {editor.activeBookingCount} {editor.activeBookingCount === 1 ? 'booking' : 'bookings'} live
              </Link>
            </Field>
            <Field label="Total">
              <Link href={editorHref(editor.id, 'history')} className="text-accent-foreground hover:underline">
                {editor.totalBookingCount} {editor.totalBookingCount === 1 ? 'booking' : 'bookings'} on record
              </Link>
              {editor.firstBookingAt ? <span className="block text-xs text-muted">since {formatDate(editor.firstBookingAt, timeZone)}</span> : null}
            </Field>
            <Field label="Last booking">
              {editor.lastBooking ? (
                <span className="flex flex-wrap items-center gap-2">
                  <Link href="/bookings" className="font-mono text-xs font-semibold text-accent-foreground hover:underline">
                    {editor.lastBooking.bookingNumber}
                  </Link>
                  <span className="font-mono text-xs">{editor.lastBooking.kitCode}</span>
                  <span className="text-muted">{formatDate(editor.lastBooking.bookingStart, timeZone)}</span>
                  <BookingStatusBadge status={editor.lastBooking.status} />
                </span>
              ) : (
                <span className="text-subtle">None yet</span>
              )}
            </Field>
            <Field label="Signatures on file">{editor.signatureCount}</Field>
            <Field label="Profile updated">{formatDateTime(editor.updatedAt, timeZone)}</Field>
          </dl>
        </Panel>
      </div>

      {editor.notes ? (
        <Panel title="Notes">
          <p className="whitespace-pre-line text-foreground">{editor.notes}</p>
        </Panel>
      ) : null}
    </div>
  )
}
