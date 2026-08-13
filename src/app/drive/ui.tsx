import type { Opportunity, PrepSheet, Urgency } from '@/lib/prep-sheet'
import type { Payer } from '@/lib/coverage'

export function money(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

export function timeOf(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' })
}

export const URGENCY_STYLE: Record<Urgency, string> = {
  SAFETY: 'bg-rose-600 text-white',
  HIGH: 'bg-amber-500 text-white',
  MEDIUM: 'bg-sky-500 text-white',
  LOW: 'bg-neutral-400 text-white',
}

export const PAYER_LABEL: Record<Payer, string> = {
  OEM_RECALL: 'Recall — OEM pays',
  PPM: 'Prepaid plan',
  TIRE_WHEEL: 'Tire & wheel',
  OEM_WARRANTY: 'Factory warranty',
  VSC: 'Service contract',
  GOODWILL: 'Goodwill',
  CUSTOMER_PAY: 'Customer pay',
}

const PAYER_STYLE: Record<Payer, string> = {
  OEM_RECALL: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200',
  PPM: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  TIRE_WHEEL: 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-200',
  OEM_WARRANTY: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  VSC: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  GOODWILL: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  CUSTOMER_PAY: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
}

export function PayerBadge({ payer }: { payer: Payer }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${PAYER_STYLE[payer]}`}>
      {PAYER_LABEL[payer]}
    </span>
  )
}

export function UrgencyBadge({ urgency }: { urgency: Urgency }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${URGENCY_STYLE[urgency]}`}>
      {urgency}
    </span>
  )
}

/** One opportunity, written the way an advisor would read it at the podium. */
export function OpportunityRow({ opportunity }: { opportunity: Opportunity }) {
  const o = opportunity
  return (
    <li className="flex gap-3 py-3">
      <div className="w-1 shrink-0 rounded-full" style={{ background: 'currentColor' }} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <UrgencyBadge urgency={o.urgency} />
          <span className="font-semibold">{o.title}</span>
          <PayerBadge payer={o.likelyPayer} />
        </div>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{o.detail}</p>
        <p className="mt-1.5 rounded bg-neutral-50 px-2 py-1 text-sm italic text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
          {o.talkTrack}
        </p>
      </div>
      <div className="shrink-0 text-right">
        {o.estimatedAmount > 0 && (
          <>
            <p className="font-bold tabular-nums">{money(o.estimatedAmount)}</p>
            <p className="text-xs text-neutral-500">
              {o.customerOutOfPocket === 0
                ? 'customer pays nothing'
                : `${money(o.customerOutOfPocket)} to customer`}
            </p>
          </>
        )}
        <p className="mt-1 text-[10px] uppercase tracking-wide text-neutral-400">
          {Math.round(o.closeProbability * 100)}% likely
        </p>
      </div>
    </li>
  )
}

export function AlertList({ alerts }: { alerts: string[] }) {
  if (alerts.length === 0) return null
  return (
    <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 dark:border-rose-800 dark:bg-rose-950">
      <ul className="space-y-1">
        {alerts.map((a, i) => (
          <li key={i} className="text-sm font-medium text-rose-900 dark:text-rose-200">{a}</li>
        ))}
      </ul>
    </div>
  )
}

/** Compact coverage-stack strip for the list view. */
export function CoverageChips({ sheet }: { sheet: PrepSheet }) {
  const terms = [sheet.warranty.basic, sheet.warranty.powertrain, sheet.warranty.hybridEv]
    .filter((t) => t?.active)
  return (
    <div className="flex flex-wrap gap-1">
      {terms.map((t) => (
        <span key={t!.name} className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
          {t!.name.replace(' (Bumper-to-Bumper)', '')} · {t!.monthsRemaining ?? '∞'}mo
        </span>
      ))}
      {terms.length === 0 && (
        <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
          Out of factory warranty
        </span>
      )}
    </div>
  )
}
