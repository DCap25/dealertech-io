'use client'

import { useEffect, useRef, useState } from 'react'
import {
  formatReading, sceneAt, statusOf, totalDurationMs, type Explainer, type Reading,
} from '@/lib/explainer'
import { Diagram } from './diagrams'

/**
 * The "why?" screen.
 *
 * Opens over the menu, runs 10–30 seconds, and hands the tablet back. It never
 * loops and it never auto-advances to a sales screen — the customer closes it
 * when they are finished reading, which is the entire point of handing them
 * the tablet in the first place.
 */

export function ExplainerPlayer({
  explainer,
  reading,
  onClose,
}: {
  explainer: Explainer
  reading: Reading | null
  onClose: () => void
}) {
  const total = totalDurationMs(explainer)
  const [elapsed, setElapsed] = useState(0)
  const [playing, setPlaying] = useState(true)
  const reducedMotion = useRef(false)

  useEffect(() => {
    /**
     * Someone who has asked their system not to animate things gets the whole
     * explanation as text, at the end state of the diagram, immediately. The
     * information is the point; the motion is a delivery mechanism.
     */
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    reducedMotion.current = query.matches
    if (query.matches) {
      elapsedBeforePause.current = total
      setElapsed(total)
      setPlaying(false)
    }
  }, [total])

  /**
   * Driven by the wall clock, not by counting ticks.
   *
   * Adding a fixed step per tick assumes the tick fires on time, and browsers
   * throttle timers hard in backgrounded or unfocused tabs — which a tablet
   * handed to a customer absolutely is between taps. A counted 40ms step
   * against a throttled one-second interval runs an eighteen-second
   * explanation for twelve minutes. Reading the clock means throttling costs
   * smoothness and nothing else.
   */
  const startedAt = useRef(0)
  const elapsedBeforePause = useRef(0)

  useEffect(() => {
    if (!playing) return

    startedAt.current = performance.now()
    let frame = 0

    const step = () => {
      const next = elapsedBeforePause.current + (performance.now() - startedAt.current)
      if (next >= total) {
        elapsedBeforePause.current = total
        setElapsed(total)
        setPlaying(false)
        return
      }
      setElapsed(next)
      frame = requestAnimationFrame(step)
    }

    frame = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(frame)
      // Remember where we got to, so resuming does not restart the scene.
      elapsedBeforePause.current = Math.min(
        total,
        elapsedBeforePause.current + (performance.now() - startedAt.current),
      )
    }
  }, [playing, total])

  // Escape closes, because a tablet in a customer's hands may be paired with a
  // keyboard at the podium.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const { caption, progress, done, index } = sceneAt(explainer, elapsed)
  const status = statusOf(explainer, reading)

  const replay = () => {
    elapsedBeforePause.current = 0
    setElapsed(0)
    setPlaying(true)
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-[var(--background)]"
      role="dialog"
      aria-modal="true"
      aria-label={explainer.title}
    >
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-y-auto px-5 py-6 sm:px-6">
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{explainer.title}</h2>
            {reading && (
              <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-neutral-600 dark:text-neutral-400">
                  Measured on your car{reading.position ? ` (${reading.position})` : ''}:
                </span>
                <span
                  className={`rounded-full px-2.5 py-1 text-sm font-bold tabular-nums ${
                    status === 'AT_LIMIT'
                      ? 'bg-rose-600 text-white'
                      : status === 'PRESENT'
                        ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'
                        : 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
                  }`}
                >
                  {formatReading(reading)}
                </span>
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="touch-target shrink-0 rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-semibold"
          >
            Close
          </button>
        </header>

        <div className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6">
          <Diagram explainer={explainer} t={progress} reading={reading} />
        </div>

        {/* Caption. Fixed height so the layout does not jump between scenes. */}
        <p className="mt-5 min-h-[5.5rem] text-lg leading-relaxed sm:min-h-[4.5rem] sm:text-xl">
          {caption}
        </p>

        <div className="mt-2 flex items-center gap-2" aria-hidden>
          {explainer.scenes.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                i < index ? 'bg-neutral-400' : i === index ? 'bg-neutral-900 dark:bg-neutral-100' : 'bg-[var(--border)]'
              }`}
            />
          ))}
        </div>

        {explainer.candour && (
          /*
            Rendered at the same weight as everything else. An honesty note in
            small grey type below the fold is a disclaimer; this is meant to be
            read.
          */
          <p className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4 text-sm leading-relaxed">
            <span className="font-semibold">Worth knowing: </span>
            {explainer.candour}
          </p>
        )}

        <div className="mt-5 rounded-2xl border border-[var(--border)] p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">
            If it waits
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
            {explainer.ifIgnored}
          </p>
        </div>

        {explainer.scale && (
          <p className="mt-4 text-xs leading-relaxed text-neutral-500">
            Scale shown is {explainer.scale.unitLabel}: {explainer.scale.fresh} when new,{' '}
            {explainer.scale.present} where replacement is usually recommended, {explainer.scale.limit} where{' '}
            {explainer.scale.limitMeans}. These are properties of the part, not of your vehicle.
          </p>
        )}
      </div>

      <div className="border-t border-[var(--border)] bg-[var(--background)]/95 px-5 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <button
            type="button"
            onClick={done ? replay : () => setPlaying((p) => !p)}
            className="touch-target rounded-xl bg-neutral-900 px-5 py-3 text-sm font-bold text-white dark:bg-white dark:text-neutral-900"
          >
            {done ? 'Play again' : playing ? 'Pause' : 'Play'}
          </button>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--border)]">
            <div
              className="h-full bg-neutral-900 dark:bg-neutral-100"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <span className="w-12 text-right text-xs tabular-nums text-neutral-500">
            {Math.ceil((total - elapsed) / 1000)}s
          </span>
        </div>
      </div>
    </div>
  )
}
