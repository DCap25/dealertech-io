import Link from 'next/link'
import { WorkspaceNav } from '@/components/auth/workspace-nav'
import { loadDriveRange } from '@/lib/prep-sheet/load'
import {
  booksForDay, cardsByDay, dayKey, defaultWeekView, mineCards, toWeekCard, weekDays,
  type WeekCard, type WeekView,
} from '@/lib/drive/week'
import { timeOf } from '../ui'
import { demoNow } from '@/lib/demo-day'
import { requireUser, getCurrentStore } from '@/lib/auth/session'
import { fenceSales } from '@/lib/auth/sales'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'The week',
}

/**
 * The week, as advisors' books.
 *
 * Read-only by design (DRIVE_PLAN P1): no booking, no reassignment, no
 * capacity bars — those arrive with P2's scheduling engine. Two shapes over
 * one load:
 *
 *  - "Mine": seven day columns of the signed-in advisor's book, plus the
 *    unassigned pool they might claim.
 *  - "Everyone": rows are books (one per advisor, the pool pinned last),
 *    columns are the days — so uneven books, the thing a manager actually
 *    scans a week for, read down a row at a glance.
 *
 * Deliberately absent: money. Whether a week of projected opportunity belongs
 * here is DRIVE_PLAN §9 Q4, still open — when it is decided, the day-column
 * headers (Mine) and book rows (Everyone) are where totals would land.
 */
export default async function DriveWeekPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; view?: string }>
}) {
  // Enforced here, not only in the middleware — same reasoning as /drive.
  const user = await requireUser()
  // A salesperson has one page and this is not it (DRIVE_PLAN §9 Q2).
  fenceSales(user.role)
  const params = await searchParams
  const store = await getCurrentStore()

  if (!store) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="text-xl font-bold">No store found</h1>
      </main>
    )
  }

  const anchor = params.week ? new Date(`${params.week}T12:00:00`) : demoNow()
  const days = weekDays(anchor)
  const view: WeekView =
    params.view === 'mine' || params.view === 'all'
      ? params.view
      : defaultWeekView(user.isAdvisor)

  // Exclusive upper bound, one day past the visible Sunday.
  const from = new Date(days[0]!)
  from.setHours(0, 0, 0, 0)
  const to = new Date(days[6]!)
  to.setHours(0, 0, 0, 0)
  to.setDate(to.getDate() + 1)

  const sheets = await loadDriveRange(store.id, from, to, demoNow())
  const allCards = sheets
    .map(toWeekCard)
    .filter((c): c is WeekCard => c !== null)
  const byDay = cardsByDay(view === 'mine' ? mineCards(allCards, user.id) : allCards)

  const weekParam = dayKey(days[0]!)
  const stepWeek = (dir: -1 | 1) => {
    const d = new Date(days[0]!)
    d.setDate(d.getDate() + dir * 7)
    return dayKey(d)
  }

  const dayLabel = (d: Date) =>
    d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <p className="text-xs font-bold uppercase tracking-widest text-neutral-500">
            {store.name} · Service Drive
          </p>
          <WorkspaceNav current="week" />
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-bold tracking-tight">
            {view === 'mine' ? 'My week' : 'The week'}
          </h1>
          <div className="flex items-center gap-2">
            {/* The toggle is a filter, not a permission — advisors cover for
                each other, and hiding the store's week buys nothing. */}
            <nav className="flex rounded-lg border border-neutral-200 text-sm font-semibold dark:border-neutral-800">
              <Link
                href={`/drive/week?week=${weekParam}&view=mine`}
                className={`rounded-l-lg px-3 py-1.5 ${view === 'mine' ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : ''}`}
              >
                Mine
              </Link>
              <Link
                href={`/drive/week?week=${weekParam}&view=all`}
                className={`rounded-r-lg px-3 py-1.5 ${view === 'all' ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : ''}`}
              >
                Everyone
              </Link>
            </nav>
            <nav className="flex items-center gap-1 text-sm font-semibold">
              <Link href={`/drive/week?week=${stepWeek(-1)}&view=${view}`} className="rounded-lg border border-neutral-200 px-2.5 py-1.5 dark:border-neutral-800" aria-label="Previous week">←</Link>
              <Link href={`/drive/week?view=${view}`} className="rounded-lg border border-neutral-200 px-2.5 py-1.5 dark:border-neutral-800">This week</Link>
              <Link href={`/drive/week?week=${stepWeek(1)}&view=${view}`} className="rounded-lg border border-neutral-200 px-2.5 py-1.5 dark:border-neutral-800" aria-label="Next week">→</Link>
              {/* The week is where somebody notices a thin Thursday. */}
              <Link href="/drive/book" className="rounded-lg bg-neutral-900 px-2.5 py-1.5 text-white dark:bg-white dark:text-neutral-900">Book</Link>
            </nav>
          </div>
        </div>
        <p className="mt-1 text-neutral-600 dark:text-neutral-400">
          {dayLabel(days[0]!)} – {dayLabel(days[6]!)} · {allCards.length} appointment{allCards.length === 1 ? '' : 's'} on the book
        </p>
      </header>

      {view === 'mine' ? (
        <MineWeek days={days} byDay={byDay} dayLabel={dayLabel} />
      ) : (
        <EveryoneWeek days={days} byDay={byDay} dayLabel={dayLabel} />
      )}
    </main>
  )
}

/** Seven columns of the advisor's own book, pool cards marked. */
function MineWeek({
  days, byDay, dayLabel,
}: {
  days: Date[]
  byDay: Map<string, WeekCard[]>
  dayLabel: (d: Date) => string
}) {
  return (
    <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-7">
      {days.map((day) => {
        const cards = byDay.get(dayKey(day)) ?? []
        return (
          <section key={dayKey(day)} className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
            <div className="flex items-baseline justify-between gap-2">
              <Link href={`/drive?date=${dayKey(day)}`} className="text-xs font-bold uppercase tracking-wide text-neutral-500 hover:underline">
                {dayLabel(day)}
              </Link>
              {/* Book into the day being looked at, not into today. */}
              <Link
                href={`/drive/book?date=${dayKey(day)}`}
                className="text-sm font-bold leading-none text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
                aria-label={`Book on ${dayLabel(day)}`}
              >
                +
              </Link>
            </div>
            <p className="mt-0.5 text-lg font-bold tabular-nums">{cards.length || '—'}</p>
            <ul className="mt-2 space-y-2">
              {cards.map((c) => (
                <li key={c.appointmentId}>
                  <Link
                    href={`/drive/${c.appointmentId}`}
                    className="block rounded-lg border border-neutral-200 p-2 text-sm transition hover:border-neutral-900 dark:border-neutral-800 dark:hover:border-neutral-400"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-xs font-bold tabular-nums">{timeOf(c.scheduledAt)}</span>
                      {c.hasSafetyItem && <span className="h-2 w-2 rounded-full bg-rose-500" aria-label="Safety item" />}
                    </div>
                    <p className="truncate font-semibold">{c.customerName}</p>
                    <p className="truncate text-xs text-neutral-500">{c.vehicleLabel}</p>
                    <div className="mt-1 flex flex-wrap gap-1 text-[10px] font-medium text-neutral-600 dark:text-neutral-400">
                      <span className="rounded bg-neutral-100 px-1 py-0.5 dark:bg-neutral-800">{c.transportType.replace(/_/g, ' ')}</span>
                      {c.promisedAt && <span className="rounded bg-neutral-100 px-1 py-0.5 tabular-nums dark:bg-neutral-800">promised {timeOf(c.promisedAt)}</span>}
                      {!c.advisorId && <span className="rounded bg-amber-100 px-1 py-0.5 text-amber-900 dark:bg-amber-950 dark:text-amber-200">unassigned</span>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

/**
 * Rows are books, columns are days — uneven books read down a row at a
 * glance, which is the thing a manager opens this view for.
 */
function EveryoneWeek({
  days, byDay, dayLabel,
}: {
  days: Date[]
  byDay: Map<string, WeekCard[]>
  dayLabel: (d: Date) => string
}) {
  // The row set is the union of every day's books, so a writer who is off
  // Tuesday still holds their row and the grid does not reshuffle mid-week.
  const rowNames = new Map<string, string>()
  let hasPool = false
  for (const day of days) {
    for (const book of booksForDay(byDay.get(dayKey(day)) ?? [])) {
      if (book.advisorId) rowNames.set(book.advisorId, book.advisorName)
      else hasPool = true
    }
  }
  const rows: { advisorId: string | null; name: string }[] = [
    ...[...rowNames.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([advisorId, name]) => ({ advisorId, name })),
    ...(hasPool ? [{ advisorId: null, name: 'Unassigned' }] : []),
  ]

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-neutral-300 p-10 text-center text-neutral-500 dark:border-neutral-700">
        Nothing on the book this week.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="p-2 text-left text-xs font-bold uppercase tracking-wide text-neutral-500">Book</th>
            {days.map((day) => (
              <th key={dayKey(day)} className="p-2 text-left text-xs font-bold uppercase tracking-wide text-neutral-500">
                <Link href={`/drive?date=${dayKey(day)}`} className="hover:underline">{dayLabel(day)}</Link>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.advisorId ?? 'pool'} className="border-t border-neutral-200 align-top dark:border-neutral-800">
              <td className="p-2 font-semibold">{row.name}</td>
              {days.map((day) => {
                const cards = (byDay.get(dayKey(day)) ?? []).filter((c) => c.advisorId === row.advisorId)
                return (
                  <td key={dayKey(day)} className="p-2">
                    {cards.length === 0 ? (
                      <span className="text-neutral-300 dark:text-neutral-700">—</span>
                    ) : (
                      <div className="space-y-1">
                        <p className="text-xs font-bold tabular-nums text-neutral-500">{cards.length}</p>
                        {cards.map((c) => (
                          <Link
                            key={c.appointmentId}
                            href={`/drive/${c.appointmentId}`}
                            className="block truncate rounded border border-neutral-200 px-1.5 py-1 text-xs transition hover:border-neutral-900 dark:border-neutral-800 dark:hover:border-neutral-400"
                          >
                            <span className="font-mono font-bold tabular-nums">{timeOf(c.scheduledAt)}</span>{' '}
                            {c.customerName}
                            {c.hasSafetyItem && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-rose-500" aria-label="Safety item" />}
                            {c.isWaiter && <span className="ml-1 text-[10px] text-neutral-500">waiter</span>}
                          </Link>
                        ))}
                      </div>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
