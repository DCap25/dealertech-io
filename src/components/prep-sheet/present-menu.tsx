'use client'

import { useMemo, useState } from 'react'
import { money } from '@/components/ui/primitives'
import { ExplainerPlayer } from '@/components/explainer/explainer-player'
import {
  customerDetail, easyYesReasons, isCustomerFacing,
  type OpportunityDecision,
} from '@/lib/prep-sheet/presentation'
import { explainerFor, worstReadingFor } from '@/lib/explainer'
import { buildMenu, TIER_COPY, type MenuSelection } from '@/lib/menu/selection'
import { PrintableMenu } from './printable-menu'
import type { Opportunity, PrepSheet } from '@/lib/prep-sheet'

/**
 * Customer-facing menu.
 *
 * Deliberately different from the advisor view: no gross, no close
 * probability, no talk track, no internal ranking language. A customer should
 * see what their car needs, what they already own, and what it costs them —
 * turning the tablet around should never expose how the sausage is made.
 *
 * ---------------------------------------------------------------------------
 * WHAT A TAP MEANS
 * ---------------------------------------------------------------------------
 * Yes and Not today record a *preference*, not a repair authorization. The
 * advisor still authorises work the way they always have. That boundary is
 * deliberate: authorization requirements vary by state — written estimate
 * thresholds, re-authorization when the price moves — and a tablet that
 * quietly created a legal record we had not got right would be worse than one
 * that does not try.
 */

const TIER_ACCENT: Record<string, string> = {
  NOW: 'border-l-rose-500',
  SOON: 'border-l-amber-500',
  PLANNED: 'border-l-neutral-300 dark:border-l-neutral-600',
}

export function PresentMenu({
  sheet,
  selection,
  decisions,
  onCustomerDecision,
  onPrint,
  onClose,
}: {
  sheet: PrepSheet
  /** What the advisor chose to show. Built one screen earlier. */
  selection: MenuSelection
  decisions: Record<string, OpportunityDecision>
  /** Records a preference. See the note above — this is not authorization. */
  onCustomerDecision?: (opportunityId: string, decision: OpportunityDecision) => void
  onPrint?: () => void
  onClose: () => void
}) {
  const [explaining, setExplaining] = useState<Opportunity | null>(null)

  // The advisor built this one screen earlier. Nothing is filtered here — a
  // customer menu that quietly disagreed with the menu the advisor approved
  // would defeat the point of approving it.
  const menu = useMemo(
    () => buildMenu(sheet.opportunities, selection),
    [sheet.opportunities, selection],
  )

  const shown = menu.items.map((i) => i.opportunity)
  const accepted = shown.filter((o) => decisions[o.id] === 'ACCEPTED')
  const acceptedTotal = accepted.reduce((s, o) => s + o.customerOutOfPocket, 0)
  const customerTotal = menu.customerTotal
  const coveredTotal = menu.coveredTotal

  // worstReadingFor picks the newest inspection itself — the history has no
  // guaranteed order and assuming one showed a customer the wrong number.
  const explainingReading = explaining
    ? worstReadingFor(explainerFor(explaining.componentGroupKey)!, sheet.inspectionHistory)
    : null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[var(--background)]">
      <div className="mx-auto max-w-3xl px-5 py-8 pb-32 sm:px-6">
        <header className="border-b border-[var(--border)] pb-5">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-neutral-500">
            Recommended service
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">
            {sheet.vehicle.modelYear} {sheet.vehicle.make} {sheet.vehicle.model}
          </h1>
          <p className="mt-1 text-neutral-600 dark:text-neutral-400">
            {sheet.customer.name} · {sheet.projectedMileage.toLocaleString()} miles
          </p>
        </header>

        {coveredTotal > 0 && (
          <div className="mt-5 rounded-2xl border border-emerald-300 bg-emerald-50 p-5 dark:border-emerald-800 dark:bg-emerald-950">
            <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
              Coverage you already own pays for
            </p>
            <p className="mt-1 text-4xl font-bold tabular-nums text-emerald-900 dark:text-emerald-100">
              {money(coveredTotal)}
            </p>
            <p className="mt-1 text-sm text-emerald-800 dark:text-emerald-300">
              of the work recommended below.
            </p>
          </div>
        )}

        {menu.tiers.map((group) => {
          const tier = group.tier
          return (
            <section key={tier} className="mt-8">
              <h2 className="text-xl font-bold tracking-tight">{TIER_COPY[tier].title}</h2>
              <p className="mt-0.5 text-sm text-neutral-500">{TIER_COPY[tier].blurb}</p>

              <ul className="mt-3 space-y-3">
                {group.items.map(({ opportunity: o }) => {
                  const explainer = explainerFor(o.componentGroupKey)
                  const reasons = easyYesReasons(o).filter(
                    (r) => r.tone === 'COVERED' || r.tone === 'SAFETY',
                  )
                  const savings = Math.max(0, o.estimatedAmount - o.customerOutOfPocket)
                  const decision = decisions[o.id]

                  return (
                    <li
                      key={o.id}
                      className={`rounded-2xl border border-l-4 p-5 ${TIER_ACCENT[tier]} ${
                        decision === 'ACCEPTED'
                          ? 'border-emerald-400 bg-emerald-50/60 dark:border-emerald-700 dark:bg-emerald-950/40'
                          : decision === 'DECLINED'
                            ? 'border-[var(--border)] bg-[var(--surface-muted)] opacity-70'
                            : 'border-[var(--border)] bg-[var(--surface)]'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <h3 className="text-lg font-bold">{o.title}</h3>
                          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                            {customerDetail(o)}
                          </p>
                          {reasons.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {reasons.map((r) => (
                                <span
                                  key={r.key}
                                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                                    r.tone === 'SAFETY'
                                      ? 'bg-rose-600 text-white'
                                      : 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
                                  }`}
                                >
                                  {r.label}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-2xl font-bold tabular-nums">
                            {o.customerOutOfPocket === 0 ? 'No charge' : money(o.customerOutOfPocket)}
                          </p>
                          {savings > 0 && (
                            <p className="text-sm text-neutral-500 line-through tabular-nums">
                              {money(o.estimatedAmount)}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        {/*
                          Offered before the choice, not after it. A customer
                          who wants to understand the item should not have to
                          commit to it first.
                        */}
                        {explainer && (
                          <button
                            type="button"
                            onClick={() => setExplaining(o)}
                            className="touch-target inline-flex items-center gap-2 rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-semibold transition hover:border-neutral-900 dark:hover:border-neutral-300"
                          >
                            <span aria-hidden>▶</span> Show me why
                          </button>
                        )}

                        {onCustomerDecision && (
                          <div className="ml-auto flex gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                onCustomerDecision(o.id, decision === 'DECLINED' ? 'PENDING' : 'DECLINED')
                              }
                              aria-pressed={decision === 'DECLINED'}
                              className={`touch-target rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${
                                decision === 'DECLINED'
                                  ? 'border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900'
                                  : 'border-[var(--border)] hover:border-neutral-900 dark:hover:border-neutral-300'
                              }`}
                            >
                              Not today
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                onCustomerDecision(o.id, decision === 'ACCEPTED' ? 'PENDING' : 'ACCEPTED')
                              }
                              aria-pressed={decision === 'ACCEPTED'}
                              className={`touch-target rounded-xl border px-5 py-2.5 text-sm font-bold transition ${
                                decision === 'ACCEPTED'
                                  ? 'border-emerald-600 bg-emerald-600 text-white'
                                  : 'border-[var(--border)] hover:border-emerald-600'
                              }`}
                            >
                              Yes
                            </button>
                          </div>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}

        <div className="mt-8 rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-5">
          <div className="flex items-baseline justify-between gap-4">
            <span className="font-semibold">Everything recommended</span>
            <span className="text-2xl font-bold tabular-nums">{money(customerTotal)}</span>
          </div>
          <div className="mt-3 flex items-baseline justify-between gap-4 border-t border-[var(--border)] pt-3">
            <span className="font-semibold">
              What you have said yes to
              <span className="ml-2 text-sm font-normal text-neutral-500">
                {accepted.length} of {shown.length}
              </span>
            </span>
            <span className="text-3xl font-bold tabular-nums">{money(acceptedTotal)}</span>
          </div>
        </div>

        <p className="mt-4 text-xs leading-relaxed text-neutral-500">
          Choosing here tells your advisor what you would like done — they will confirm the work and
          the final price with you before anything starts. Coverage shown is based on the products on
          file for this vehicle and is confirmed with the administrator or manufacturer before work
          begins. Prices are estimates until parts are confirmed.
        </p>
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-[var(--border)] bg-[var(--background)]/95 px-5 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-3xl gap-2">
          {onPrint && (
            <button
              type="button"
              onClick={onPrint}
              className="touch-target rounded-xl border border-[var(--border)] px-4 py-3 text-sm font-bold"
            >
              Print
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="touch-target flex-1 rounded-xl bg-neutral-900 px-4 py-3 text-sm font-bold text-white transition active:scale-[0.98] dark:bg-white dark:text-neutral-900"
          >
            Back to advisor view
          </button>
        </div>
      </div>

      {/*
        Hidden on screen, and the whole document when printed. Built from the
        same selection as everything above, so the paper fallback is the same
        menu rather than a second thing to keep in step with it.
      */}
      <PrintableMenu sheet={sheet} menu={menu} printedAt={sheet.appointment?.scheduledAt ?? new Date()} />

      {explaining && explainerFor(explaining.componentGroupKey) && (
        <ExplainerPlayer
          explainer={explainerFor(explaining.componentGroupKey)!}
          reading={explainingReading}
          onClose={() => setExplaining(null)}
        />
      )}
    </div>
  )
}
