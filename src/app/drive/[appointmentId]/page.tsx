import Link from 'next/link'
import { notFound } from 'next/navigation'
import { loadDriveDay, getDefaultStore } from '@/lib/prep-sheet/load'
import type { TermStatus } from '@/lib/warranty'
import { AlertList, money, OpportunityRow, timeOf } from '../ui'

export const dynamic = 'force-dynamic'

const DAY = new Date('2026-08-12T12:00:00')

export async function generateMetadata({
  params,
}: {
  params: Promise<{ appointmentId: string }>
}) {
  const { appointmentId } = await params
  const store = await getDefaultStore()
  if (!store) return { title: 'Prep Sheet' }
  const sheets = await loadDriveDay(store.id, DAY, DAY)
  const sheet = sheets.find((s) => s.appointment?.id === appointmentId)
  return {
    title: sheet
      ? `${sheet.customer.name} — ${sheet.vehicle.modelYear} ${sheet.vehicle.make} ${sheet.vehicle.model ?? ''}`.trim()
      : 'Prep Sheet',
  }
}

function TermBar({ term }: { term: TermStatus }) {
  const monthsPct = term.term.months && term.monthsRemaining !== null
    ? Math.max(0, Math.min(100, (term.monthsRemaining / term.term.months) * 100))
    : term.term.months === null ? 100 : 0
  const milesPct = term.term.miles && term.milesRemaining !== null
    ? Math.max(0, Math.min(100, (term.milesRemaining / term.term.miles) * 100))
    : term.term.miles === null ? 100 : 0
  const pct = Math.min(monthsPct, milesPct)

  return (
    <div className="py-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{term.name}</span>
        <span className={term.active ? 'text-emerald-700 dark:text-emerald-400' : 'text-neutral-500'}>
          {term.active
            ? `${term.monthsRemaining ?? '∞'} mo · ${term.milesRemaining?.toLocaleString() ?? '∞'} mi`
            : `expired${term.expiredBy ? ` on ${term.expiredBy.toLowerCase()}` : ''}`}
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
        <div
          className={`h-full rounded-full ${term.active ? 'bg-emerald-500' : 'bg-neutral-400 dark:bg-neutral-600'}`}
          style={{ width: `${term.active ? pct : 0}%` }}
        />
      </div>
    </div>
  )
}

export default async function PrepSheetPage({
  params,
}: {
  params: Promise<{ appointmentId: string }>
}) {
  const { appointmentId } = await params
  const store = await getDefaultStore()
  if (!store) notFound()

  const sheets = await loadDriveDay(store.id, DAY, DAY)
  const sheet = sheets.find((s) => s.appointment?.id === appointmentId)
  if (!sheet) notFound()

  const terms = [sheet.warranty.basic, sheet.warranty.powertrain, sheet.warranty.emissionsLong, sheet.warranty.hybridEv, sheet.warranty.corrosion]
    .filter((t): t is TermStatus => Boolean(t))

  return (
    <main className="mx-auto max-w-5xl px-6 py-8 print:max-w-none print:px-0">
      <Link href="/drive" className="text-sm text-neutral-500 hover:underline print:hidden">
        ← Today&rsquo;s drive
      </Link>

      {/* -------------------------------------------------------- header */}
      <header className="mt-3 flex flex-wrap items-start justify-between gap-4 border-b border-neutral-200 pb-5 dark:border-neutral-800">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-neutral-500">Prep sheet</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">{sheet.customer.name}</h1>
          <p className="mt-1 text-lg text-neutral-700 dark:text-neutral-300">
            {sheet.vehicle.modelYear} {sheet.vehicle.make} {sheet.vehicle.model}
          </p>
          <p className="mt-1 font-mono text-xs text-neutral-500">{sheet.vehicle.vin}</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold tabular-nums">
            {sheet.appointment && timeOf(sheet.appointment.scheduledAt)}
          </p>
          <p className="text-sm text-neutral-500">
            {sheet.appointment?.transportType.replace('_', ' ')}
            {sheet.appointment?.advisorName ? ` · ${sheet.appointment.advisorName}` : ''}
          </p>
          {sheet.appointment?.promisedAt && (
            <p className="text-sm text-neutral-500">
              promised {timeOf(sheet.appointment.promisedAt)}
            </p>
          )}
        </div>
      </header>

      {sheet.alerts.length > 0 && (
        <div className="mt-5">
          <AlertList alerts={sheet.alerts} />
        </div>
      )}

      {/* --------------------------------------------------- at a glance */}
      <section className="mt-5 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <p className="text-xs uppercase tracking-wide text-neutral-500">Total opportunity</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{money(sheet.totals.opportunityValue)}</p>
        </div>
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950">
          <p className="text-xs uppercase tracking-wide text-emerald-800 dark:text-emerald-300">Already covered</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-800 dark:text-emerald-200">
            {money(sheet.totals.coveredValue)}
          </p>
          <p className="text-xs text-emerald-700 dark:text-emerald-400">lead with this</p>
        </div>
        <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <p className="text-xs uppercase tracking-wide text-neutral-500">Customer would owe</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{money(sheet.totals.customerOutOfPocket)}</p>
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_18rem]">
        {/* ------------------------------------------------ opportunities */}
        <section>
          <h2 className="text-sm font-bold uppercase tracking-widest text-neutral-500">
            What to present, in order
          </h2>
          {sheet.opportunities.length === 0 ? (
            <p className="mt-3 rounded-xl border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500 dark:border-neutral-700">
              Nothing outstanding on this vehicle. Confirm the concern and complete the inspection.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-neutral-100 dark:divide-neutral-800">
              {sheet.opportunities.map((o) => (
                <OpportunityRow key={o.id} opportunity={o} />
              ))}
            </ul>
          )}
        </section>

        {/* ------------------------------------------------------ sidebar */}
        <aside className="space-y-5">
          <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
            <h3 className="text-xs font-bold uppercase tracking-widest text-neutral-500">Customer</h3>
            <dl className="mt-2 space-y-1 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-neutral-500">Visits</dt>
                <dd className="font-medium tabular-nums">{sheet.customer.visitCount}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-neutral-500">Lifetime</dt>
                <dd className="font-medium tabular-nums">{money(sheet.customer.lifetimeSpend)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-neutral-500">Prefers</dt>
                <dd className="font-medium">{sheet.customer.preferredChannel}</dd>
              </div>
              {sheet.customer.lastVisitAt && (
                <div className="flex justify-between gap-2">
                  <dt className="text-neutral-500">Last in</dt>
                  <dd className="font-medium">
                    {sheet.customer.lastVisitAt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                  </dd>
                </div>
              )}
            </dl>
          </section>

          <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
            <h3 className="text-xs font-bold uppercase tracking-widest text-neutral-500">Coverage stack</h3>
            <div className="mt-2 divide-y divide-neutral-100 dark:divide-neutral-800">
              {terms.map((t) => <TermBar key={t.name} term={t} />)}
            </div>
            {!sheet.warranty.known && (
              <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                No reference data for {sheet.vehicle.make}. Verify in the OEM portal.
              </p>
            )}
          </section>

          <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
            <h3 className="text-xs font-bold uppercase tracking-widest text-neutral-500">Vehicle</h3>
            <dl className="mt-2 space-y-1 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-neutral-500">Odometer</dt>
                <dd className="font-medium tabular-nums">{sheet.vehicle.currentMileage.toLocaleString()}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-neutral-500">At arrival</dt>
                <dd className="font-medium tabular-nums">{sheet.projectedMileage.toLocaleString()}</dd>
              </div>
              {sheet.vehicle.avgMilesPerDay && (
                <div className="flex justify-between gap-2">
                  <dt className="text-neutral-500">Miles/day</dt>
                  <dd className="font-medium tabular-nums">{sheet.vehicle.avgMilesPerDay.toFixed(0)}</dd>
                </div>
              )}
              {sheet.vehicle.isHybridOrEv && (
                <p className="mt-2 rounded bg-sky-50 px-2 py-1 text-xs text-sky-900 dark:bg-sky-950 dark:text-sky-200">
                  Hybrid/EV — high-voltage terms applied
                </p>
              )}
            </dl>
          </section>
        </aside>
      </div>

      <footer className="mt-8 border-t border-neutral-200 pt-4 text-xs text-neutral-500 dark:border-neutral-800">
        Advisory only. DealerTech does not adjudicate claims — the administrator or manufacturer does.
        Verify coverage and obtain authorization before beginning work or quoting a customer.
      </footer>
    </main>
  )
}
