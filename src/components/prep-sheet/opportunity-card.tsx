'use client'

import { Badge, money } from '@/components/ui/primitives'
import { easyYesReasons, estimateGross, type OpportunityDecision } from '@/lib/prep-sheet/presentation'
import { categorize } from '@/lib/prep-sheet/command-center'
import type { Opportunity } from '@/lib/prep-sheet'

const PAYER_LABEL: Record<string, string> = {
  OEM_RECALL: 'Recall — OEM pays',
  PPM: 'Prepaid plan',
  TIRE_WHEEL: 'Tire & wheel',
  OEM_WARRANTY: 'Factory warranty',
  VSC: 'Service contract',
  GOODWILL: 'Goodwill',
  CUSTOMER_PAY: 'Customer pay',
}

const URGENCY_ACCENT: Record<string, string> = {
  SAFETY: 'bg-rose-600',
  HIGH: 'bg-amber-500',
  MEDIUM: 'bg-sky-500',
  LOW: 'bg-neutral-300 dark:bg-neutral-700',
}

/** A hint of the chart behind the button, so the tap looks like what it opens. */
function WearSparkline() {
  return (
    <svg width="22" height="12" viewBox="0 0 22 12" aria-hidden className="shrink-0">
      <polyline
        points="1,2 8,5 15,9"
        fill="none" strokeWidth="1.8" strokeLinecap="round"
        className="stroke-current"
      />
      <polyline
        points="15,9 21,11"
        fill="none" strokeWidth="1.8" strokeLinecap="round" strokeDasharray="2 2"
        className="stroke-current opacity-50"
      />
    </svg>
  )
}

const REASON_TONE = {
  COVERED: 'covered',
  SAFETY: 'safety',
  VALUE: 'value',
  CONTEXT: 'context',
} as const

export function OpportunityCard({
  opportunity,
  decision,
  index,
  onDecide,
  onAskCopilot,
  onShowWear,
  ownershipHint,
}: {
  opportunity: Opportunity
  decision: OpportunityDecision
  index: number
  onDecide: (id: string, decision: OpportunityDecision) => void
  onAskCopilot?: (opportunity: Opportunity) => void
  onShowWear?: (opportunity: Opportunity) => void
  /** Set when the customer owns something relevant that does NOT cover this. */
  ownershipHint?: string | null
}) {
  const o = opportunity
  const reasons = easyYesReasons(o).slice(0, 3)
  const gross = estimateGross(o.estimatedAmount)
  const covered = o.likelyPayer !== 'CUSTOMER_PAY'
  const savings = Math.max(0, o.estimatedAmount - o.customerOutOfPocket)
  const category = categorize(o)

  // Exit animation class is chosen by the decision, then the parent removes
  // the card from the list once the animation has had time to play.
  const exitClass =
    decision === 'ACCEPTED' ? 'card-exit-accept'
    : decision === 'DECLINED' ? 'card-exit-decline'
    : decision === 'SKIPPED' ? 'card-exit-skip'
    : ''

  return (
    <li
      className={`card-enter ${exitClass} relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]`}
      style={{ animationDelay: exitClass ? undefined : `${Math.min(index, 8) * 45}ms` }}
    >
      {/* Urgency reads as a colour bar before any text is processed. */}
      <span className={`absolute inset-y-0 left-0 w-1.5 ${URGENCY_ACCENT[o.urgency]}`} aria-hidden />

      <div className="p-4 pl-5 sm:p-5 sm:pl-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {reasons.map((r) => (
                <Badge key={r.key} tone={REASON_TONE[r.tone]}>{r.label}</Badge>
              ))}
            </div>
            <div className="mt-2.5 flex items-center gap-2">
              {/* The everyday jobs read as a family — an advisor spots "tires"
                  before they read the word. */}
              <span
                aria-hidden
                title={category.label}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-muted)] text-sm"
              >
                {category.glyph}
              </span>
              <h3 className="text-xl font-bold leading-tight sm:text-2xl">{o.title}</h3>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
              {o.detail}
            </p>
          </div>

          {/* The number that decides the answer: what THEY pay, not the price. */}
          <div className="shrink-0 text-right">
            <p className="text-3xl font-bold tabular-nums leading-none sm:text-4xl">
              {o.estimatedAmount === 0 ? 'Free' : money(o.customerOutOfPocket)}
            </p>
            {savings > 0 && o.estimatedAmount > 0 && (
              <p className="mt-1 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                {money(savings)} covered
              </p>
            )}
            {!covered && o.estimatedAmount > 0 && (
              <p className="mt-1 text-xs text-neutral-500">
                {money(gross)} gross
              </p>
            )}
            <p className="mt-1.5 text-[11px] uppercase tracking-wide text-neutral-500">
              {PAYER_LABEL[o.likelyPayer] ?? o.likelyPayer}
            </p>
          </div>
        </div>

        {/* Fires where they own something adjacent that will NOT pay for this.
            Naming it first is the difference between a sale and an argument at
            the cashier. */}
        {ownershipHint && (
          <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm leading-relaxed text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
            {ownershipHint}
          </p>
        )}

        {o.talkTrack && (
          <p className="mt-3 rounded-xl bg-[var(--surface-muted)] px-3 py-2.5 text-sm italic leading-relaxed">
            “{o.talkTrack}”
          </p>
        )}

        {/* The measurements behind a wear recommendation are the single most
            persuasive thing on the sheet — one tap, not buried in a menu. */}
        {onShowWear && o.type === 'WEAR_PREDICTED' && (
          <button
            type="button"
            onClick={() => onShowWear(o)}
            className="touch-target mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-semibold transition active:scale-[0.98] hover:border-neutral-900 dark:hover:border-neutral-300"
          >
            <WearSparkline />
            Show wear details
          </button>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onDecide(o.id, 'ACCEPTED')}
            className="touch-target flex-1 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white transition active:scale-[0.97] hover:bg-emerald-700 sm:flex-none sm:px-6"
          >
            Add to RO
          </button>
          <button
            type="button"
            onClick={() => onDecide(o.id, 'DECLINED')}
            className="touch-target flex-1 rounded-xl border border-[var(--border)] px-4 py-3 text-sm font-semibold transition active:scale-[0.97] hover:border-rose-400 hover:text-rose-600 sm:flex-none sm:px-6"
          >
            Declined
          </button>
          <button
            type="button"
            onClick={() => onDecide(o.id, 'SKIPPED')}
            className="touch-target rounded-xl px-4 py-3 text-sm font-medium text-neutral-500 transition active:scale-[0.97] hover:text-neutral-900 dark:hover:text-white"
          >
            Skip
          </button>
          {onAskCopilot && (
            <button
              type="button"
              onClick={() => onAskCopilot(o)}
              aria-label={`Ask the Co-Pilot about ${o.title}`}
              title="Ask the Co-Pilot about this item"
              className="touch-target ml-auto rounded-xl px-4 py-3 text-sm font-semibold text-neutral-500 transition active:scale-[0.97] hover:text-neutral-900 dark:hover:text-white"
            >
              ✦ Co-Pilot
            </button>
          )}
        </div>
      </div>
    </li>
  )
}
