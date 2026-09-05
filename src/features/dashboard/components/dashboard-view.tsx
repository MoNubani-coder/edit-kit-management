import type { DashboardData } from '@/server/services/dashboard.service'

import { ActivityFeed } from './activity-feed'
import { BookingsTable } from './bookings-table'
import { EditorDashboard } from './editor-dashboard'
import { IssuesTable } from './issues-table'
import { Stat, StatStrip } from './kpi-card'
import { QuickActions } from './quick-actions'
import { SectionCard } from './section-card'

/**
 * Lays out whatever sections the service produced. A `null` section means the
 * actor may not see it, so this component renders permissions without ever
 * checking one - the service already did.
 *
 * Rhythm: one instrument strip of headline numbers, a row of shortcuts, then
 * framed panels - overdue first (only when it exists), the day's movements
 * side by side, then issues beside the activity timeline.
 */
export function DashboardView({ data }: { data: DashboardData }) {
  const { timeZone, generatedAt: now } = data

  if (data.myBookings) {
    return <EditorDashboard mine={data.myBookings} timeZone={timeZone} now={now} />
  }

  const hasStats = data.kits || data.overdue || data.maintenance || data.issues

  return (
    <div className="space-y-7">
      {hasStats ? (
        <StatStrip>
          {data.kits ? (
            <>
              <Stat
                title="Available kits"
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
              title="In maintenance"
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
      ) : null}

      <QuickActions actions={data.quickActions} />

      {data.overdue && data.overdue.count > 0 ? (
        <SectionCard
          title="Overdue returns"
          description="Checked-out kits past their expected return."
          count={data.overdue.count}
          tone="attention"
          action={{ href: '/bookings', label: 'View all bookings' }}
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
              action={{ href: '/bookings', label: 'View all bookings' }}
            >
              <BookingsTable rows={data.todaysBookings} variant="today" timeZone={timeZone} now={now} />
            </SectionCard>
          ) : null}
          {data.upcomingReturns ? (
            <SectionCard
              title="Upcoming returns"
              description="Kits out with editors, nearest return first."
              count={data.upcomingReturns.length}
              action={{ href: '/bookings', label: 'View all bookings' }}
            >
              <BookingsTable rows={data.upcomingReturns} variant="upcoming" timeZone={timeZone} now={now} />
            </SectionCard>
          ) : null}
        </div>
      ) : null}

      {data.issues || data.recentActivity ? (
        <div className="grid gap-6 xl:grid-cols-5">
          {data.issues ? (
            <SectionCard
              title="Open issues"
              description="Unresolved equipment reports, newest first."
              count={data.issues.count}
              action={{ href: '/issues', label: 'View all issues' }}
              className="xl:col-span-3"
            >
              <IssuesTable rows={data.issues.rows} timeZone={timeZone} />
            </SectionCard>
          ) : null}
          {data.recentActivity ? (
            <SectionCard
              title="Recent activity"
              description="Latest recorded changes."
              className={data.issues ? 'xl:col-span-2' : 'xl:col-span-5'}
            >
              <ActivityFeed rows={data.recentActivity} timeZone={timeZone} now={now} />
            </SectionCard>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
