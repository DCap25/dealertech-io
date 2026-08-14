/**
 * Tread depth against mileage, with the line the engine fits through it.
 *
 * Pure SVG. The point of the picture is that two measurements make a slope
 * and a slope makes a date — so the dashed projection past the last real
 * reading is visually distinct from the solid measured section. A chart that
 * drew both the same way would be claiming to have measured the future.
 */

const READINGS = [
  { mileage: 22_000, tread: 10 },
  { mileage: 30_500, tread: 8 },
  { mileage: 38_200, tread: 7 },
  { mileage: 47_900, tread: 5 },
]

/** Present at 4/32". Legal minimum is 2/32". */
const SELL_AT = 4
const LEGAL_AT = 2

const W = 520
const H = 220
const PAD = { top: 16, right: 16, bottom: 34, left: 38 }

const X_MIN = 20_000
const X_MAX = 72_000
const Y_MIN = 0
const Y_MAX = 11

const x = (mi: number) => PAD.left + ((mi - X_MIN) / (X_MAX - X_MIN)) * (W - PAD.left - PAD.right)
const y = (t: number) => PAD.top + (1 - (t - Y_MIN) / (Y_MAX - Y_MIN)) * (H - PAD.top - PAD.bottom)

/** Least squares, the same shape of fit the wear engine does. */
function fit(points: { mileage: number; tread: number }[]) {
  const n = points.length
  const sx = points.reduce((s, p) => s + p.mileage, 0)
  const sy = points.reduce((s, p) => s + p.tread, 0)
  const sxy = points.reduce((s, p) => s + p.mileage * p.tread, 0)
  const sxx = points.reduce((s, p) => s + p.mileage * p.mileage, 0)
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx)
  return { slope, intercept: (sy - slope * sx) / n }
}

const { slope, intercept } = fit(READINGS)
const at = (mi: number) => intercept + slope * mi
const mileageAt = (tread: number) => (tread - intercept) / slope

const sellMileage = mileageAt(SELL_AT)
const legalMileage = mileageAt(LEGAL_AT)
const lastReading = READINGS[READINGS.length - 1]!

export function WearPreview() {
  return (
    <figure className="rounded-2xl border border-[var(--rule)] bg-[var(--paper)] p-4 sm:p-5">
      <figcaption className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-bold">Front left tire</span>
        <span className="text-xs text-[var(--ink-soft)]">
          4 measurements · 1/32&Prime; per 4,300 miles
        </span>
      </figcaption>

      {/* Scrolls rather than squashing on a narrow phone. */}
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full min-w-[420px]"
          role="img"
          aria-label="Tread depth falling from 10/32 inch at 22,000 miles to a projected 4/32 inch at about 57,000 miles."
        >
          {/* Threshold bands */}
          <rect
            x={PAD.left} y={y(SELL_AT)}
            width={W - PAD.left - PAD.right} height={y(LEGAL_AT) - y(SELL_AT)}
            className="fill-amber-500/10"
          />
          <rect
            x={PAD.left} y={y(LEGAL_AT)}
            width={W - PAD.left - PAD.right} height={y(Y_MIN) - y(LEGAL_AT)}
            className="fill-rose-500/10"
          />

          {[SELL_AT, LEGAL_AT].map((t) => (
            <g key={t}>
              <line
                x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)}
                className={t === SELL_AT ? 'stroke-amber-500/60' : 'stroke-rose-500/60'}
                strokeWidth={1} strokeDasharray="4 4"
              />
              <text
                x={PAD.left - 6} y={y(t) + 4}
                textAnchor="end"
                className="fill-[var(--ink-soft)] text-[10px]"
              >
                {t}/32
              </text>
            </g>
          ))}

          {/* Measured, then projected. Different weight on purpose. */}
          <polyline
            points={READINGS.map((r) => `${x(r.mileage)},${y(r.tread)}`).join(' ')}
            fill="none"
            className="stroke-[var(--ink)]"
            strokeWidth={2.5}
            strokeLinejoin="round"
          />
          <line
            x1={x(lastReading.mileage)} y1={y(lastReading.tread)}
            x2={x(legalMileage)} y2={y(at(legalMileage))}
            className="stroke-[var(--ink-soft)]"
            strokeWidth={2}
            strokeDasharray="6 5"
          />

          {READINGS.map((r) => (
            <circle
              key={r.mileage}
              cx={x(r.mileage)} cy={y(r.tread)} r={4}
              className="fill-[var(--paper)] stroke-[var(--ink)]"
              strokeWidth={2.5}
            />
          ))}

          {/* Where the conversation happens. */}
          <circle cx={x(sellMileage)} cy={y(SELL_AT)} r={5} className="fill-amber-500" />
          <text
            x={x(sellMileage)} y={y(SELL_AT) - 12}
            textAnchor="middle"
            className="fill-[var(--ink)] text-[11px] font-bold"
          >
            ~{Math.round(sellMileage / 1000)}k mi
          </text>

          {/* Axis */}
          <line
            x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom}
            className="stroke-[var(--rule)]" strokeWidth={1}
          />
          {[30_000, 45_000, 60_000].map((mi) => (
            <text
              key={mi}
              x={x(mi)} y={H - PAD.bottom + 16}
              textAnchor="middle"
              className="fill-[var(--ink-soft)] text-[10px]"
            >
              {mi / 1000}k
            </text>
          ))}
        </svg>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-[var(--ink-soft)]">
        Solid is measured. Dashed is projected. At this customer&rsquo;s rate that is{' '}
        <strong className="text-[var(--ink)]">about seven months</strong> — so it is a conversation
        to have at the next visit, not a surprise at the one after.
      </p>
    </figure>
  )
}
