'use client'

import { useState } from 'react'
import { Card, ProgressRing, TONE_STYLE } from '@/components/ui/primitives'
import type { CoverageSegment } from '@/lib/prep-sheet/presentation'
import type { CoverageDetermination, ReasoningStep } from '@/lib/coverage'

/**
 * The first thing an advisor sees: what this customer already owns.
 *
 * Rings rather than bars because four fit across a tablet in one glance, and
 * the colour does the reading — an advisor walking to the car needs "green,
 * green, red" in half a second, not four sentences.
 */

const CONFIDENCE_STYLE: Record<string, string> = {
  HIGH: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  MEDIUM: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  LOW: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200',
}

function ReasoningTrace({ steps }: { steps: ReasoningStep[] }) {
  return (
    <ol className="space-y-1.5">
      {steps.map((step, i) => {
        const fired = step.outcome === 'FIRED'
        return (
          <li key={i} className="flex items-start gap-2.5 text-sm">
            <span
              className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                fired ? 'bg-emerald-500' : 'bg-neutral-300 dark:bg-neutral-700'
              }`}
              aria-hidden
            />
            <span className="min-w-0">
              <span className={`font-mono text-xs ${fired ? 'font-bold' : 'text-neutral-500'}`}>
                {step.rule}
              </span>
              <span className={fired ? 'ml-2' : 'ml-2 text-neutral-500'}>{step.detail}</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export function CoverageStack({
  segments,
  sampleDetermination,
  onAskCopilot,
}: {
  segments: CoverageSegment[]
  /** A determination from this sheet, used to show how the waterfall ran. */
  sampleDetermination?: CoverageDetermination
  onAskCopilot?: (segment: CoverageSegment) => void
}) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  const open = segments.find((s) => s.key === openKey)

  if (segments.length === 0) return null

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-neutral-500">
          What they already own
        </h2>
        {sampleDetermination && (
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
              CONFIDENCE_STYLE[sampleDetermination.confidence] ?? CONFIDENCE_STYLE.LOW
            }`}
          >
            {sampleDetermination.confidence} confidence
          </span>
        )}
      </div>

      {/* Horizontal scroll on narrow screens so rings never shrink below
          readable size on a phone held in portrait. */}
      <div className="flex snap-x gap-2 overflow-x-auto px-3 py-4 sm:grid sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
        {segments.map((segment) => {
          const isOpen = segment.key === openKey
          const style = TONE_STYLE[segment.tone]
          return (
            <button
              key={segment.key}
              type="button"
              onClick={() => setOpenKey(isOpen ? null : segment.key)}
              aria-expanded={isOpen}
              className={`touch-target flex min-w-[8.5rem] shrink-0 snap-start flex-col items-center gap-2 rounded-xl p-3 transition active:scale-[0.97] sm:min-w-0 ${
                isOpen
                  ? 'bg-neutral-100 ring-2 ring-neutral-900 dark:bg-neutral-800 dark:ring-neutral-300'
                  : 'hover:bg-neutral-50 dark:hover:bg-neutral-900'
              }`}
            >
              <ProgressRing percent={segment.percentRemaining} tone={segment.tone} size={88}>
                <span className={`text-base font-bold tabular-nums ${style.text}`}>
                  {segment.primary}
                </span>
                {segment.secondary && (
                  <span className="mt-0.5 text-[10px] tabular-nums text-neutral-500">
                    {segment.secondary}
                  </span>
                )}
              </ProgressRing>
              <span className="text-center text-xs font-semibold leading-tight">
                {segment.shortLabel}
              </span>
            </button>
          )
        })}
      </div>

      {open && (
        <div className="expand-in border-t border-[var(--border)] bg-[var(--surface-muted)] px-4 py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-bold">{open.label}</h3>
            <span className={`text-sm font-semibold ${TONE_STYLE[open.tone].text}`}>
              {open.active ? `${Math.round(open.percentRemaining)}% remaining` : 'Expired'}
            </span>
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
            {open.detail}
          </p>

          {onAskCopilot && (
            <button
              type="button"
              onClick={() => onAskCopilot(open)}
              className="touch-target mt-3 rounded-xl border border-[var(--border)] px-3.5 py-2 text-sm font-semibold transition active:scale-[0.98] hover:border-neutral-900 dark:hover:border-neutral-300"
            >
              ✦ Explain this to the customer
            </button>
          )}

          {sampleDetermination && (
            <details className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
              <summary className="cursor-pointer text-xs font-bold uppercase tracking-wide text-neutral-500">
                How the engine decided ({sampleDetermination.reasoning.length} rules evaluated)
              </summary>
              <div className="mt-3">
                <ReasoningTrace steps={sampleDetermination.reasoning} />
                <p className="mt-3 border-t border-[var(--border)] pt-3 text-xs text-neutral-500">
                  {sampleDetermination.disclaimer}
                </p>
              </div>
            </details>
          )}
        </div>
      )}
    </Card>
  )
}
