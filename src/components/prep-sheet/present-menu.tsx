'use client'

import { useMemo } from 'react'
import { ServiceMenu, money } from '@/components/present/service-menu'
import { buildDeviceSnapshot } from '@/lib/pairing/snapshot'
import type { OpportunityDecision } from '@/lib/prep-sheet/presentation'
import type { MenuSelection } from '@/lib/menu/selection'
import { PrintableMenu } from './printable-menu'
import type { PrepSheet } from '@/lib/prep-sheet'

/**
 * Turning the tablet around, from the advisor's own screen.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS RENDERS THE DEVICE SNAPSHOT
 * ---------------------------------------------------------------------------
 * The customer menu reaches people three ways — this screen physically turned
 * around, a paired tablet, and a link on their phone. This one used to build
 * its own list from `Opportunity` objects while the other two rendered
 * `buildDeviceSnapshot`, and they drifted exactly where you would expect: the
 * tablet learned to withhold a price the store cannot bill, and this screen
 * kept showing the number for another two commits.
 *
 * So it builds the same snapshot the tablet is sent and hands it to the same
 * component. An advisor previewing the menu now sees literally what the
 * customer would see — including the redactions. Anything the customer must not
 * see is absent from the data rather than merely unrendered, which is the whole
 * reason the snapshot is a whitelist.
 *
 * What stays here is chrome: an overlay, running totals for the advisor, and
 * the way back out.
 *
 * ---------------------------------------------------------------------------
 * WHAT A TAP MEANS
 * ---------------------------------------------------------------------------
 * Yes, Not today and Call me record a *preference*, not a repair authorization.
 * The advisor still authorises work the way they always have. That boundary is
 * deliberate: authorization requirements vary by state — written estimate
 * thresholds, re-authorization when the price moves — and a tablet that quietly
 * created a legal record we had not got right would be worse than one that does
 * not try.
 */

const NOOP = () => {}

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
  // The advisor built this one screen earlier. Nothing is filtered here — a
  // customer menu that quietly disagreed with the menu the advisor approved
  // would defeat the point of approving it.
  const snapshot = useMemo(() => buildDeviceSnapshot(sheet, selection), [sheet, selection])

  const items = snapshot.tiers.flatMap((t) => t.items)
  const accepted = items.filter((i) => decisions[i.id] === 'ACCEPTED')
  // Unpriced lines count as chosen but add nothing — we do not know what they
  // cost, which is why the customer is shown "price to be confirmed". Adding
  // our estimate underneath would put the unhonourable number back on screen by
  // another route. Same rule as the snapshot's own totals.
  const acceptedTotal = accepted
    .filter((i) => i.priceConfirmed)
    .reduce((s, i) => s + i.customerOutOfPocket, 0)

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[var(--background)]">
      <div className="mx-auto max-w-3xl px-5 py-8 pb-32 sm:px-6">
        {/*
          Read-only when there is nobody to record a preference for. A row of
          buttons that silently does nothing is worse than a row of buttons that
          says it is not taking answers.
        */}
        <ServiceMenu
          snapshot={snapshot}
          decisions={decisions}
          onDecide={onCustomerDecision ?? NOOP}
          readOnly={!onCustomerDecision}
        />

        <div className="mt-8 rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-5">
          <div className="flex items-baseline justify-between gap-4">
            <span className="font-semibold">Everything recommended</span>
            <span className="text-2xl font-bold tabular-nums">{money(snapshot.customerTotal)}</span>
          </div>
          <div className="mt-3 flex items-baseline justify-between gap-4 border-t border-[var(--border)] pt-3">
            <span className="font-semibold">
              What you have said yes to
              <span className="ml-2 text-sm font-normal text-neutral-500">
                {accepted.length} of {snapshot.itemCount}
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
      <PrintableMenu
        sheet={sheet}
        selection={selection}
        printedAt={sheet.appointment?.scheduledAt ?? new Date()}
      />
    </div>
  )
}
