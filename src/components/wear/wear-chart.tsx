import {
  mileageAtThreshold, projectionPolyline, scaleX, scaleY, seriesPolyline,
  type WearSeries, type WearViewModel,
} from '@/lib/prep-sheet/wear-view'

/**
 * Wear chart — hand-drawn SVG, no charting library.
 *
 * The whole vocabulary is points, two lines and three bands. A charting
 * package would add hundreds of kilobytes to a bundle that loads on a tablet
 * over dealership wifi, to draw something this file does in a few dozen lines.
 *
 * Server-safe: no state, no effects. The interactive shell around it owns
 * selection and the rate control.
 */

/** Drawn in a fixed viewBox and scaled by CSS, so dots stay round. */
const W = 340
const H = 180
const PAD = { top: 10, right: 14, bottom: 26, left: 32 }

const PLOT_W = W - PAD.left - PAD.right
const PLOT_H = H - PAD.top - PAD.bottom

function px(x: number): number {
  return PAD.left + (x / 100) * PLOT_W
}

function py(y: number): number {
  return PAD.top + (y / 100) * PLOT_H
}

/** Map a "0–100 chart space" polyline string into viewBox pixels. */
function toPixelPoints(points: string): string {
  return points
    .split(' ')
    .filter(Boolean)
    .map((pair) => {
      const [x, y] = pair.split(',').map(Number)
      return `${px(x ?? 0).toFixed(2)},${py(y ?? 0).toFixed(2)}`
    })
    .join(' ')
}

export function WearChart({
  view,
  selectedKey,
  customerMode = false,
}: {
  view: WearViewModel
  /** Focused series; others are drawn muted for context. */
  selectedKey: string | null
  customerMode?: boolean
}) {
  const { scale, thresholds } = view
  const focus = view.series.find((s) => s.key === selectedKey) ?? view.worst ?? view.series[0]
  if (!focus) return null

  const criticalY = py(scaleY(scale, thresholds.critical))
  const sellY = py(scaleY(scale, thresholds.sell))
  const floorY = py(scaleY(scale, scale.yMin))

  const sellCrossing = focus.prediction
    ? mileageAtThreshold(focus.prediction, view.latestMileage, thresholds.sell)
    : null
  const crossingInRange =
    sellCrossing !== null && sellCrossing >= scale.xMin && sellCrossing <= scale.xMax
      ? sellCrossing
      : null

  const xTicks = [
    scale.xMin + (scale.xMax - scale.xMin) * 0.02,
    view.latestMileage,
    scale.xMax,
  ]

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label={`${view.kind === 'TIRES' ? 'Tread depth' : 'Brake pad thickness'} against mileage for ${focus.label}`}
    >
      {/* Danger and warning bands read before any line does. */}
      <rect
        x={PAD.left} y={criticalY} width={PLOT_W} height={Math.max(0, floorY - criticalY)}
        className="fill-rose-500/12"
      />
      <rect
        x={PAD.left} y={sellY} width={PLOT_W} height={Math.max(0, criticalY - sellY)}
        className="fill-amber-500/12"
      />

      {/* Threshold rules */}
      <line
        x1={PAD.left} x2={W - PAD.right} y1={sellY} y2={sellY}
        className="stroke-amber-500/70" strokeWidth={1} strokeDasharray="4 3"
      />
      <line
        x1={PAD.left} x2={W - PAD.right} y1={criticalY} y2={criticalY}
        className="stroke-rose-500/70" strokeWidth={1} strokeDasharray="4 3"
      />
      {/* Labels sit inside their band, at the left gutter. The crossing
          marker is always at or right of the latest reading, so this is the
          one place it can never land underneath the text. */}
      <text x={PAD.left + 3} y={sellY + 9} className="fill-amber-700 dark:fill-amber-400" style={{ fontSize: 8 }}>
        {customerMode ? 'Replace' : 'Sell point'} {thresholds.sell}{view.unit}
      </text>
      <text x={PAD.left + 3} y={criticalY + 9} className="fill-rose-700 dark:fill-rose-400" style={{ fontSize: 8 }}>
        {customerMode ? 'Unsafe' : 'Legal min'} {thresholds.critical}{view.unit}
      </text>

      {/* Axes */}
      <line x1={PAD.left} x2={PAD.left} y1={PAD.top} y2={floorY} className="stroke-neutral-300 dark:stroke-neutral-700" strokeWidth={1} />
      <line x1={PAD.left} x2={W - PAD.right} y1={floorY} y2={floorY} className="stroke-neutral-300 dark:stroke-neutral-700" strokeWidth={1} />

      {[scale.yMax, thresholds.sell, thresholds.critical].map((v) => (
        <text
          key={v} x={PAD.left - 4} y={py(scaleY(scale, v)) + 3} textAnchor="end"
          className="fill-neutral-500" style={{ fontSize: 8 }}
        >
          {v}
        </text>
      ))}

      {xTicks.map((m, i) => (
        <text
          key={i} x={px(scaleX(scale, m))} y={H - 8}
          textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
          className="fill-neutral-500" style={{ fontSize: 8 }}
        >
          {Math.round(m / 1000)}k
        </text>
      ))}

      {/* Unfocused corners, for context only. */}
      {view.series
        .filter((s) => s.key !== focus.key)
        .map((s) => (
          <g key={s.key} className="opacity-30">
            <polyline
              points={toPixelPoints(seriesPolyline(scale, s.readings))}
              fill="none" strokeWidth={1.5}
              className="stroke-neutral-400 dark:stroke-neutral-500"
            />
            {s.readings.map((r, i) => (
              <circle
                key={i} r={2}
                cx={px(scaleX(scale, r.mileage))} cy={py(scaleY(scale, r.value))}
                className="fill-neutral-400 dark:fill-neutral-500"
              />
            ))}
          </g>
        ))}

      {/* Projection first, so measured history draws on top of it. */}
      {focus.prediction && (() => {
        const line = projectionPolyline(scale, focus.prediction, view.latestMileage)
        return line ? (
          <polyline
            points={toPixelPoints(line)}
            fill="none" strokeWidth={2} strokeDasharray="5 4"
            className="stroke-neutral-900/50 dark:stroke-neutral-100/50"
          />
        ) : null
      })()}

      {/* Where the projection crosses the sell point. */}
      {crossingInRange !== null && (
        <g>
          <line
            x1={px(scaleX(scale, crossingInRange))} x2={px(scaleX(scale, crossingInRange))}
            y1={sellY} y2={floorY}
            className="stroke-amber-500" strokeWidth={1}
          />
          <circle
            r={3.5}
            cx={px(scaleX(scale, crossingInRange))} cy={sellY}
            className="fill-amber-500"
          />
        </g>
      )}

      {/* The focused corner — measured history. */}
      <polyline
        points={toPixelPoints(seriesPolyline(scale, focus.readings))}
        fill="none" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
        className="stroke-neutral-900 dark:stroke-neutral-100"
      />
      {focus.readings.map((r, i) => (
        <circle
          key={i} r={3.5}
          cx={px(scaleX(scale, r.mileage))} cy={py(scaleY(scale, r.value))}
          className="fill-neutral-900 stroke-white dark:fill-neutral-100 dark:stroke-neutral-900"
          strokeWidth={1.5}
        />
      ))}
    </svg>
  )
}

/** Small per-corner chip used to switch the focused series. */
export function CornerChip({
  series,
  unit,
  active,
  customerMode = false,
  onSelect,
}: {
  series: WearSeries
  unit: string
  active: boolean
  customerMode?: boolean
  onSelect: () => void
}) {
  const value = series.prediction?.currentValue
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`touch-target flex min-w-[5.5rem] flex-col items-start rounded-xl border px-3 py-2 text-left transition active:scale-[0.97] ${
        active
          ? 'border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900'
          : 'border-[var(--border)] hover:border-neutral-400'
      }`}
    >
      <span className="text-[11px] font-semibold uppercase tracking-wide opacity-70">
        {series.position === 'ALL' ? 'Pads' : series.position}
      </span>
      <span className="text-lg font-bold tabular-nums leading-tight">
        {value === undefined ? '—' : `${value}${unit}`}
      </span>
      {series.isWorst && (
        <span className="text-[10px] font-semibold uppercase tracking-wide opacity-70">
          {customerMode ? 'Lowest' : 'Worst'}
        </span>
      )}
    </button>
  )
}
