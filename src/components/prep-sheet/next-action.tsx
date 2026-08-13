'use client'

import { money } from '@/components/ui/primitives'
import { categorize, type NextAction } from '@/lib/prep-sheet/command-center'

/**
 * The persistent "do this next" callout.
 *
 * One item, never a list. An advisor mid-conversation can hold one next action
 * in their head; a ranked list of five is the thing they already have below
 * this, and repeating it here would just be louder, not clearer.
 */
export function NextActionCallout({
  next,
  onPresent,
  onShowWear,
  onAskCopilot,
}: {
  next: NextAction
  onPresent: (id: string) => void
  onShowWear?: (opportunityId: string) => void
  onAskCopilot?: (opportunityId: string, title: string) => void
}) {
  const o = next.opportunity
  const category = categorize(o)
  const covered = Math.max(0, o.estimatedAmount - o.customerOutOfPocket)
  const safety = o.urgency === 'SAFETY'

  return (
    <div
      className={`card-enter overflow-hidden rounded-2xl border-2 ${
        safety
          ? 'border-rose-500 bg-rose-50 dark:border-rose-700 dark:bg-rose-950/60'
          : 'border-neutral-900 bg-[var(--surface)] dark:border-neutral-100'
      }`}
    >
      <div className="flex items-center justify-between gap-3 px-4 pt-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-neutral-500">
          Present next
        </p>
        <p className="text-[11px] font-semibold text-neutral-500">
          {next.remaining} left on the sheet
        </p>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4 px-4 pb-3 pt-1.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--surface-muted)] text-sm"
            >
              {category.glyph}
            </span>
            <h2 className="text-xl font-bold leading-tight sm:text-2xl">{o.title}</h2>
          </div>
          <p className="mt-1.5 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
            {next.reason}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-3xl font-bold tabular-nums leading-none">
            {o.estimatedAmount === 0 ? 'Free' : money(o.customerOutOfPocket)}
          </p>
          {covered > 0 && (
            <p className="mt-1 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
              {money(covered)} covered
            </p>
          )}
        </div>
      </div>

      {o.talkTrack && (
        <p className="mx-4 mb-3 rounded-xl bg-[var(--surface-muted)] px-3 py-2.5 text-sm italic leading-relaxed">
          “{o.talkTrack}”
        </p>
      )}

      <div className="flex flex-wrap gap-2 border-t border-[var(--border)] px-4 py-3">
        <button
          type="button"
          onClick={() => onPresent(o.id)}
          className="touch-target flex-1 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white transition active:scale-[0.98] hover:bg-emerald-700 sm:flex-none sm:px-6"
        >
          Add to RO
        </button>
        {onShowWear && o.type === 'WEAR_PREDICTED' && (
          <button
            type="button"
            onClick={() => onShowWear(o.id)}
            className="touch-target rounded-xl border border-[var(--border)] px-4 py-3 text-sm font-semibold transition active:scale-[0.98] hover:border-neutral-900 dark:hover:border-neutral-300"
          >
            Show the measurements
          </button>
        )}
        {onAskCopilot && (
          <button
            type="button"
            onClick={() => onAskCopilot(o.id, o.title)}
            className="touch-target rounded-xl px-4 py-3 text-sm font-semibold text-neutral-500 transition active:scale-[0.98] hover:text-neutral-900 dark:hover:text-white"
          >
            ✦ How do I say it?
          </button>
        )}
      </div>
    </div>
  )
}
