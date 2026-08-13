'use client'

import { useMemo, useState } from 'react'
import { Card } from '@/components/ui/primitives'
import {
  buildWearView, confidenceNote, formatHorizon, formatMiles, mileageAtThreshold, projectedDate,
  toneFor, type WearKind, type WearTone,
} from '@/lib/prep-sheet/wear-view'
import type { InspectionSnapshot } from '@/lib/prep-sheet'
import { CornerChip, WearChart } from './wear-chart'

/**
 * Interactive wear detail.
 *
 * Two audiences, one screen. The advisor gets rates, confidence and every
 * corner; turning the tablet around switches to a customer view that drops the
 * internal vocabulary but keeps the measurements — the picture is persuasive
 * precisely because it is the customer's own data, not a generic interval.
 */

const TONE_STYLE: Record<WearTone, { chip: string; text: string; label: string }> = {
  CRITICAL: {
    chip: 'bg-rose-600 text-white',
    text: 'text-rose-700 dark:text-rose-400',
    label: 'At the legal minimum',
  },
  DUE: {
    chip: 'bg-amber-500 text-white',
    text: 'text-amber-700 dark:text-amber-400',
    label: 'Due now',
  },
  WATCH: {
    chip: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200',
    text: 'text-sky-700 dark:text-sky-400',
    label: 'Coming up',
  },
  HEALTHY: {
    chip: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
    text: 'text-emerald-700 dark:text-emerald-400',
    label: 'Healthy',
  },
}

/** Presets an advisor can tap to show "if you drove more/less". */
const RATE_PRESETS = [15, 30, 50, 75]

export function WearDetail({
  kind,
  history,
  avgMilesPerDay,
  asOf,
  vehicleLabel,
  customerName,
  onClose,
}: {
  kind: WearKind
  history: InspectionSnapshot[]
  avgMilesPerDay: number | null
  asOf: Date
  vehicleLabel: string
  customerName?: string
  onClose?: () => void
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [customerMode, setCustomerMode] = useState(false)
  const [rate, setRate] = useState<number | null>(avgMilesPerDay)

  const view = useMemo(
    () => buildWearView(kind, history, avgMilesPerDay),
    [kind, history, avgMilesPerDay],
  )

  if (!view) {
    return (
      <Card className="p-6 text-center">
        <p className="font-semibold">No measurements on file</p>
        <p className="mt-1 text-sm text-neutral-500">
          This vehicle has no recorded {kind === 'TIRES' ? 'tread depth' : 'pad thickness'} yet.
          The next inspection starts the history.
        </p>
      </Card>
    )
  }

  const focus = view.series.find((s) => s.key === selectedKey) ?? view.worst ?? view.series[0]!
  const prediction = focus.prediction
  const tone = TONE_STYLE[toneFor(prediction)]

  const sellMileage = prediction
    ? mileageAtThreshold(prediction, view.latestMileage, view.thresholds.sell)
    : null
  const criticalMileage = prediction
    ? mileageAtThreshold(prediction, view.latestMileage, view.thresholds.critical)
    : null

  /**
   * Days are recomputed here rather than read off the engine so the rate
   * control can answer "what if they drove more?". The distance in miles is
   * still entirely the engine's — only the miles-to-days division moves.
   */
  const milesToSell =
    sellMileage === null ? null : Math.max(0, sellMileage - view.latestMileage)
  const milesToCritical =
    criticalMileage === null ? null : Math.max(0, criticalMileage - view.latestMileage)
  const daysToSell =
    milesToSell === null || !rate || rate <= 0 ? null : Math.round(milesToSell / rate)
  const dateToSell = projectedDate(asOf, daysToSell)

  /**
   * Once a tire is already at the sell point, "0 miles to the sell point" is
   * true but useless. The live question becomes how long until it is no longer
   * legal — so the timeline switches to whichever threshold is still ahead.
   */
  const horizon =
    milesToSell !== null && milesToSell > 0
      ? {
          miles: milesToSell,
          threshold: view.thresholds.sell,
          atMileage: sellMileage ?? view.latestMileage,
          isCritical: false,
        }
      : milesToCritical !== null && milesToCritical > 0
        ? {
            miles: milesToCritical,
            threshold: view.thresholds.critical,
            atMileage: criticalMileage ?? view.latestMileage,
            isCritical: true,
          }
        : null
  const horizonDays =
    horizon === null || !rate || rate <= 0 ? null : Math.round(horizon.miles / rate)

  const CHART_TITLE = kind === 'TIRES' ? 'Tread depth' : 'Brake pad thickness'

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold leading-tight">
              {customerMode ? `Your ${kind === 'TIRES' ? 'tires' : 'brakes'}` : CHART_TITLE}
            </h2>
            <p className="text-xs text-neutral-500">
              {vehicleLabel}
              {customerMode && customerName ? ` · ${customerName}` : ''}
              {' · '}
              {view.series.reduce((n, s) => n + s.readings.length, 0)} measurements
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCustomerMode((v) => !v)}
              className="touch-target rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold transition active:scale-[0.97] hover:border-neutral-900 dark:hover:border-neutral-300"
            >
              {customerMode ? 'Advisor view' : 'Customer view'}
            </button>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="touch-target rounded-xl px-3 py-2 text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-white"
              >
                Close
              </button>
            )}
          </div>
        </div>

        {/* The headline: what it is now, and when it runs out. */}
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3 px-4 py-4">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-neutral-500">
              {/* "Worst corner" only means something when there are corners
                  to compare — brakes are measured once for the axle. */}
              {customerMode || view.series.length === 1
                ? focus.label
                : `${focus.label}${focus.isWorst ? ' · worst corner' : ''}`}
            </p>
            <p className={`text-4xl font-bold tabular-nums leading-none ${tone.text}`}>
              {prediction ? `${prediction.currentValue}${view.unit}` : '—'}
            </p>
          </div>

          <div>
            <p className="text-[11px] uppercase tracking-wide text-neutral-500">
              {customerMode ? 'Time to replace in' : 'Reaches sell point in'}
            </p>
            <p className="text-2xl font-bold tabular-nums leading-tight">
              {milesToSell === null
                ? 'No projection'
                : milesToSell === 0
                  ? 'Now'
                  : formatMiles(milesToSell)}
            </p>
            {daysToSell !== null && milesToSell !== null && milesToSell > 0 && (
              <p className="text-xs text-neutral-500">
                {formatHorizon(daysToSell)}
                {dateToSell && ` · around ${dateToSell.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`}
              </p>
            )}
          </div>

          <span className={`rounded-full px-3 py-1.5 text-xs font-bold ${tone.chip}`}>
            {tone.label}
          </span>
        </div>

        <div className="px-2 pb-2">
          <WearChart view={view} selectedKey={focus.key} customerMode={customerMode} />
        </div>

        {/* Corner switcher. Hidden in customer mode when only one corner
            matters — a customer does not need to audit four tires to
            understand the one that is worn. */}
        {view.series.length > 1 && (
          <div className="flex gap-2 overflow-x-auto border-t border-[var(--border)] px-4 py-3">
            {view.series.map((s) => (
              <CornerChip
                key={s.key}
                series={s}
                unit={view.unit}
                active={s.key === focus.key}
                customerMode={customerMode}
                onSelect={() => setSelectedKey(s.key)}
              />
            ))}
          </div>
        )}
      </Card>

      {/* Driving rate — the lever that turns miles into a date. */}
      {horizon !== null && (
        <Card className="px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-xs font-bold uppercase tracking-[0.15em] text-neutral-500">
              {customerMode ? 'How much you drive' : 'Driving rate'}
            </p>
            <p className="text-sm tabular-nums text-neutral-500">
              {rate ? `${Math.round(rate)} miles/day` : 'unknown'}
              {avgMilesPerDay && rate === avgMilesPerDay && ' · their actual rate'}
            </p>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {avgMilesPerDay && (
              <RatePill
                label={`Their rate · ${Math.round(avgMilesPerDay)}/day`}
                active={rate === avgMilesPerDay}
                onClick={() => setRate(avgMilesPerDay)}
              />
            )}
            {RATE_PRESETS.filter((r) => r !== avgMilesPerDay).map((r) => (
              <RatePill
                key={r}
                label={`${r}/day`}
                active={rate === r}
                onClick={() => setRate(r)}
              />
            ))}
          </div>
          <p className="mt-2.5 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
            At {rate ? Math.round(rate) : '—'} miles a day, the {formatMiles(horizon.miles)} left before{' '}
            {horizon.isCritical
              ? `${horizon.threshold}${view.unit} — the legal minimum — `
              : `the ${horizon.threshold}${view.unit} replacement point `}
            is{' '}
            <strong className="text-neutral-900 dark:text-white">
              {formatHorizon(horizonDays) ?? 'unknown'}
            </strong>
            {horizon.isCritical
              ? `. That is ${formatMiles(horizon.atMileage)} on the odometer.`
              : '.'}
          </p>
        </Card>
      )}

      {/* Advisor-only: how good this projection actually is. */}
      {!customerMode && (
        <Card className="px-4 py-3">
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-neutral-500">
            Confidence
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
            {confidenceNote(prediction)}
          </p>
          {prediction && prediction.ratePerThousandMiles > 0 && (
            <p className="mt-1.5 text-sm text-neutral-500">
              Wearing {prediction.ratePerThousandMiles}
              {view.unit} per 1,000 miles across {prediction.readingCount} measurements.
            </p>
          )}
        </Card>
      )}

      {customerMode && (
        <p className="px-1 text-xs leading-relaxed text-neutral-500">
          Measurements were taken by our technician at each visit. The projection assumes you keep
          driving the way you do today — it is an estimate, and we will re-measure next time you
          are in.
        </p>
      )}
    </div>
  )
}

function RatePill({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`touch-target rounded-full border px-3.5 py-2 text-xs font-semibold transition active:scale-[0.97] ${
        active
          ? 'border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900'
          : 'border-[var(--border)] hover:border-neutral-400'
      }`}
    >
      {label}
    </button>
  )
}
