'use client'

import Link from 'next/link'
import { Card, money } from '@/components/ui/primitives'
import type { VisitSummary } from '@/lib/performance'

/**
 * The private card at the end of a visit.
 *
 * Nobody but this advisor sees it. It leads with what they did rather than
 * what they missed — an advisor who dreads this card will stop finishing
 * visits properly, and then the number stops meaning anything.
 */
export function VisitSummaryCard({
  summary,
  saving,
  onDismiss,
}: {
  summary: VisitSummary
  saving: boolean
  onDismiss: () => void
}) {
  const complete = summary.presented === summary.available

  return (
    <Card className="card-enter overflow-hidden">
      <div
        className={`px-5 py-4 ${
          complete
            ? 'bg-emerald-50 dark:bg-emerald-950/50'
            : 'bg-[var(--surface-muted)]'
        }`}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-neutral-500">
              Visit summary · only you see this
            </p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight">
              {summary.presented} of {summary.available} presented
            </h2>
          </div>
          <p
            className={`text-3xl font-bold tabular-nums ${
              complete ? 'text-emerald-700 dark:text-emerald-400' : ''
            }`}
          >
            {Math.round(summary.capturePercent)}%
          </p>
        </div>

        {/* One bar, because the ratio is the whole story. */}
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
          <div
            className={`h-full rounded-full transition-[width] duration-700 ease-out ${
              complete ? 'bg-emerald-500' : 'bg-neutral-900 dark:bg-neutral-200'
            }`}
            style={{ width: `${Math.max(2, summary.capturePercent)}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 px-5 py-4 sm:grid-cols-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-neutral-500">Added to RO</p>
          <p className="text-xl font-bold tabular-nums">{money(summary.acceptedValue)}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-neutral-500">Coverage carried</p>
          <p className="text-xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
            {money(summary.coveredUnlocked)}
          </p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-neutral-500">Not raised</p>
          <p className="text-xl font-bold tabular-nums text-neutral-500">
            {money(summary.leftOnTable)}
          </p>
        </div>
      </div>

      {summary.praise && (
        <p className="border-t border-[var(--border)] px-5 py-3 text-sm leading-relaxed text-emerald-800 dark:text-emerald-300">
          {summary.praise}
        </p>
      )}

      {summary.coaching && (
        <div className="border-t border-[var(--border)] px-5 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">
            One thing for next time
          </p>
          <p className="mt-1 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
            {summary.coaching}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] px-5 py-3">
        <Link
          href="/advisor/scorecard"
          className="touch-target rounded-xl bg-neutral-900 px-4 py-2.5 text-sm font-bold text-white transition active:scale-[0.98] dark:bg-white dark:text-neutral-900"
        >
          My scorecard
        </Link>
        <button
          type="button"
          onClick={onDismiss}
          className="touch-target rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-semibold transition active:scale-[0.98] hover:border-neutral-900 dark:hover:border-neutral-300"
        >
          Back to the sheet
        </button>
        <span className="ml-auto text-xs text-neutral-500">
          {saving ? 'Saving…' : 'Recorded'}
        </span>
      </div>
    </Card>
  )
}
