'use client'

import { money } from '@/components/ui/primitives'
import {
  computeRunningTotals, customerDetail, easyYesReasons, isCustomerFacing,
  type OpportunityDecision,
} from '@/lib/prep-sheet/presentation'
import type { PrepSheet } from '@/lib/prep-sheet'

/**
 * Customer-facing menu.
 *
 * Deliberately different from the advisor view: no gross, no close
 * probability, no talk track, no internal ranking language. A customer should
 * see what their car needs, what they already own, and what it costs them —
 * turning the tablet around should never expose how the sausage is made.
 */
export function PresentMenu({
  sheet,
  decisions,
  onClose,
}: {
  sheet: PrepSheet
  decisions: Record<string, OpportunityDecision>
  onClose: () => void
}) {
  const shown = sheet.opportunities.filter(
    (o) => decisions[o.id] !== 'SKIPPED' && isCustomerFacing(o),
  )
  const totals = computeRunningTotals(shown, decisions)
  const customerTotal = shown.reduce((s, o) => s + o.customerOutOfPocket, 0)
  const coveredTotal = shown.reduce(
    (s, o) => s + Math.max(0, o.estimatedAmount - o.customerOutOfPocket),
    0,
  )

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[var(--background)]">
      <div className="mx-auto max-w-3xl px-6 py-8 pb-28">
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
              Your coverage pays for
            </p>
            <p className="mt-1 text-4xl font-bold tabular-nums text-emerald-900 dark:text-emerald-100">
              {money(coveredTotal)}
            </p>
            <p className="mt-1 text-sm text-emerald-800 dark:text-emerald-300">
              of the work recommended below.
            </p>
          </div>
        )}

        <ul className="mt-5 space-y-3">
          {shown.map((o) => {
            const reasons = easyYesReasons(o).filter((r) => r.tone === 'COVERED' || r.tone === 'SAFETY')
            const savings = Math.max(0, o.estimatedAmount - o.customerOutOfPocket)
            const accepted = decisions[o.id] === 'ACCEPTED'
            return (
              <li
                key={o.id}
                className={`rounded-2xl border p-5 ${
                  accepted
                    ? 'border-emerald-400 bg-emerald-50/60 dark:border-emerald-700 dark:bg-emerald-950/40'
                    : 'border-[var(--border)] bg-[var(--surface)]'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-bold">{o.title}</h2>
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
              </li>
            )
          })}
        </ul>

        <div className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-5">
          <div className="flex items-baseline justify-between gap-4">
            <span className="font-semibold">Your total today</span>
            <span className="text-3xl font-bold tabular-nums">{money(customerTotal)}</span>
          </div>
          {totals.acceptedValue > 0 && (
            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
              {money(totals.acceptedCustomerOwes)} of this is approved so far.
            </p>
          )}
        </div>

        <p className="mt-4 text-xs leading-relaxed text-neutral-500">
          Coverage shown is based on the products on file for this vehicle and is confirmed with the
          administrator or manufacturer before work begins. Prices are estimates until parts are
          confirmed.
        </p>
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-[var(--border)] bg-[var(--background)]/95 px-6 py-3 backdrop-blur">
        <div className="mx-auto max-w-3xl">
          <button
            type="button"
            onClick={onClose}
            className="touch-target w-full rounded-xl bg-neutral-900 px-4 py-3 text-sm font-bold text-white transition active:scale-[0.98] dark:bg-white dark:text-neutral-900"
          >
            Back to advisor view
          </button>
        </div>
      </div>
    </div>
  )
}
