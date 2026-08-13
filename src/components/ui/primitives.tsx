import type { CoverageTone } from '@/lib/prep-sheet/presentation'

/**
 * Shared visual primitives. Server-safe — no state, no effects — so they can
 * render on either the drive or the podium without a client boundary.
 */

export const TONE_STYLE: Record<CoverageTone, {
  ring: string
  text: string
  chipBg: string
  track: string
}> = {
  GOOD: {
    ring: 'stroke-emerald-500',
    text: 'text-emerald-700 dark:text-emerald-400',
    chipBg: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
    track: 'stroke-emerald-500/15',
  },
  WARNING: {
    ring: 'stroke-amber-500',
    text: 'text-amber-700 dark:text-amber-400',
    chipBg: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
    track: 'stroke-amber-500/15',
  },
  CRITICAL: {
    ring: 'stroke-rose-500',
    text: 'text-rose-700 dark:text-rose-400',
    chipBg: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200',
    track: 'stroke-rose-500/15',
  },
  EXPIRED: {
    ring: 'stroke-neutral-400 dark:stroke-neutral-600',
    text: 'text-neutral-500',
    chipBg: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400',
    track: 'stroke-neutral-300/40 dark:stroke-neutral-700/40',
  },
}

/**
 * Circular progress. The sweep is drawn with stroke-dashoffset so it can be
 * animated purely in CSS; the two custom properties are what the keyframe
 * interpolates between.
 */
export function ProgressRing({
  percent,
  tone,
  size = 92,
  stroke = 8,
  animate = true,
  children,
}: {
  percent: number
  tone: CoverageTone
  size?: number
  stroke?: number
  animate?: boolean
  children?: React.ReactNode
}) {
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const clamped = Math.max(0, Math.min(100, percent))
  const offset = circumference - (clamped / 100) * circumference
  const style = TONE_STYLE[tone]

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className={animate ? 'ring-animate -rotate-90' : '-rotate-90'}
        aria-hidden
      >
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" strokeWidth={stroke}
          className={style.track}
        />
        <circle
          data-progress
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" strokeWidth={stroke} strokeLinecap="round"
          className={style.ring}
          style={{
            strokeDasharray: circumference,
            strokeDashoffset: offset,
            // Consumed by the ring-draw keyframe in globals.css.
            ['--ring-circumference' as string]: `${circumference}`,
            ['--ring-offset' as string]: `${offset}`,
          }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center leading-none">
        {children}
      </div>
    </div>
  )
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'covered' | 'safety' | 'value' | 'context' | 'neutral'
  children: React.ReactNode
}) {
  const styles: Record<string, string> = {
    covered: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
    safety: 'bg-rose-600 text-white',
    value: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200',
    context: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
    neutral: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${styles[tone]}`}>
      {children}
    </span>
  )
}

export function Card({
  className = '',
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={`rounded-2xl border border-[var(--border)] bg-[var(--surface)] ${className}`}
    >
      {children}
    </div>
  )
}

export function money(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
