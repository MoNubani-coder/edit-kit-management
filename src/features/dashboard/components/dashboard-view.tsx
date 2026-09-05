import { formatDateTime } from '@/lib/datetime'
import type { DashboardData } from '@/server/services/dashboard.service'

import { ActivityFeed } from './activity-feed'
import { BookingsTable } from './bookings-table'
import { EditorDashboard } from './editor-dashboard'
import { IssuesTable } from './issues-table'
import { Stat, StatStrip } from './kpi-card'
import { QuickActions } from './quick-actions'
import { SectionCard } from './section-card'

/**
 * The operations board. A `null` section means the actor may not see it, so
 * this component renders permissions without ever checking one - the service
 * already did.
 *
 * Composition across the full width: the status board (two rows of three
 * connected figures), the shortcut row, overdue when it exists, then two
 * paired panels - today's movements beside upcoming returns, open issues
 * beside the activity timeline.
 */
export function DashboardView({ data }: { data: DashboardData }) {
  const { timeZone, generatedAt: now } = data

  if (data.myBookings) {
    return <EditorDashboard mine={data.myBookings} timeZone={timeZone} now={now} />
  }

  const hasStats = data.kits || data.overdue || data.maintenance || data.issues

  return (
    <div className="space-y-8">
      {hasStats ? (
        <section aria-labelledby="operations-status" className="theme-transition overflow-hidden rounded-panel border border-line bg-panel">
          <div className="flex items-center justify-between gap-4 border-b border-line bg-panel-header px-5 py-3">
            <h2 id="operations-status" className="font-display text-[15px] font-semibold text-foreground">
              Operations status
            </h2>
            <p className="text-xs tabular-nums text-muted">Updated {formatDateTime(now, timeZone)}</p>
          </div>
          <StatStrip columns={3} className="rounded-none border-0">
            {data.kits ? (
              <>
                <Stat
                  title="Available"
                  value={data.kits.available}
                  hint={data.kits.total > 0 ? `of ${data.kits.total} active kits` : 'No kits configured yet'}
                  icon="available"
                />
                <Stat title="Reserved" value={data.kits.reserved} hint="Booked, not yet collected" icon="reserved" />
                <Stat title="Checked out" value={data.kits.checkedOut} hint="Currently with editors" icon="checkedOut" />
              </>
            ) : null}
            {data.overdue ? (
              <Stat
                title="Overdue"
                value={data.overdue.count}
                hint={data.overdue.count > 0 ? 'Requires attention' : 'All returns on time'}
                icon="overdue"
                attention={data.overdue.count > 0}
              />
            ) : null}
            {data.maintenance ? (
              <Stat
                title="Maintenance"
                value={data.maintenance.assetsInMaintenance}
                hint={
                  data.maintenance.activeRecords === null
                    ? 'Assets out of service'
                    : `${data.maintenance.activeRecords} active maintenance record${data.maintenance.activeRecords === 1 ? '' : 's'}`
                }
                icon="maintenance"
              />
            ) : null}
            {data.issues ? (
              <Stat
                title="Open issues"
                value={data.issues.count}
                hint={data.issues.count > 0 ? 'Unresolved equipment issues' : 'No equipment issues open'}
                icon="issues"
                attention={data.issues.count > 0}
              />
            ) : null}
          </StatStrip>
        </section>
      ) : null}

      <QuickActions actions={data.quickActions} />

      {data.overdue && data.overdue.count > 0 ? (
        <SectionCard
          title="Overdue returns"
          description="Checked-out kits past their expected return."
          count={data.overdue.count}
          tone="attention"
          action={{ href: '/bookings?filter=overdue', label: 'View overdue' }}
        >
          <BookingsTable rows={data.overdue.rows} variant="overdue" timeZone={timeZone} now={now} />
        </SectionCard>
      ) : null}

      {data.todaysBookings || data.upcomingReturns ? (
        <div className="grid gap-6 xl:grid-cols-2">
          {data.todaysBookings ? (
            <SectionCard
              title="Today's bookings"
              description="Collections starting and returns due today."
              count={data.todaysBookings.length}
              action={{ href: '/bookings?filter=today', label: 'View all' }}
            >
              <BookingsTable rows={data.todaysBookings} variant="today" timeZone={timeZone} now={now} />
            </SectionCard>
          ) : null}
          {data.upcomingReturns ? (
            <SectionCard
              title="Upcoming returns"
              description="Kits out with editors, nearest return first."
              count={data.upcomingReturns.length}
              action={{ href: '/bookings?filter=due-soon', label: 'View all' }}
            >
              <BookingsTable rows={data.upcomingReturns} variant="upcoming" timeZone={timeZone} now={now} />
            </SectionCard>
          ) : null}
        </div>
      ) : null}

      {data.issues || data.recentActivity ? (
        <div className="grid gap-6 xl:grid-cols-2">
          {data.issues ? (
            <SectionCard
              title="Open issues"
              description="Unresolved equipment reports, newest first."
              count={data.issues.count}
              action={{ href: '/issues', label: 'View all issues' }}
            >
              <IssuesTable rows={data.issues.rows} timeZone={timeZone} />
            </SectionCard>
          ) : null}
          {data.recentActivity ? (
            <SectionCard title="Recent activity" description="Latest recorded changes.">
              <ActivityFeed rows={data.recentActivity} timeZone={timeZone} now={now} />
            </SectionCard>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
