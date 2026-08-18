import Link from 'next/link'
import type { OpenThread } from '@/lib/timeline'
import { Empty, money, Panel, shortDate } from '@/app/records-ui'

/**
 * What this customer is still owed, most urgent first.
 *
 * Sits above the timeline on both record pages, because a history answers
 * "what happened" and this answers "what am I supposed to do" — and the second
 * question is the one somebody opened the page with. The ordering is the pure
 * layer's (`openThreads`), never re-sorted here: a screen that re-ranks a
 * ranked list is a second ranking nobody tested.
 */

const KIND_LABEL: Record<OpenThread['kind'], string> = {
  // The advisor-facing wording from `DECISIONS` in presentation/decisions.ts,
  // so a call-me reads the same on a customer record as it did at the podium.
  CALL_ME: 'Wants to talk',
  MENU_DECLINE: 'Not today',
  OPEN_DECLINE: 'Declined',
  CADENCE_TASK: 'Follow-up',
}

const KIND_TONE: Record<OpenThread['kind'], string> = {
  CALL_ME: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  MENU_DECLINE: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  OPEN_DECLINE: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  CADENCE_TASK: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
}

export function OpenThreadsPanel({
  threads,
  showVehicle = true,
}: {
  threads: OpenThread[]
  /** Off on a vehicle record, where every row is about the same car. */
  showVehicle?: boolean
}) {
  return (
    <Panel title={`Open threads (${threads.length})`}>
      {threads.length === 0 ? (
        <Empty>Nothing outstanding. Every question they asked has an answer.</Empty>
      ) : (
        <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {threads.map((t) => (
            <li key={t.id} className="flex items-baseline justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="flex flex-wrap items-baseline gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${KIND_TONE[t.kind]}`}
                  >
                    {KIND_LABEL[t.kind]}
                  </span>
                  {t.href ? (
                    <Link href={t.href} className="font-medium hover:underline">
                      {t.title}
                    </Link>
                  ) : (
                    <span className="font-medium">{t.title}</span>
                  )}
                </p>
                <p className="text-xs text-neutral-500">
                  {shortDate(t.at)}
                  {showVehicle && t.vehicleLabel ? ` · ${t.vehicleLabel}` : ''}
                  {t.detail ? ` · ${t.detail}` : ''}
                </p>
              </div>
              {t.amount !== null && (
                <span className="shrink-0 font-bold tabular-nums">{money(t.amount)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
