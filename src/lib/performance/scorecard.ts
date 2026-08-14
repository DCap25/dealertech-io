import { buildInsights } from './insights'
import { buildMetrics, inPeriod, visitsWorked } from './metrics'
import { buildStreaks } from './streaks'
import type { OutcomeRecord, Period, Scorecard, SoldLineRecord } from './types'

/**
 * Assemble a scorecard. Pure — the loader hands it everything it needs.
 */

/** Weeks start Monday: a service week does, and a Sunday reset splits Saturday off. */
export function startOfWeek(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  const day = out.getDay()
  const daysSinceMonday = (day + 6) % 7
  out.setDate(out.getDate() - daysSinceMonday)
  return out
}

export function weekPeriod(asOf: Date, weeksAgo = 0): Period {
  const start = startOfWeek(asOf)
  start.setDate(start.getDate() - weeksAgo * 7)
  const end = new Date(start)
  end.setDate(end.getDate() + 7)
  return {
    start,
    end,
    label: weeksAgo === 0 ? 'This week' : weeksAgo === 1 ? 'Last week' : `${weeksAgo} weeks ago`,
  }
}

export function monthPeriod(asOf: Date, monthsAgo = 0): Period {
  const start = new Date(asOf.getFullYear(), asOf.getMonth() - monthsAgo, 1)
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 1)
  return {
    start,
    end,
    label: monthsAgo === 0 ? 'This month' : start.toLocaleString('en-US', { month: 'long' }),
  }
}

/**
 * The first N days of a month, where N is how much of the current one has
 * elapsed.
 *
 * The comparison a fixed-ops manager actually makes. `monthPeriod` measures
 * twelve days of August against thirty-one days of July and reports the
 * shortfall as a collapse — the arrow is dead wrong for four weeks out of
 * every five, and it points the wrong way at the exact moment someone is
 * deciding whether the month is in trouble.
 */
export function monthToDatePeriod(asOf: Date, monthsAgo = 0): Period {
  const start = new Date(asOf.getFullYear(), asOf.getMonth() - monthsAgo, 1)
  const monthEnd = new Date(start.getFullYear(), start.getMonth() + 1, 1)

  // Through the same day of the month, inclusive. Clamped so the 31st of a
  // long month does not run past the end of a short one.
  const end = new Date(start.getFullYear(), start.getMonth(), asOf.getDate() + 1)

  return {
    start,
    end: end > monthEnd ? monthEnd : end,
    label:
      monthsAgo === 0
        ? 'Month to date'
        : `${start.toLocaleString('en-US', { month: 'long' })} to the same day`,
  }
}

/**
 * The most recent day this advisor did anything we can measure.
 *
 * Used to avoid showing a wall of zeros to someone who was simply off that
 * week. A scorecard that reads "0%" when the real answer is "you weren't
 * here" is worse than no scorecard — the advisor learns to ignore the page.
 */
export function latestActivity(
  outcomes: OutcomeRecord[],
  soldLines: SoldLineRecord[],
): Date | null {
  let latest: Date | null = null
  for (const o of outcomes) {
    if (!latest || o.decidedAt > latest) latest = o.decidedAt
  }
  for (const l of soldLines) {
    if (!latest || l.closedAt > latest) latest = l.closedAt
  }
  return latest
}

/** True when nothing at all happened in the window. */
export function periodIsEmpty(
  outcomes: OutcomeRecord[],
  soldLines: SoldLineRecord[],
  period: Period,
): boolean {
  return (
    !outcomes.some((o) => inPeriod(o.decidedAt, period)) &&
    !soldLines.some((l) => inPeriod(l.closedAt, period))
  )
}

export interface ScorecardInputs {
  /** Every outcome for this advisor, any period. Filtering happens here. */
  outcomes: OutcomeRecord[]
  soldLines: SoldLineRecord[]
  period: Period
  previousPeriod?: Period
}

export function buildScorecard({
  outcomes,
  soldLines,
  period,
  previousPeriod,
}: ScorecardInputs): Scorecard {
  const current = outcomes.filter((o) => inPeriod(o.decidedAt, period))
  const currentLines = soldLines.filter((l) => inPeriod(l.closedAt, period))

  const previous = previousPeriod
    ? {
        outcomes: outcomes.filter((o) => inPeriod(o.decidedAt, previousPeriod)),
        soldLines: soldLines.filter((l) => inPeriod(l.closedAt, previousPeriod)),
      }
    : undefined

  const metrics = buildMetrics({ outcomes: current, soldLines: currentLines, previous })

  /**
   * Streaks run across all history, not just this period — a run that started
   * last week is still a run, and clipping it at a period boundary would be an
   * artefact of the calendar rather than anything the advisor did.
   */
  const streaks = buildStreaks(outcomes)

  return {
    period,
    metrics,
    insights: buildInsights(current),
    streaks,
    visitsWorked: visitsWorked(current),
    personalBest: findPersonalBest(metrics, streaks),
  }
}

/**
 * A personal best is beating your own previous number. There is deliberately
 * no comparison against other advisors anywhere in this file.
 */
function findPersonalBest(
  metrics: Scorecard['metrics'],
  streaks: Scorecard['streaks'],
): Scorecard['personalBest'] {
  const streakBest = streaks.find((s) => s.current > 0 && s.current >= s.best)
  if (streakBest) {
    return {
      metricKey: streakBest.key,
      label: `Best run yet: ${streakBest.current} visit${streakBest.current === 1 ? '' : 's'} — ${streakBest.label.toLowerCase()}`,
    }
  }

  // Needs a real prior period to beat, and a sample worth the claim.
  const improved = metrics
    .filter((m) => m.changePercent !== null && m.changePercent > 10 && m.sampleSize >= 5)
    .sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0))[0]

  return improved
    ? {
        metricKey: improved.key,
        label: `${improved.label} up ${Math.round(improved.changePercent!)}% on last period`,
      }
    : null
}
