import { ALL_LEAD_STAGES, STAGE_LABEL, type LeadStage } from '@/lib/crm/stage'

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

/**
 * Where a lead stands, as a chip.
 *
 * The same three-colour convention as `LifecycleBadge` above, applied to the
 * funnel instead of to billing: rose is somebody must do something, amber is a
 * clock is running, emerald is arrived, neutral is a state with no work
 * attached. LOST is neutral rather than rose on purpose — a deal that ended is
 * finished, not urgent, and colouring it as an alarm would put every
 * historical no on the same footing as a dealership whose payment failed.
 *
 * NEW is amber because it is the one stage where the clock is running against
 * us and nobody has done anything yet.
 */
const STAGE_TONE: Record<LeadStage, string> = {
  NEW: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  CONTACTED: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
  CODE_SENT: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  TOURED: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  WALKTHROUGH_BOOKED: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200',
  WALKTHROUGH_DONE: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200',
  PROVISIONED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  LIVE: 'bg-emerald-200 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100',
  LOST: 'bg-neutral-200 text-neutral-500 line-through dark:bg-neutral-800 dark:text-neutral-400',
}

export function StageChip({ stage }: { stage: LeadStage }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${STAGE_TONE[stage]}`}>
      {STAGE_LABEL[stage]}
    </span>
  )
}

/**
 * The stage a `?filter=` value names, or null for "all".
 *
 * `?filter=new` is the link on the morning read's uncontacted tile and it
 * shipped before the pipeline did, so it has to keep working — it maps onto
 * NEW, which is the same set of leads it always showed. Anything unrecognised
 * falls through to the whole list rather than to an empty page, because a
 * mistyped URL should look like the default, not like a dealership having no
 * leads.
 */
export function stageForFilter(filter: string | undefined): LeadStage | null {
  if (!filter) return null
  const wanted = filter.toUpperCase().replace(/-/g, '_')
  return (ALL_LEAD_STAGES as readonly string[]).includes(wanted) ? (wanted as LeadStage) : null
}

/** The inverse: the query value for a stage. */
export function filterForStage(stage: LeadStage): string {
  return stage.toLowerCase().replace(/_/g, '-')
}
