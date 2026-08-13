'use client'

import { useState } from 'react'
import { WearDetail } from './wear-detail'
import type { WearKind } from '@/lib/prep-sheet/wear-view'
import type { InspectionSnapshot } from '@/lib/prep-sheet'

/**
 * Collapsed-by-default wear detail for the vehicle record.
 *
 * The record page is a reference surface, not a selling surface — the chart is
 * one tap away rather than always mounted, so the page stays fast and the
 * client bundle only does work when someone actually asks for it.
 */
export function WearPanel({
  history,
  avgMilesPerDay,
  vehicleLabel,
  customerName,
  asOf,
}: {
  history: InspectionSnapshot[]
  avgMilesPerDay: number | null
  vehicleLabel: string
  customerName?: string
  asOf: Date
}) {
  const [kind, setKind] = useState<WearKind | null>(null)

  const available: WearKind[] = []
  if (history.some((i) => i.items.some((it) => it.componentGroupKey === 'TIRES'))) {
    available.push('TIRES')
  }
  if (history.some(hasBrakeMeasurement)) available.push('BRAKES')
  if (available.length === 0) return null

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        {available.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(kind === k ? null : k)}
            aria-expanded={kind === k}
            className={`touch-target rounded-xl border px-3.5 py-2 text-sm font-semibold transition active:scale-[0.97] ${
              kind === k
                ? 'border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900'
                : 'border-[var(--border)] hover:border-neutral-900 dark:hover:border-neutral-300'
            }`}
          >
            {kind === k ? 'Hide' : 'Show'} {k === 'TIRES' ? 'tread' : 'brake'} chart
          </button>
        ))}
      </div>

      {kind && (
        <div className="expand-in mt-3">
          <WearDetail
            kind={kind}
            history={history}
            avgMilesPerDay={avgMilesPerDay}
            asOf={asOf}
            vehicleLabel={vehicleLabel}
            customerName={customerName}
            onClose={() => setKind(null)}
          />
        </div>
      )}
    </div>
  )
}

function hasBrakeMeasurement(inspection: InspectionSnapshot): boolean {
  return inspection.items.some((it) => it.componentGroupKey === 'BRAKE_PADS_SHOES')
}
