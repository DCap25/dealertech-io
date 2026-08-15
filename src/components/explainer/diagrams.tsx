'use client'

import type { Explainer, Reading } from '@/lib/explainer'
import { remainingFraction } from '@/lib/explainer'

/**
 * Six diagram renderers, driven by a progress value rather than by CSS
 * keyframes.
 *
 * Progress comes from the player as state, which means pause actually pauses
 * and the reduced-motion path can jump straight to the end without running
 * anything. A keyframe animation would keep going behind a paused caption.
 *
 * Every renderer is diagrammatic on purpose. A photorealistic brake pad
 * invites the question "is that my brake pad?", and the honest answer is no —
 * the only thing on screen that belongs to this customer is their measurement.
 */

export interface DiagramProps {
  explainer: Explainer
  /** 0–1 across the whole explainer. */
  t: number
  reading: Reading | null
}

const W = 560
const H = 260

/** Ease so the motion settles rather than stopping dead. */
function ease(t: number): number {
  return 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3)
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-hidden
    >
      {children}
    </svg>
  )
}

// ===========================================================================

/**
 * Something thick becoming thin, against the scale it is measured on.
 * Brake pads and tyre tread are the same picture with different labels.
 */
function LayerWear({ explainer, t, reading }: DiagramProps) {
  const scale = explainer.scale
  if (!scale) return null

  const isTread = scale.unit === '32nds'
  const x = 150
  const width = 250
  const baseY = 190
  const maxHeight = 110

  const heightFor = (value: number) =>
    (Math.max(0, value) / scale.fresh) * maxHeight

  // Wears from fresh toward the limit across the animation. If we know this
  // vehicle's number, that is where it stops.
  const target = reading ? reading.value : scale.limit
  const value = scale.fresh - (scale.fresh - target) * ease(t)
  const h = heightFor(value)

  const presentY = baseY - heightFor(scale.present)
  const limitY = baseY - heightFor(scale.limit)
  const pastLimit = value <= scale.limit + 0.01

  return (
    <Frame>
      {/* The thing it wears against */}
      {isTread ? (
        <rect x={x - 34} y={baseY} width={width + 68} height={16} rx={2} className="fill-neutral-400 dark:fill-neutral-600" />
      ) : (
        <rect x={x - 46} y={60} width={34} height={146} rx={3} className="fill-neutral-400 dark:fill-neutral-500" />
      )}
      <text
        x={isTread ? W / 2 : x - 29}
        y={isTread ? baseY + 34 : 50}
        textAnchor="middle"
        className="fill-neutral-500 text-[11px]"
      >
        {isTread ? 'road' : 'rotor'}
      </text>

      {/* Backing the material is bonded to */}
      <rect
        x={x} y={baseY} width={width} height={14} rx={2}
        className="fill-neutral-500 dark:fill-neutral-400"
      />

      {/* The material itself */}
      <rect
        x={x}
        y={baseY - h}
        width={width}
        height={h}
        rx={2}
        className={pastLimit ? 'fill-rose-500' : value <= scale.present ? 'fill-amber-500' : 'fill-emerald-500'}
      />

      {/* Where the industry says present it, and where it stops working */}
      {[
        { y: presentY, label: `${scale.present} — present`, cls: 'stroke-amber-500 fill-amber-600' },
        { y: limitY, label: `${scale.limit} — limit`, cls: 'stroke-rose-500 fill-rose-600' },
      ].map((line) => (
        <g key={line.label}>
          <line
            x1={x - 60} x2={x + width + 60} y1={line.y} y2={line.y}
            className={line.cls} strokeWidth={1.5} strokeDasharray="5 4"
          />
          <text x={x + width + 64} y={line.y + 4} className={`${line.cls} text-[11px] font-semibold`}>
            {line.label}
          </text>
        </g>
      ))}

      {/* This vehicle's own number */}
      {reading && t > 0.55 && (
        <g>
          <line
            x1={x - 60} x2={x} y1={baseY - h} y2={baseY - h}
            className="stroke-neutral-900 dark:stroke-neutral-100" strokeWidth={2}
          />
          <text
            x={x - 64} y={baseY - h - 8}
            textAnchor="end"
            className="fill-neutral-900 text-[13px] font-bold dark:fill-neutral-100"
          >
            yours{reading.position ? ` (${reading.position})` : ''}
          </text>
          <text
            x={x - 64} y={baseY - h + 8}
            textAnchor="end"
            className="fill-neutral-900 text-[13px] font-bold tabular-nums dark:fill-neutral-100"
          >
            {isTread ? `${reading.value}/32"` : `${reading.value}mm`}
          </text>
        </g>
      )}
    </Frame>
  )
}

// ===========================================================================

/** Fluid that still looks like fluid while the additives in it run out. */
function FluidLife({ t }: DiagramProps) {
  const p = ease(t)
  // Colour walks from clean amber to spent brown.
  const r = Math.round(217 - 130 * p)
  const g = Math.round(160 - 110 * p)
  const b = Math.round(60 - 30 * p)

  return (
    <Frame>
      <text x={W / 2} y={34} textAnchor="middle" className="fill-neutral-500 text-[11px] uppercase tracking-wider">
        the fluid
      </text>
      <rect
        x={110} y={50} width={150} height={150} rx={10}
        fill={`rgb(${r},${g},${b})`}
      />
      <rect x={110} y={50} width={150} height={150} rx={10} className="fill-none stroke-neutral-400" strokeWidth={2} />

      {/* Suspended debris arrives with age. */}
      {Array.from({ length: 14 }, (_, i) => {
        const seed = (i * 37) % 100
        const show = p > 0.35 + (seed % 40) / 160
        return show ? (
          <circle
            key={i}
            cx={122 + (seed * 1.26) % 126}
            cy={62 + ((seed * 7) % 126)}
            r={1.6}
            className="fill-neutral-900/40"
          />
        ) : null
      })}

      <text x={400} y={34} textAnchor="middle" className="fill-neutral-500 text-[11px] uppercase tracking-wider">
        additives protecting it
      </text>
      <rect x={325} y={50} width={150} height={150} rx={8} className="fill-neutral-200 dark:fill-neutral-800" />
      <rect
        x={325}
        y={50 + 150 * p}
        width={150}
        height={150 * (1 - p)}
        rx={8}
        className={p > 0.75 ? 'fill-rose-500' : p > 0.45 ? 'fill-amber-500' : 'fill-emerald-500'}
      />
      {/*
        No percentage here, deliberately.

        This bar is driven by animation progress — it says how far through the
        explainer you are, not how much additive is left in this car's fluid.
        Nobody measures that. Printing "63% remaining" beside the customer's own
        vehicle and price read as a measurement of it, which is the one thing
        these explainers are not allowed to do. The end labels carry the same
        idea without asserting a number about anyone.
      */}
      {/* Outside the bar on the right, so neither the header nor the fill covers them. */}
      <text x={484} y={60} className="fill-neutral-500 text-[10px] uppercase tracking-wider">
        new
      </text>
      <text x={484} y={200} className="fill-neutral-500 text-[10px] uppercase tracking-wider">
        due
      </text>
      <text
        x={400} y={225}
        textAnchor="middle"
        className="fill-neutral-600 text-[12px] font-semibold dark:fill-neutral-300"
      >
        across the service interval
      </text>
    </Frame>
  )
}

// ===========================================================================

/** Air getting through a filter that is filling up. */
function FlowRestriction({ t }: DiagramProps) {
  const p = ease(t)
  const lanes = 7
  const passing = Math.max(1, Math.round(lanes * (1 - p * 0.8)))

  return (
    <Frame>
      <rect x={250} y={40} width={54} height={180} rx={6} className="fill-neutral-300 dark:fill-neutral-700" />
      {/* Pleats loading with dust */}
      {Array.from({ length: 9 }, (_, i) => (
        <rect
          key={i}
          x={254} y={46 + i * 19} width={46} height={14} rx={2}
          fill={`rgb(${Math.round(245 - 120 * p)},${Math.round(240 - 130 * p)},${Math.round(230 - 140 * p)})`}
        />
      ))}
      <text x={277} y={238} textAnchor="middle" className="fill-neutral-500 text-[11px]">filter</text>

      {Array.from({ length: lanes }, (_, i) => {
        const y = 56 + i * 25
        const through = i < passing
        return (
          <g key={i}>
            <line
              x1={40} x2={244} y1={y} y2={y}
              className="stroke-sky-500" strokeWidth={2.5} strokeLinecap="round"
            />
            <polygon points={`244,${y - 5} 252,${y} 244,${y + 5}`} className="fill-sky-500" />
            {through && (
              <>
                <line
                  x1={310} x2={505} y1={y} y2={y}
                  className="stroke-sky-500" strokeWidth={2.5} strokeLinecap="round"
                />
                <polygon points={`505,${y - 5} 513,${y} 505,${y + 5}`} className="fill-sky-500" />
              </>
            )}
          </g>
        )
      })}
      <text x={140} y={30} textAnchor="middle" className="fill-neutral-500 text-[11px] uppercase tracking-wider">air in</text>
      <text x={410} y={30} textAnchor="middle" className="fill-neutral-500 text-[11px] uppercase tracking-wider">air through</text>
    </Frame>
  )
}

// ===========================================================================

/** Capacity falling to meet the demand of a cold start. */
function CapacityFade({ t }: DiagramProps) {
  const p = ease(t)
  const x0 = 70
  const x1 = 500
  const yTop = 50
  const yBot = 200

  const capacityAt = (f: number) => yTop + (yBot - yTop) * (0.08 + 0.72 * f * f)
  const demandY = yTop + (yBot - yTop) * 0.62

  const pts: string[] = []
  for (let i = 0; i <= 40; i++) {
    const f = (i / 40) * p
    pts.push(`${x0 + (x1 - x0) * (i / 40) * p},${capacityAt(f)}`)
  }

  const crossed = capacityAt(p) > demandY

  return (
    <Frame>
      <line x1={x0} x2={x1} y1={yBot} y2={yBot} className="stroke-neutral-300 dark:stroke-neutral-700" strokeWidth={1.5} />
      <text x={x0} y={yBot + 20} className="fill-neutral-500 text-[11px]">new</text>
      <text x={x1} y={yBot + 20} textAnchor="end" className="fill-neutral-500 text-[11px]">years of heat cycles</text>

      <line
        x1={x0} x2={x1} y1={demandY} y2={demandY}
        className="stroke-rose-500" strokeWidth={1.5} strokeDasharray="5 4"
      />
      <text x={x1} y={demandY - 8} textAnchor="end" className="fill-rose-600 text-[11px] font-semibold">
        current a cold start needs
      </text>

      <polyline
        points={pts.join(' ')}
        fill="none"
        className={crossed ? 'stroke-rose-500' : 'stroke-emerald-500'}
        strokeWidth={3}
        strokeLinecap="round"
      />
      <text x={x0} y={yTop - 12} className="fill-neutral-500 text-[11px] uppercase tracking-wider">
        capacity it can still deliver
      </text>

      {crossed && (
        <text x={W / 2} y={yBot + 42} textAnchor="middle" className="fill-rose-600 text-[12px] font-bold">
          below the line, it turns over slowly or not at all
        </text>
      )}
    </Frame>
  )
}

// ===========================================================================

/** A wheel dragged slightly sideways, and the wear band that leaves. */
function Geometry({ t }: DiagramProps) {
  const p = ease(t)
  const angle = 9 * p

  return (
    <Frame>
      <line x1={60} x2={500} y1={130} y2={130} className="stroke-neutral-300 dark:stroke-neutral-700" strokeWidth={1.5} strokeDasharray="6 5" />
      <text x={60} y={120} className="fill-neutral-500 text-[11px]">direction of travel</text>

      {[{ cx: 165, sign: -1 }, { cx: 395, sign: 1 }].map(({ cx, sign }) => (
        <g key={cx} transform={`rotate(${angle * sign} ${cx} 130)`}>
          <rect x={cx - 26} y={70} width={52} height={120} rx={12} className="fill-neutral-700 dark:fill-neutral-300" />
          {/* The edge taking the scrub */}
          <rect
            x={sign < 0 ? cx - 26 : cx + 14}
            y={70}
            width={12}
            height={120}
            rx={4}
            className={p > 0.5 ? 'fill-rose-500' : 'fill-neutral-500'}
          />
        </g>
      ))}

      <text x={165} y={222} textAnchor="middle" className="fill-neutral-500 text-[11px]">left</text>
      <text x={395} y={222} textAnchor="middle" className="fill-neutral-500 text-[11px]">right</text>

      {p > 0.5 && (
        <text x={W / 2} y={252} textAnchor="middle" className="fill-rose-600 text-[12px] font-bold">
          the inner edge does the scrubbing, and wears out first
        </text>
      )}
    </Frame>
  )
}

// ===========================================================================

/** A spark gap widening until the coil can no longer bridge it. */
function Ignition({ t }: DiagramProps) {
  const p = ease(t)
  const gap = 14 + 40 * p
  const cx = W / 2
  const topY = 96
  const botY = topY + gap

  const misfiring = p > 0.72

  return (
    <Frame>
      <rect x={cx - 12} y={40} width={24} height={56} rx={3} className="fill-neutral-500" />
      <rect x={cx - 40} y={botY} width={80} height={16} rx={3} className="fill-neutral-500" />

      {/* The spark, ragged once the gap is too wide */}
      {!misfiring ? (
        <polyline
          points={`${cx},${topY} ${cx - 7},${topY + gap * 0.32} ${cx + 7},${topY + gap * 0.64} ${cx},${botY}`}
          fill="none"
          className="stroke-sky-400"
          strokeWidth={3}
          strokeLinecap="round"
        />
      ) : (
        <polyline
          points={`${cx},${topY} ${cx - 5},${topY + gap * 0.28}`}
          fill="none"
          className="stroke-sky-400/50"
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray="3 5"
        />
      )}

      <text x={cx + 60} y={topY + gap / 2 + 4} className="fill-neutral-600 text-[12px] font-semibold dark:fill-neutral-300">
        gap widens as the metal erodes
      </text>

      <text x={cx} y={225} textAnchor="middle" className={`text-[12px] font-bold ${misfiring ? 'fill-rose-600' : 'fill-emerald-600'}`}>
        {misfiring ? 'coil can no longer bridge it — misfire' : 'coil bridges the gap every time'}
      </text>
    </Frame>
  )
}

// ===========================================================================

const RENDERERS: Record<string, (p: DiagramProps) => React.ReactNode> = {
  LAYER_WEAR: LayerWear,
  FLUID_LIFE: FluidLife,
  FLOW_RESTRICTION: FlowRestriction,
  CAPACITY_FADE: CapacityFade,
  GEOMETRY: Geometry,
  IGNITION: Ignition,
}

export function Diagram(props: DiagramProps) {
  const render = RENDERERS[props.explainer.diagram]
  return <>{render ? render(props) : null}</>
}

/** Exported for the menu's inline summary chip. */
export function remaining(explainer: Explainer, reading: Reading | null): number | null {
  return remainingFraction(explainer, reading)
}
