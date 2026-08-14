import Link from 'next/link'
import { Card } from '@/components/ui/primitives'
import { getDefaultStore } from '@/lib/prep-sheet/load'
import {
  buildScorecard, latestActivity, monthPeriod, periodIsEmpty, weekPeriod,
  type Insight, type Metric, type Streak,
} from '@/lib/performance'
import { loadOutcomes, loadSoldLines } from '@/lib/performance/load'
import { requireUser } from '@/lib/auth/session'
import { demoNow } from '@/lib/demo-day'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'My Scorecard' }

/** Matches the rest of the demo surfaces — the seeded day. */
const DAY = () => demoNow()
/** Far enough back for streaks and month-over-month to have something to say. */
const HISTORY_START = new Date('2026-01-01T00:00:00')

function TrendArrow({ metric }: { metric: Metric }) {
  if (metric.changePercent === null) {
    return (
      <span className="text-xs text-neutral-400" title="No previous period to compare against">
        no prior period
      </span>
    )
  }
  const up = metric.changePercent > 0
  const flat = Math.abs(metric.changePercent) < 1
  const good = flat ? null : up === metric.higherIsBetter

  return (
    <span
      className={`text-xs font-semibold tabular-nums ${
        good === null
          ? 'text-neutral-500'
          : good
            ? 'text-emerald-700 dark:text-emerald-400'
            : 'text-amber-700 dark:text-amber-400'
      }`}
    >
      {flat ? '→' : up ? '↑' : '↓'} {Math.abs(Math.round(metric.changePercent))}%
    </span>
  )
}

function MetricCard({ metric }: { metric: Metric }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
          {metric.label}
        </p>
        <TrendArrow metric={metric} />
      </div>
      <p className="mt-1.5 text-3xl font-bold tabular-nums">{metric.display}</p>
      <p className="mt-2 text-xs leading-relaxed text-neutral-500">{metric.explanation}</p>
      {/*
        Sample size is shown rather than hidden. A 100% capture rate across two
        items is not a 100% capture rate, and an advisor who works that out for
        themselves stops trusting the whole page.
      */}
      <p className="mt-1 text-[11px] text-neutral-400">
        {metric.sampleSize === 0 ? 'No data yet' : `from ${metric.sampleSize} record${metric.sampleSize === 1 ? '' : 's'}`}
      </p>
    </Card>
  )
}

const INSIGHT_STYLE: Record<Insight['tone'], string> = {
  CELEBRATE: 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/60',
  COACH: 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/60',
  NEUTRAL: 'border-[var(--border)] bg-[var(--surface-muted)]',
}

function StreakRow({ streak }: { streak: Streak }) {
  const live = streak.current > 0
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[var(--border)] py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{streak.label}</p>
        <p className="mt-0.5 text-xs text-neutral-500">{streak.detail}</p>
      </div>
      <div className="shrink-0 text-right">
        <p
          className={`text-2xl font-bold tabular-nums ${
            live ? 'text-emerald-700 dark:text-emerald-400' : 'text-neutral-400'
          }`}
        >
          {streak.current}
        </p>
        <p className="text-[11px] text-neutral-500">best {streak.best}</p>
      </div>
    </div>
  )
}

export default async function ScorecardPage() {
  // The signed-in advisor, not whichever row the database returned first.
  const user = await requireUser()
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

  const [outcomes, soldLines] = await Promise.all([
    loadOutcomes(user.storeId, user.id, HISTORY_START),
    loadSoldLines(user.storeId, user.id, HISTORY_START),
  ])

  /**
   * Fall back to the advisor's last active week rather than showing a wall of
   * zeros. "0% capture" and "you weren't working" are different facts, and
   * conflating them teaches an advisor to ignore the page.
   */
  // One instance: `anchor !== DAY()` would compare two fresh Date objects and
  // always be true, pinning the "last active week" banner on permanently.
  const today = DAY()
  const lastActive = latestActivity(outcomes, soldLines)
  const currentWeekEmpty = periodIsEmpty(outcomes, soldLines, weekPeriod(today))
  const anchor = currentWeekEmpty && lastActive ? lastActive : today
  const showingHistory = anchor !== today

  const week = buildScorecard({
    outcomes,
    soldLines,
    period: weekPeriod(anchor),
    previousPeriod: weekPeriod(anchor, 1),
  })
  const month = buildScorecard({
    outcomes,
    soldLines,
    period: monthPeriod(anchor),
    previousPeriod: monthPeriod(anchor, 1),
  })

  const hasProcessData = outcomes.length > 0
  const weekRange = `${week.period.start.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })} – ${new Date(week.period.end.getTime() - 1).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })}`

  return (
    <main className="mx-auto max-w-5xl px-4 py-5 sm:px-6 sm:py-8">
      <Link
        href="/drive"
        className="touch-target inline-flex items-center text-sm text-neutral-500 hover:underline"
      >
        ← Today&rsquo;s drive
      </Link>

      <header className="mt-2 border-b border-[var(--border)] pb-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">My scorecard</h1>
            <p className="mt-1 text-neutral-600 dark:text-neutral-400">
              {user.name} · {week.period.label}
            </p>
          </div>
          {/*
            Said out loud, not implied. An advisor who suspects a manager is
            reading this page will start gaming it within a week.
          */}
          <p className="rounded-full bg-[var(--surface-muted)] px-3 py-1.5 text-xs font-semibold text-neutral-500">
            Private — only you see this
          </p>
        </div>
      </header>

      {week.personalBest && (
        <div className="card-enter mt-5 rounded-2xl border border-emerald-300 bg-emerald-50 px-5 py-4 dark:border-emerald-800 dark:bg-emerald-950">
          <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-800 dark:text-emerald-300">
            Personal best
          </p>
          <p className="mt-1 text-lg font-bold text-emerald-900 dark:text-emerald-100">
            {week.personalBest.label}
          </p>
        </div>
      )}

      {showingHistory && (
        <p className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-sm text-neutral-600 dark:text-neutral-400">
          Nothing recorded this week, so this is your last active week ({weekRange}).
        </p>
      )}

      <section className="mt-5">
        <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-neutral-500">
          {showingHistory ? `Week of ${weekRange}` : 'This week'}
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {week.metrics.map((m) => (
            <MetricCard key={m.key} metric={m} />
          ))}
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          {week.visitsWorked} prep sheet{week.visitsWorked === 1 ? '' : 's'} worked
          {' · '}compared against the week before
        </p>
      </section>

      {!hasProcessData && (
        <Card className="mt-5 p-5">
          <p className="text-sm font-semibold">Capture rates need finished visits</p>
          <p className="mt-1.5 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
            Revenue figures come from closed repair orders and are already populated. Capture and
            easy-yes rates measure what was <em>never</em> raised, which only a finished prep sheet
            records — work a visit on the drive and tap <strong>Finish visit</strong> to start the
            history.
          </p>
          <Link
            href="/drive"
            className="touch-target mt-4 inline-block rounded-xl bg-neutral-900 px-4 py-2.5 text-sm font-bold text-white dark:bg-white dark:text-neutral-900"
          >
            Go to the drive
          </Link>
        </Card>
      )}

      {week.insights.length > 0 && (
        <section className="mt-6">
          <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-neutral-500">
            What the numbers say
          </h2>
          <div className="mt-3 space-y-3">
            {week.insights.map((insight) => (
              <div
                key={insight.key}
                className={`rounded-2xl border p-4 ${INSIGHT_STYLE[insight.tone]}`}
              >
                <p className="font-bold">{insight.headline}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
                  {insight.detail}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {week.streaks.length > 0 && (
        <section className="mt-6">
          <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-neutral-500">
            Streaks
          </h2>
          <Card className="mt-3 px-4 py-1">
            {week.streaks.map((s) => (
              <StreakRow key={s.key} streak={s} />
            ))}
          </Card>
          <p className="mt-2 text-xs text-neutral-500">
            Counted in consecutive visits, not days — a day off never costs you a run.
          </p>
        </section>
      )}

      <section className="mt-6 pb-8">
        <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-neutral-500">
          {month.period.label}
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {month.metrics.map((m) => (
            <MetricCard key={m.key} metric={m} />
          ))}
        </div>
      </section>
    </main>
  )
}
