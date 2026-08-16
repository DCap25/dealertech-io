/**
 * Small shared pieces of the platform console.
 *
 * Extracted when the tenant pages arrived and needed the same status badge and
 * the same relative clock as the operations page. Pure presentation — nothing
 * here reads a database or a session.
 */

/**
 * Colour carries meaning here, so it is worth stating what it means.
 *
 * Rose is "somebody must do something": the account has stopped, or is about
 * to. Amber is "a clock is running but the dealership is fine". Emerald is
 * paying and healthy. Neutral is a state with no work attached to it.
 *
 * TRIAL is deliberately amber rather than emerald — a trial is a deal that has
 * not closed, and a console that renders it as success hides the pipeline.
 */
const TONE: Record<string, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  COMPED: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  TRIAL: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  PAST_DUE: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  RESTRICTED: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200',
  SUSPENDED: 'bg-rose-200 text-rose-900 dark:bg-rose-900 dark:text-rose-100',
  EXPIRED: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200',
  CANCELED: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
  CHURNED: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
}

export function LifecycleBadge({ status }: { status: string }) {
  const tone = TONE[status] ?? 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300'
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${tone}`}>
      {status.toLowerCase().replace('_', ' ')}
    </span>
  )
}

/**
 * Relative time, measured from one instant the caller supplies.
 *
 * Takes `now` rather than reading the clock for the same reason the operations
 * page hoists it: a page that calls Date.now() in four places is one where "36
 * hours" quietly means four different things, and the linter objects to
 * reading a clock during a render at all.
 */
export function ago(d: Date | null, now: number): string {
  if (!d) return 'never'
  const hours = Math.floor((now - d.getTime()) / 3_600_000)
  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
