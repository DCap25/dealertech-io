import Link from 'next/link'
import { groupByDay, type TimelineEvent } from '@/lib/timeline'
import { Empty, money, Panel } from '@/app/records-ui'

/**
 * The history, reverse-chronological, grouped by day.
 *
 * By day rather than by visit — the reasoning is in `groupByDay`, and the
 * short version is that most of the ten sources have no visit to belong to.
 *
 * Every sentence on screen was written by the pure assembly. This component
 * decides colour, spacing and how much detail is too much, and nothing else:
 * the customer record and the vehicle record render the same events through
 * the same file, so they cannot start describing the same morning differently.
 */

const TONE_DOT: Record<TimelineEvent['tone'], string> = {
  GOOD: 'bg-emerald-500',
  WARN: 'bg-amber-500',
  NEUTRAL: 'bg-neutral-300 dark:bg-neutral-700',
}

/**
 * How many detail lines an event may show before it is folded.
 *
 * A fully worked sheet is a dozen outcomes and a menu is a dozen answers; both
 * would otherwise turn one morning into a page of its own and bury the visit
 * before and after it. Four is enough to see the shape.
 */
const MAX_DETAIL = 4

function dayLabel(at: Date): string {
  return at.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  })
}

function timeLabel(at: Date): string {
  return at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function Event({ event }: { event: TimelineEvent }) {
  const shown = event.detail.slice(0, MAX_DETAIL)
  const folded = event.detail.length - shown.length

  return (
    <li className="relative flex gap-3 py-2 pl-4">
      <span
        className={`absolute left-0 top-3.5 h-2 w-2 rounded-full ${TONE_DOT[event.tone]}`}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <p className="text-sm font-medium">
            {event.href ? (
              <Link href={event.href} className="hover:underline">
                {event.title}
              </Link>
            ) : (
              event.title
            )}
          </p>
          <span className="shrink-0 text-xs tabular-nums text-neutral-500">
            {timeLabel(event.at)}
            {event.amount !== null ? ` · ${money(event.amount)}` : ''}
          </span>
        </div>
        {shown.length > 0 && (
          <ul className="mt-0.5 space-y-0.5">
            {shown.map((line, i) => (
              <li key={i} className="text-xs text-neutral-500">
                {line}
              </li>
            ))}
            {folded > 0 && (
              <li className="text-xs text-neutral-400">
                and {folded} more
              </li>
            )}
          </ul>
        )}
      </div>
    </li>
  )
}

export function TimelineFeed({
  events,
  title = 'Timeline',
}: {
  events: TimelineEvent[]
  title?: string
}) {
  const days = groupByDay(events)

  return (
    <Panel title={`${title} (${events.length})`}>
      {days.length === 0 ? (
        <Empty>Nothing recorded yet.</Empty>
      ) : (
        <div className="space-y-4">
          {days.map((day) => (
            <section key={day.key}>
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-neutral-500">
                {dayLabel(day.at)}
              </h3>
              <ul className="mt-1 border-l border-neutral-200 dark:border-neutral-800">
                {day.events.map((event) => (
                  <Event key={event.id} event={event} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Panel>
  )
}
