'use client'

import { useMemo } from 'react'
import { money } from '@/components/ui/primitives'
import {
  buildMenu, excludeAll, includeAll, isIncluded, menuWarnings, move, presentableItems,
  TIER_COPY, TIER_ORDER, toggle,
  type MenuSelection, type MenuTier,
} from '@/lib/menu/selection'
import { customerDetail, type OpportunityDecision } from '@/lib/prep-sheet/presentation'
import { PrintableMenu } from './printable-menu'
import { SendToTablet } from './send-to-tablet'
import type { PrepSheet } from '@/lib/prep-sheet'

/**
 * Build the menu before anyone hands over a tablet.
 *
 * The advisor's last look at what the customer is about to see, on their own
 * screen, with the ability to take something off it. Every other surface in
 * this product ranks things for them; this is the one where they overrule it.
 *
 * Deliberately not a blocker. It opens with everything already selected, so an
 * advisor in a hurry taps straight through to the same menu the product would
 * have produced anyway.
 */

const TIER_ACCENT: Record<MenuTier, string> = {
  NOW: 'border-l-rose-500',
  SOON: 'border-l-amber-500',
  PLANNED: 'border-l-neutral-300 dark:border-l-neutral-600',
}

export function MenuBuilder({
  sheet,
  selection,
  onChange,
  onPresent,
  onPrint,
  onCancel,
  onCustomerDecision,
  onPresented,
}: {
  sheet: PrepSheet
  selection: MenuSelection
  onChange: (next: MenuSelection) => void
  onPresent: () => void
  onPrint: () => void
  onCancel: () => void
  /** Mirrors a customer's taps from a paired tablet onto this screen. */
  onCustomerDecision: (id: string, decision: OpportunityDecision) => void
  onPresented?: (deviceName: string | null) => void
}) {
  const all = useMemo(() => presentableItems(sheet.opportunities), [sheet.opportunities])
  const menu = useMemo(() => buildMenu(sheet.opportunities, selection), [sheet.opportunities, selection])
  const warnings = menuWarnings(menu)

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[var(--background)]">
      <div className="mx-auto max-w-3xl px-5 py-6 pb-32 sm:px-6">
        <header className="border-b border-[var(--border)] pb-4">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-neutral-500">
            Before you hand it over
          </p>
          <h1 className="mt-1.5 text-2xl font-bold tracking-tight sm:text-3xl">Build the menu</h1>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            {sheet.customer.name} · {sheet.vehicle.modelYear} {sheet.vehicle.make}{' '}
            {sheet.vehicle.model}
          </p>
        </header>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onChange(includeAll(all))}
            className="touch-target rounded-xl border border-[var(--border)] px-3.5 py-2 text-xs font-semibold transition hover:border-neutral-900 dark:hover:border-neutral-300"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={() => onChange(excludeAll())}
            className="touch-target rounded-xl border border-[var(--border)] px-3.5 py-2 text-xs font-semibold transition hover:border-neutral-900 dark:hover:border-neutral-300"
          >
            Clear
          </button>
          <span className="ml-auto text-sm text-neutral-500">
            {menu.items.length} of {all.length} on the menu
          </span>
        </div>

        {warnings.map((w) => (
          <p
            key={w}
            className="mt-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
          >
            {w}
          </p>
        ))}

        {TIER_ORDER.map((tier) => {
          const items = all.filter((i) => i.tier === tier)
          if (items.length === 0) return null

          return (
            <section key={tier} className="mt-6">
              <h2 className="text-sm font-bold">{TIER_COPY[tier].title}</h2>
              <p className="mt-0.5 text-xs text-neutral-500">{TIER_COPY[tier].blurb}</p>

              <ul className="mt-2.5 space-y-2">
                {/* Ordered as the customer will see them, so this list is a preview. */}
                {[...items]
                  .sort((a, b) => {
                    const ai = selection.includedIds.indexOf(a.opportunity.id)
                    const bi = selection.includedIds.indexOf(b.opportunity.id)
                    if (ai === -1 && bi === -1) return 0
                    if (ai === -1) return 1
                    if (bi === -1) return -1
                    return ai - bi
                  })
                  .map((item) => {
                    const o = item.opportunity
                    const on = isIncluded(selection, o.id)
                    return (
                      <li
                        key={o.id}
                        className={`rounded-2xl border border-l-4 p-3.5 ${TIER_ACCENT[tier]} ${
                          on ? 'border-[var(--border)] bg-[var(--surface)]' : 'border-[var(--border)] bg-[var(--surface-muted)] opacity-55'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <button
                            type="button"
                            onClick={() => onChange(toggle(selection, o.id))}
                            aria-pressed={on}
                            aria-label={on ? `Remove ${o.title} from the menu` : `Add ${o.title} to the menu`}
                            className={`touch-target mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 text-sm font-bold transition ${
                              on
                                ? 'border-emerald-600 bg-emerald-600 text-white'
                                : 'border-[var(--border)]'
                            }`}
                          >
                            {on ? '✓' : ''}
                          </button>

                          <div className="min-w-0 flex-1">
                            <p className="font-bold leading-snug">{o.title}</p>
                            <p className="mt-0.5 text-xs text-neutral-500">{customerDetail(o)}</p>
                            {/*
                              Said on the advisor's side only, and only when it
                              is a problem. A price the store has no op code for
                              is our estimate, and quoting a number the DMS will
                              not charge is what the morning price pull exists to
                              prevent — so it stays off the customer menu until
                              somebody maps the code.
                            */}
                            {o.priceSource === 'ESTIMATE' && (
                              <p className="mt-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                                No op code for this — the figure is our estimate, not your price.
                                Map it before quoting.
                              </p>
                            )}
                          </div>

                          <div className="shrink-0 text-right">
                            <p className="font-bold tabular-nums">
                              {o.customerOutOfPocket === 0 ? 'No charge' : money(o.customerOutOfPocket)}
                            </p>
                            {o.priceSource === 'ESTIMATE' && (
                              <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                                estimate
                              </p>
                            )}
                            {on && (
                              <div className="mt-1.5 flex justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => onChange(move(selection, all, o.id, -1))}
                                  aria-label={`Move ${o.title} up`}
                                  className="touch-target rounded-lg border border-[var(--border)] px-2 py-1 text-xs"
                                >
                                  ↑
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onChange(move(selection, all, o.id, 1))}
                                  aria-label={`Move ${o.title} down`}
                                  className="touch-target rounded-lg border border-[var(--border)] px-2 py-1 text-xs"
                                >
                                  ↓
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </li>
                    )
                  })}
              </ul>
            </section>
          )
        })}

        <div className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-sm font-semibold">Customer pays</span>
            <span className="text-2xl font-bold tabular-nums">{money(menu.customerTotal)}</span>
          </div>
          {menu.coveredTotal > 0 && (
            <div className="mt-1.5 flex items-baseline justify-between gap-4">
              <span className="text-sm text-neutral-600 dark:text-neutral-400">
                Covered by what they own
              </span>
              <span className="font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                {money(menu.coveredTotal)}
              </span>
            </div>
          )}
        </div>

        <div className="mt-4">
          <SendToTablet
            appointmentId={sheet.appointment?.id ?? null}
            includedIds={selection.includedIds}
            onCustomerDecision={onCustomerDecision}
            onPresented={onPresented}
          />
        </div>

        <p className="mt-3 text-xs leading-relaxed text-neutral-500">
          Items sit in a group because of what was measured, not because of where you put them —
          you can reorder inside a group but not move something between them.
        </p>
      </div>

      {/*
        Printing from here, without ever entering the customer view. The point
        of the fallback is a dead tablet, and reaching it should not require
        the tablet to work first.
      */}
      <PrintableMenu
        sheet={sheet}
        selection={selection}
        printedAt={sheet.appointment?.scheduledAt ?? new Date()}
      />

      <div className="fixed inset-x-0 bottom-0 border-t border-[var(--border)] bg-[var(--background)]/95 px-5 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="touch-target rounded-xl border border-[var(--border)] px-4 py-3 text-sm font-bold"
          >
            Back
          </button>
          <button
            type="button"
            onClick={onPrint}
            disabled={menu.isEmpty}
            className="touch-target rounded-xl border border-[var(--border)] px-4 py-3 text-sm font-bold disabled:opacity-40"
          >
            Print
          </button>
          <button
            type="button"
            onClick={onPresent}
            disabled={menu.isEmpty}
            className="touch-target flex-1 rounded-xl bg-neutral-900 px-4 py-3 text-sm font-bold text-white transition active:scale-[0.98] disabled:opacity-40 dark:bg-white dark:text-neutral-900"
          >
            {menu.isEmpty ? 'Nothing selected' : `Hand to customer · ${menu.items.length} items`}
          </button>
        </div>
      </div>
    </div>
  )
}
