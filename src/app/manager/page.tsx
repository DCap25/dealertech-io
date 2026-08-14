import Link from 'next/link'
import { UserBadge } from '@/components/auth/user-badge'
import { Card } from '@/components/ui/primitives'
import { requireUser } from '@/lib/auth/session'
import { getDefaultStore } from '@/lib/prep-sheet/load'
import { monthToDatePeriod, weekPeriod } from '@/lib/performance'
import { buildBoard, type AdvisorRow, type Attention, type AttentionTone } from '@/lib/manager'
import { loadAdvisors, loadAppointments, loadBacklog, loadRepairOrders } from '@/lib/manager/load'
import { demoNow } from '@/lib/demo-day'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Service department' }

/** The seeded dealership lives on a fixed date so the demo is stable. */
const DAY = () => demoNow()

/** Roles allowed to see other people's numbers. */
const MANAGER_ROLES = new Set(['SERVICE_MANAGER', 'ADMIN'])

function money(n: number): string {
  return `$${Math.round(n).toLocaleString()}`
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string
  sub?: string
  tone?: 'default' | 'good' | 'alert'
}) {
  return (
    <Card className="p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{label}</p>
      <p
        className={`mt-1.5 text-3xl font-bold tabular-nums ${
          tone === 'good'
            ? 'text-emerald-700 dark:text-emerald-400'
            : tone === 'alert'
              ? 'text-rose-700 dark:text-rose-400'
              : ''
        }`}
      >
        {value}
      </p>
      {sub && <p className="mt-1.5 text-xs leading-relaxed text-neutral-500">{sub}</p>}
    </Card>
  )
}

const ATTENTION_STYLE: Record<AttentionTone, string> = {
  ALERT: 'border-rose-300 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/50',
  WATCH: 'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/50',
  GOOD: 'border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/50',
}

const ATTENTION_GLYPH: Record<AttentionTone, string> = {
  ALERT: '!',
  WATCH: '•',
  GOOD: '✓',
}

function AttentionRow({ item }: { item: Attention }) {
  return (
    <div className={`rounded-2xl border p-4 ${ATTENTION_STYLE[item.tone]}`}>
      <div className="flex gap-3">
        <span className="mt-0.5 font-mono text-sm font-bold text-neutral-500">
          {ATTENTION_GLYPH[item.tone]}
        </span>
        <div className="min-w-0">
          <p className="font-bold">{item.headline}</p>
          <p className="mt-1 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
            {item.detail}
          </p>
        </div>
      </div>
    </div>
  )
}

/** Column headings, shown only where there is room for a real table. */
function AdvisorHeader() {
  return (
    <div className="hidden border-b border-[var(--border)] px-4 pb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 sm:grid sm:grid-cols-[1.6fr_repeat(5,minmax(0,1fr))] sm:gap-3">
      <span>Advisor</span>
      <span className="text-right">Today</span>
      <span className="text-right">ROs</span>
      <span className="text-right">Sold</span>
      <span className="text-right">Covered</span>
      <span className="text-right">Per RO</span>
    </div>
  )
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="flex items-baseline justify-between gap-2 sm:justify-end">
      {/* The label rides along on mobile, where the column heading is gone. */}
      <span className="text-[11px] uppercase tracking-wide text-neutral-500 sm:hidden">
        {label}
      </span>
      <span className="font-semibold tabular-nums">{children}</span>
    </span>
  )
}

function AdvisorRowView({ row, quiet }: { row: AdvisorRow; quiet: boolean }) {
  return (
    <div className="grid gap-2 border-b border-[var(--border)] px-4 py-3.5 last:border-b-0 sm:grid-cols-[1.6fr_repeat(5,minmax(0,1fr))] sm:items-baseline sm:gap-3">
      <div className="min-w-0">
        <p className="truncate font-bold">{row.name}</p>
        <p className="mt-0.5 text-xs text-neutral-500">
          {row.activeNow > 0
            ? `${row.activeNow} in the shop now`
            : quiet
              ? 'Nothing closed this period'
              : row.effectiveLaborRate !== null
                ? `${money(row.effectiveLaborRate)}/hr effective · ${row.hoursSold.toFixed(1)} hrs`
                : 'Hours not reported'}
        </p>
      </div>
      <Cell label="Today">{row.appointmentsToday}</Cell>
      <Cell label="ROs">{row.rosClosed}</Cell>
      <Cell label="Sold">{money(row.sold)}</Cell>
      <Cell label="Covered">
        <span className={row.covered > 0 ? 'text-emerald-700 dark:text-emerald-400' : ''}>
          {money(row.covered)}
        </span>
      </Cell>
      <Cell label="Per RO">{row.rosClosed === 0 ? '—' : money(row.averagePerRo)}</Cell>
    </div>
  )
}

function Tab({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`touch-target inline-flex items-center rounded-full border px-3.5 py-2 text-xs font-semibold transition ${
        active
          ? 'border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900'
          : 'border-[var(--border)] hover:border-neutral-900 dark:hover:border-neutral-300'
      }`}
    >
      {children}
    </Link>
  )
}

export default async function ManagerPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const user = await requireUser()

  /**
   * Not a redirect.
   *
   * An advisor who lands here from a shared bookmark should read one sentence
   * explaining why this page is not theirs, rather than being bounced somewhere
   * else and left wondering whether the click registered.
   */
  if (!MANAGER_ROLES.has(user.role)) {
    return (
      <main className="mx-auto max-w-lg px-6 py-20 text-center">
        <h1 className="text-xl font-bold">This is the service manager&rsquo;s board</h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">
          It shows department results across every advisor. Your own numbers — including the ones
          nobody else sees — are on your scorecard.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link
            href="/advisor/scorecard"
            className="touch-target rounded-xl bg-neutral-900 px-4 py-2.5 text-sm font-bold text-white dark:bg-white dark:text-neutral-900"
          >
            My scorecard
          </Link>
          <Link
            href="/drive"
            className="touch-target rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-bold"
          >
            Today&rsquo;s drive
          </Link>
        </div>
      </main>
    )
  }

  const store = await getDefaultStore()
  if (!store) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="text-xl font-bold">No store found</h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">
          Run <code className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">npm run db:seed</code>.
        </p>
      </main>
    )
  }

  const params = await searchParams
  const asOf = DAY()
  const monthly = params.period === 'month'
  // Month-to-date against the same days of last month. Twelve days of August
  // measured against all of July reports a collapse that did not happen.
  const period = monthly ? monthToDatePeriod(asOf) : weekPeriod(asOf)
  const previous = monthly ? monthToDatePeriod(asOf, 1) : weekPeriod(asOf, 1)

  const dayStart = new Date(asOf)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(dayStart)
  dayEnd.setDate(dayEnd.getDate() + 1)

  const [advisors, appointments, repairOrders, previousRepairOrders, followUps] = await Promise.all([
    loadAdvisors(user.storeId),
    loadAppointments(user.storeId, dayStart, dayEnd),
    loadRepairOrders(user.storeId, period),
    loadRepairOrders(user.storeId, previous),
    loadBacklog(user.storeId),
  ])

  const board = buildBoard({
    advisors,
    appointments,
    repairOrders,
    previousRepairOrders,
    followUps,
    period,
    asOf,
  })

  const { department, drive, backlog } = board
  const trend = department.soldChangePercent

  return (
    <main className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-8">
      <header className="border-b border-[var(--border)] pb-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <p className="text-xs font-bold uppercase tracking-widest text-neutral-500">
            {store.name} · Service department
          </p>
          <nav className="flex items-center gap-3 text-sm text-neutral-500">
            <Link href="/drive" className="hover:underline">Today&rsquo;s drive</Link>
            <Link href="/follow-up" className="hover:underline">Follow-ups</Link>
            <Link href="/customers" className="hover:underline">Customers</Link>
            <UserBadge />
          </nav>
        </div>

        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">The department</h1>
            <p className="mt-1 text-neutral-600 dark:text-neutral-400">
              {asOf.toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}{' '}
              · {period.label.toLowerCase()}
            </p>
          </div>
          <div className="flex gap-2">
            <Tab href="/manager" active={!monthly}>This week</Tab>
            <Tab href="/manager?period=month" active={monthly}>Month to date</Tab>
          </div>
        </div>
      </header>

      {/* ------------------------------------------------------- attention */}
      {board.attention.length > 0 && (
        <section className="mt-5 space-y-3">
          {board.attention.map((item) => (
            <AttentionRow key={item.key} item={item} />
          ))}
        </section>
      )}

      {/* ------------------------------------------------------ department */}
      <section className="mt-6">
        <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-neutral-500">
          {period.label}
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Sold"
            value={money(department.sold)}
            sub={
              trend === null
                ? 'No previous period to compare against'
                : `${trend >= 0 ? '↑' : '↓'} ${Math.abs(Math.round(trend))}% on ${monthly ? 'last month to the same day' : 'the week before'}`
            }
          />
          <Stat
            label="Covered revenue"
            value={money(department.covered)}
            tone={department.covered > 0 ? 'good' : 'default'}
            sub="Warranty and contract work the customer did not pay for."
          />
          <Stat
            label="Repair orders"
            value={String(department.rosClosed)}
            sub={
              department.rosClosed === 0
                ? 'Nothing closed yet in this window'
                : `${money(department.averagePerRo)} average ticket`
            }
          />
          <Stat
            label="Effective labor rate"
            value={
              department.effectiveLaborRate === null
                ? '—'
                : `${money(department.effectiveLaborRate)}/hr`
            }
            sub={
              department.effectiveLaborRate === null
                ? 'Not enough hours reported to state a rate'
                : `${department.hoursSold.toFixed(1)} hours sold`
            }
          />
        </div>
      </section>

      {/* ----------------------------------------------------------- today */}
      <section className="mt-6">
        <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-neutral-500">
          On the drive today
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Appointments" value={String(drive.total)} sub="Booked for today." />
          <Stat label="In the shop" value={String(drive.active)} sub="Arrived or in service." />
          <Stat label="Still to come" value={String(drive.notArrived)} sub="Not arrived yet." />
          <Stat
            label="No advisor"
            value={String(drive.unassigned)}
            tone={drive.unassigned > 0 ? 'alert' : 'default'}
            sub={
              drive.unassigned > 0
                ? 'Nobody is preparing these.'
                : 'Every appointment is owned.'
            }
          />
        </div>
      </section>

      {/* --------------------------------------------------------- advisors */}
      <section className="mt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-neutral-500">
            Advisors
          </h2>
          <p className="text-xs text-neutral-500">Ranked by sold value</p>
        </div>
        <Card className="mt-3 py-2">
          <AdvisorHeader />
          {board.advisors.map((row) => (
            <AdvisorRowView key={row.advisorId} row={row} quiet={row.rosClosed === 0} />
          ))}
          {board.advisors.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-neutral-500">
              No advisors have an active role at this store.
            </p>
          )}
        </Card>
        {/*
          Said plainly, on the page, rather than left for an advisor to
          discover. The moment someone suspects their coaching numbers are
          being read here, they stop recording honest ones.
        */}
        <p className="mt-2 text-xs leading-relaxed text-neutral-500">
          Results only — closed repair orders and today&rsquo;s bookings, the same facts as your DMS
          report. Opportunity capture, easy-yes rate and streaks stay on each advisor&rsquo;s own
          scorecard and are not shown here.
        </p>
      </section>

      {/* ---------------------------------------------------------- backlog */}
      <section className="mt-6 pb-10">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-neutral-500">
            Follow-up backlog
          </h2>
          {/*
            The worklist shows a three-day window; this is everything open.
            Without saying so, the two pages look like they disagree.
          */}
          <p className="text-xs text-neutral-500">
            Everything open — the worklist itself shows the next three days
          </p>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Open"
            value={String(backlog.total)}
            sub={`${money(backlog.value)} of quoted work on the list.`}
          />
          <Stat
            label="Past due"
            value={String(backlog.overdue)}
            tone={backlog.overdue > 0 ? 'alert' : 'default'}
            sub={
              backlog.overdue === 0
                ? 'Nothing is late.'
                : `Oldest is ${backlog.worstOverdueDays} day${backlog.worstOverdueDays === 1 ? '' : 's'} late.`
            }
          />
          <Stat label="Due today" value={String(backlog.dueToday)} sub="Still workable today." />
          <Stat
            label="Advisor / BDC"
            value={`${backlog.byOwner.ADVISOR} / ${backlog.byOwner.BDC}`}
            sub="Follow-ups are owned by role, not assigned to a person."
          />
        </div>
        <Link
          href="/follow-up?owner=ALL"
          className="touch-target mt-4 inline-block rounded-xl bg-neutral-900 px-4 py-2.5 text-sm font-bold text-white dark:bg-white dark:text-neutral-900"
        >
          Open the worklist
        </Link>
      </section>
    </main>
  )
}
