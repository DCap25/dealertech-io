import Link from 'next/link'

export function money(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

export function shortDate(d: Date | null): string {
  if (!d) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function monthYear(d: Date | null): string {
  if (!d) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

export function formatPhone(raw: string | null): string {
  if (!raw) return '—'
  const digits = raw.replace(/\D/g, '')
  if (digits.length !== 10) return raw
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

export function Panel({
  title,
  action,
  children,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-neutral-200 dark:border-neutral-800">
      <header className="flex items-center justify-between gap-3 border-b border-neutral-100 px-4 py-2.5 dark:border-neutral-800">
        <h2 className="text-xs font-bold uppercase tracking-widest text-neutral-500">{title}</h2>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  )
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-neutral-500">{children}</p>
}

export function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd className={`text-lg font-bold tabular-nums ${tone ?? ''}`}>{value}</dd>
    </div>
  )
}

/**
 * Consent, shown per channel with its provenance.
 *
 * A boolean alone is useless in a dispute — the source and date are what
 * actually answer "why did you text this person".
 */
export function ConsentBadge({
  scope,
  granted,
  at,
  source,
}: {
  scope: string
  granted: boolean
  at: Date | null
  source: string | null
}) {
  const label = scope.replace(/_/g, ' ').toLowerCase()
  return (
    <div className="flex items-baseline justify-between gap-2 py-1 text-sm">
      <span className="capitalize">{label}</span>
      <span className="text-right">
        <span
          className={
            granted
              ? 'font-medium text-emerald-700 dark:text-emerald-400'
              : 'font-medium text-rose-700 dark:text-rose-400'
          }
        >
          {granted ? 'granted' : 'not granted'}
        </span>
        {at && (
          <span className="ml-1 text-xs text-neutral-500">
            {shortDate(at)}
            {source ? ` · ${source.toLowerCase().replace(/_/g, ' ')}` : ''}
          </span>
        )}
        {!at && <span className="ml-1 text-xs text-neutral-400">no recorded event</span>}
      </span>
    </div>
  )
}

export function VehicleLink({
  id,
  label,
  className,
}: {
  id: string
  label: string
  className?: string
}) {
  return (
    <Link href={`/vehicles/${id}`} className={className ?? 'font-medium hover:underline'}>
      {label}
    </Link>
  )
}
