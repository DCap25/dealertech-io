'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Card, money } from '@/components/ui/primitives'
import {
  buildCoverageSegments, computeRunningTotals, estimateGross, vinLastSix,
  type OpportunityDecision,
} from '@/lib/prep-sheet/presentation'
import type { PrepSheet } from '@/lib/prep-sheet'
import { CopilotLauncher, CopilotPanel, type CopilotTarget } from '@/components/copilot/copilot-panel'
import { WearDetail } from '@/components/wear/wear-detail'
import type { WearKind } from '@/lib/prep-sheet/wear-view'
import { buildVisitSummary, toOutcomeRecords } from '@/lib/performance'
import { handoffCount, recommendNext } from '@/lib/prep-sheet/command-center'
import { ownershipHint, summarizeOwnership } from '@/lib/prep-sheet/ownership'
import { OwnershipRow } from './ownership-row'
import { NextActionCallout } from './next-action'
import { HandoffPanel } from './handoff-panel'
import { recordVisitOutcomes } from '@/app/drive/outcome-actions'
import { CoverageStack } from './coverage-stack'
import { OpportunityCard } from './opportunity-card'
import { PresentMenu } from './present-menu'
import { VisitSummaryCard } from './visit-summary-card'

/** How long the exit animation gets before the card leaves the list. */
const EXIT_MS = 420

function TotalsBar({
  remaining,
  remainingGross,
  accepted,
  acceptedGross,
  pulseKey,
  worked,
  available,
}: {
  remaining: number
  remainingGross: number
  accepted: number
  acceptedGross: number
  pulseKey: number
  worked: number
  available: number
}) {
  const percent = available === 0 ? 0 : (worked / available) * 100
  const complete = available > 0 && worked === available

  return (
    <div className="sticky top-0 z-20 -mx-4 border-y border-[var(--border)] bg-[var(--background)]/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border">
      {/*
        Progress through the sheet, not progress toward a quota. It fills as
        items are worked whether the customer said yes or no — the advisor
        controls presenting, and that is what this bar rewards.
      */}
      {available > 0 && (
        <div className="mb-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[11px] uppercase tracking-wide text-neutral-500">
              Worked {worked} of {available}
            </p>
            {complete && (
              <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                Sheet complete
              </p>
            )}
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
            <div
              className={`h-full rounded-full transition-[width] duration-500 ease-out ${
                complete ? 'bg-emerald-500' : 'bg-neutral-900 dark:bg-neutral-200'
              }`}
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-neutral-500">On the table</p>
          <p key={`r${pulseKey}`} className="total-bump text-2xl font-bold tabular-nums">
            {money(remaining)}
          </p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-neutral-500">Projected gross</p>
          <p className="text-2xl font-bold tabular-nums text-neutral-500">{money(remainingGross)}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-neutral-500">Added to RO</p>
          <p key={`a${pulseKey}`} className="total-bump text-2xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
            {money(accepted)}
          </p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-neutral-500">Gross won</p>
          <p className="text-2xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
            {money(acceptedGross)}
          </p>
        </div>
      </div>
    </div>
  )
}

export function PrepSheetView({ sheet }: { sheet: PrepSheet }) {
  const [decisions, setDecisions] = useState<Record<string, OpportunityDecision>>({})
  /** Cards mid-animation — still rendered, no longer interactive. */
  const [exiting, setExiting] = useState<Record<string, OpportunityDecision>>({})
  const [pulseKey, setPulseKey] = useState(0)
  const [presenting, setPresenting] = useState(false)
  const [copilotOpen, setCopilotOpen] = useState(false)
  const [copilotTarget, setCopilotTarget] = useState<CopilotTarget>({})
  const [finished, setFinished] = useState(false)
  const [saving, setSaving] = useState(false)
  const [wearKind, setWearKind] = useState<WearKind | null>(null)
  const [handingOff, setHandingOff] = useState(false)

  // Factory warranty only — what they bought is one row up, and showing both
  // in the same strip is why ownership gets missed.
  const segments = useMemo(() => buildCoverageSegments(sheet, new Date(), ['WARRANTY']), [sheet])
  const ownership = useMemo(() => summarizeOwnership(sheet), [sheet])
  const totals = useMemo(
    () => computeRunningTotals(sheet.opportunities, decisions),
    [sheet.opportunities, decisions],
  )

  function decide(id: string, decision: OpportunityDecision) {
    if (exiting[id] || decisions[id]) return
    setExiting((prev) => ({ ...prev, [id]: decision }))
    // Totals move immediately; the card catches up when its animation ends.
    setDecisions((prev) => ({ ...prev, [id]: decision }))
    setPulseKey((k) => k + 1)
    window.setTimeout(() => {
      setExiting((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    }, EXIT_MS)
  }

  /**
   * The customer's own taps on the menu.
   *
   * Separate from `decide` on purpose. That one is the advisor working the
   * stack: it fires the card's exit animation and refuses to re-decide an
   * item, because an advisor moves forward through a list. A customer is
   * reading and changing their mind, so this one is reversible and moves
   * nothing on screen behind them.
   */
  function decideFromCustomer(id: string, decision: OpportunityDecision) {
    setDecisions((prev) => ({ ...prev, [id]: decision }))
    setPulseKey((k) => k + 1)
  }

  function reset() {
    setDecisions({})
    setExiting({})
    setFinished(false)
    setPulseKey((k) => k + 1)
  }

  /**
   * Finish the visit: show the private summary, then persist in the
   * background. The card never waits on the write — an advisor walking away
   * from a car should not be watching a spinner, and a failed write is worth
   * less than their next thirty seconds.
   */
  function finish() {
    setFinished(true)
    if (!sheet.appointment) return

    const records = toOutcomeRecords(
      sheet.appointment.id,
      sheet.opportunities,
      decisions,
      new Date(),
    )
    if (records.length === 0) return

    setSaving(true)
    void recordVisitOutcomes(
      sheet.appointment.id,
      records.map((r) => ({
        opportunityKey: r.opportunityKey,
        opportunityType: r.opportunityType,
        title: r.title,
        urgency: r.urgency,
        likelyPayer: r.likelyPayer,
        estimatedAmount: r.estimatedAmount,
        customerOutOfPocket: r.customerOutOfPocket,
        outcome: r.outcome,
      })),
    ).finally(() => setSaving(false))
  }

  const next = recommendNext(sheet.opportunities, decisions)

  /**
   * The queue shows what comes AFTER the callout. Rendering the same item
   * twice — once emphasised, once in the list — is the fastest way to make an
   * advisor stop trusting the emphasis.
   */
  const visible = sheet.opportunities.filter(
    (o) =>
      (!decisions[o.id] || exiting[o.id]) &&
      !(next?.opportunity.id === o.id && !exiting[o.id]),
  )
  const worked = sheet.opportunities.length - totals.pendingCount
  const summary = buildVisitSummary(sheet.opportunities, decisions)
  const readyToHandOff = handoffCount(sheet.opportunities, decisions)
  const sampleDetermination = undefined // determinations are per-line; see the demo surface

  if (presenting) {
    return (
      <PresentMenu
        sheet={sheet}
        decisions={decisions}
        onCustomerDecision={decideFromCustomer}
        onClose={() => setPresenting(false)}
      />
    )
  }

  /**
   * Full-screen rather than a drawer: this is the surface the advisor turns
   * round to face the customer, and a half-covered chart with the prep sheet's
   * gross figures showing behind it defeats the point.
   */
  if (handingOff) {
    return (
      <HandoffPanel sheet={sheet} decisions={decisions} onClose={() => setHandingOff(false)} />
    )
  }

  if (wearKind) {
    return (
      <div className="fixed inset-0 z-50 overflow-y-auto bg-[var(--background)] px-4 py-5 sm:px-6">
        <div className="mx-auto max-w-3xl">
          <WearDetail
            kind={wearKind}
            history={sheet.inspectionHistory}
            avgMilesPerDay={sheet.vehicle.avgMilesPerDay}
            asOf={new Date()}
            vehicleLabel={`${sheet.vehicle.modelYear} ${sheet.vehicle.make} ${sheet.vehicle.model ?? ''}`.trim()}
            customerName={sheet.customer.name}
            onClose={() => setWearKind(null)}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-28">
      <OwnershipRow
        summary={ownership}
        onAskCopilot={(product) => {
          setCopilotTarget({
            coverageLabel: `${product.label} — ${product.adminCompany}`,
            autoIntent: 'EXPLAIN_COVERAGE',
            nonce: Date.now(),
          })
          setCopilotOpen(true)
        }}
      />

      <CoverageStack
        segments={segments}
        sampleDetermination={sampleDetermination}
        onAskCopilot={(segment) => {
          setCopilotTarget({
            coverageKey: segment.key,
            coverageLabel: segment.label,
            // The button says it will explain, so it explains.
            autoIntent: 'EXPLAIN_COVERAGE',
            nonce: Date.now(),
          })
          setCopilotOpen(true)
        }}
      />

      <TotalsBar
        remaining={totals.remainingValue}
        remainingGross={totals.remainingGross}
        accepted={totals.acceptedValue}
        acceptedGross={totals.acceptedGross}
        pulseKey={pulseKey}
        worked={worked}
        available={sheet.opportunities.length}
      />

      {next && !finished && (
        <NextActionCallout
          next={next}
          onPresent={(id) => decide(id, 'ACCEPTED')}
          onShowWear={() =>
            setWearKind(
              next.opportunity.componentGroupKey === 'BRAKE_PADS_SHOES' ? 'BRAKES' : 'TIRES',
            )
          }
          onAskCopilot={(opportunityId, opportunityTitle) => {
            setCopilotTarget({
              opportunityId,
              opportunityTitle,
              autoIntent: 'TALK_TRACK',
              nonce: Date.now(),
            })
            setCopilotOpen(true)
          }}
        />
      )}

      {finished && (
        <VisitSummaryCard
          summary={summary}
          saving={saving}
          onDismiss={() => setFinished(false)}
        />
      )}

      {sheet.opportunities.length > 0 && (
        <div className="flex items-center justify-between gap-3 px-1">
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-neutral-500">
            {next ? 'Then, in this order' : 'Present in this order'}
          </p>
          <p className="text-xs text-neutral-500">
            {worked} of {sheet.opportunities.length} worked
            {worked > 0 && (
              <button
                type="button"
                onClick={reset}
                className="ml-3 underline hover:text-neutral-900 dark:hover:text-white"
              >
                reset
              </button>
            )}
          </p>
        </div>
      )}

      {visible.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-lg font-bold">
            {sheet.opportunities.length === 0
              ? 'Nothing outstanding on this vehicle.'
              : 'Every item worked.'}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-neutral-500">
            {sheet.opportunities.length === 0
              ? 'Nothing was flagged from history or the last inspection. Confirm the concern, complete the MPI, and anything the tech measures today will surface here on the next visit.'
              : `${money(totals.acceptedValue)} added, ${money(totals.declinedValue)} declined. Declines are tracked and will resurface on the follow-up cadence.`}
          </p>
          {sheet.opportunities.length === 0 && (
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => setPresenting(true)}
                className="touch-target rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-semibold transition active:scale-[0.98] hover:border-neutral-900 dark:hover:border-neutral-300"
              >
                Show coverage to the customer
              </button>
              <button
                type="button"
                onClick={() => {
                  setCopilotTarget({})
                  setCopilotOpen(true)
                }}
                className="touch-target rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-semibold transition active:scale-[0.98] hover:border-neutral-900 dark:hover:border-neutral-300"
              >
                ✦ Ask the Co-Pilot
              </button>
            </div>
          )}
          {sheet.opportunities.length > 0 && !finished && (
            <button
              type="button"
              onClick={finish}
              className="touch-target mt-5 rounded-xl bg-neutral-900 px-5 py-3 text-sm font-bold text-white transition active:scale-[0.98] dark:bg-white dark:text-neutral-900"
            >
              Finish visit
            </button>
          )}
        </Card>
      ) : (
        <ul className="space-y-3">
          {visible.map((o, i) => (
            <OpportunityCard
              key={o.id}
              opportunity={o}
              decision={exiting[o.id] ?? 'PENDING'}
              index={i}
              onDecide={decide}
              onAskCopilot={(opportunity) => {
                setCopilotTarget({
                  opportunityId: opportunity.id,
                  opportunityTitle: opportunity.title,
                })
                setCopilotOpen(true)
              }}
              ownershipHint={ownershipHint(o, ownership)}
              onShowWear={(opportunity) =>
                setWearKind(
                  opportunity.componentGroupKey === 'BRAKE_PADS_SHOES' ? 'BRAKES' : 'TIRES',
                )
              }
            />
          ))}
        </ul>
      )}

      {sheet.appointment && (
        <>
          {!copilotOpen && (
            <CopilotLauncher
              onClick={() => {
                // Opening from the launcher means "about this visit", so any
                // item the advisor tapped earlier stops being the subject.
                setCopilotTarget({})
                setCopilotOpen(true)
              }}
            />
          )}
          <CopilotPanel
            appointmentId={sheet.appointment.id}
            decisions={decisions}
            target={copilotTarget}
            open={copilotOpen}
            onOpenChange={setCopilotOpen}
          />
        </>
      )}

      {/* Sticky bar so the two things an advisor does next are always in
          thumb reach, whatever the scroll position. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--border)] bg-[var(--background)]/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          {readyToHandOff > 0 ? (
            <button
              type="button"
              onClick={() => setHandingOff(true)}
              className="touch-target flex-1 rounded-xl border-2 border-neutral-900 px-4 py-3 text-sm font-bold transition active:scale-[0.98] dark:border-neutral-100"
            >
              Hand off {readyToHandOff} to DMS
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setPresenting(true)}
              className="touch-target flex-1 rounded-xl border border-[var(--border)] px-4 py-3 text-sm font-bold transition active:scale-[0.98] hover:border-neutral-900 dark:hover:border-neutral-300"
            >
              Present full menu
            </button>
          )}
          {/* Appears only once there is something to summarise, so it never
              competes with the work itself early in a visit. */}
          {worked > 0 && !finished && (
            <button
              type="button"
              onClick={finish}
              className="touch-target rounded-xl border border-[var(--border)] px-4 py-3 text-sm font-bold transition active:scale-[0.98] hover:border-neutral-900 dark:hover:border-neutral-300"
            >
              Finish visit
            </button>
          )}
          {sheet.appointment && (
            <Link
              href={`/advisor/write-up/${sheet.appointment.id}`}
              className="touch-target flex-1 rounded-xl bg-neutral-900 px-4 py-3 text-center text-sm font-bold text-white transition active:scale-[0.98] hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              Start write-up
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}

export { estimateGross, vinLastSix }
