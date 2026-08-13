import Link from 'next/link'
import { loadDriveDay, getDefaultStore } from '@/lib/prep-sheet/load'
import { AlertList, CoverageChips, money, PayerBadge, timeOf, UrgencyBadge } from './ui'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: "Today's Drive",
}

export default async function DrivePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  const params = await searchParams
  const store = await getDefaultStore()

  if (!store) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="text-xl font-bold">No store found</h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">
          Run <code className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">npm run db:test:up</code> then{' '}
          <code className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">npm run db:seed</code>.
        </p>
      </main>
    )
  }

  // The seeded dealership lives on a fixed date so the demo is stable.
  const day = params.date ? new Date(`${params.date}T12:00:00`) : new Date('2026-08-12T12:00:00')
  const sheets = await loadDriveDay(store.id, day, day)

  const totalOpportunity = sheets.reduce((s, x) => s + x.totals.opportunityValue, 0)
  const totalCovered = sheets.reduce((s, x) => s + x.totals.coveredValue, 0)
  const safetyCount = sheets.filter((s) =>
    s.opportunities.some((o) => o.urgency === 'SAFETY'),
  ).length

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <p className="text-xs font-bold uppercase tracking-widest text-neutral-500">
            {store.name} · Service Drive
          </p>
          <nav className="flex gap-3 text-sm text-neutral-500">
            <Link href="/customers" className="hover:underline">Customers</Link>
            <Link href="/bdc" className="hover:underline">BDC worklist</Link>
          </nav>
        </div>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Today&rsquo;s drive</h1>
        <p className="mt-1 text-neutral-600 dark:text-neutral-400">
          {day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} ·{' '}
          {sheets.length} appointment{sheets.length === 1 ? '' : 's'}
        </p>
      </header>

      <section className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <p className="text-xs uppercase tracking-wide text-neutral-500">Opportunity on the drive</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{money(totalOpportunity)}</p>
        </div>
        <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <p className="text-xs uppercase tracking-wide text-neutral-500">Already covered</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
            {money(totalCovered)}
          </p>
          <p className="text-xs text-neutral-500">customer owes nothing on this</p>
        </div>
        <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <p className="text-xs uppercase tracking-wide text-neutral-500">Safety items</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-rose-600">{safetyCount}</p>
          <p className="text-xs text-neutral-500">vehicles needing a safety conversation</p>
        </div>
      </section>

      {sheets.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-300 p-10 text-center text-neutral-500 dark:border-neutral-700">
          No appointments scheduled.
        </p>
      ) : (
        <ul className="space-y-3">
          {sheets.map((sheet) => {
            const top = sheet.opportunities.slice(0, 3)
            return (
              <li key={sheet.appointment?.id}>
                <Link
                  href={`/drive/${sheet.appointment?.id}`}
                  className="block rounded-xl border border-neutral-200 p-4 transition hover:border-neutral-900 hover:shadow-sm dark:border-neutral-800 dark:hover:border-neutral-400"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="font-mono text-sm font-bold tabular-nums">
                          {sheet.appointment && timeOf(sheet.appointment.scheduledAt)}
                        </span>
                        <span className="text-lg font-semibold">{sheet.customer.name}</span>
                        <span className="text-sm text-neutral-500">
                          {sheet.vehicle.modelYear} {sheet.vehicle.make} {sheet.vehicle.model}
                        </span>
                      </div>
                      <p className="mt-0.5 text-sm text-neutral-600 dark:text-neutral-400">
                        {sheet.appointment?.concerns ?? 'No concern recorded'}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                          {sheet.appointment?.transportType.replace('_', ' ')}
                        </span>
                        <span className="text-[11px] text-neutral-500 tabular-nums">
                          {sheet.projectedMileage.toLocaleString()} mi projected
                        </span>
                        <CoverageChips sheet={sheet} />
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xl font-bold tabular-nums">
                        {money(sheet.totals.opportunityValue)}
                      </p>
                      <p className="text-xs text-neutral-500">
                        {sheet.opportunities.length} opportunit
                        {sheet.opportunities.length === 1 ? 'y' : 'ies'}
                      </p>
                      {sheet.totals.coveredValue > 0 && (
                        <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                          {money(sheet.totals.coveredValue)} covered
                        </p>
                      )}
                    </div>
                  </div>

                  {sheet.alerts.length > 0 && (
                    <p className="mt-3 rounded bg-rose-50 px-2 py-1 text-sm font-medium text-rose-800 dark:bg-rose-950 dark:text-rose-200">
                      {sheet.alerts[0]}
                    </p>
                  )}

                  {top.length > 0 && (
                    <ul className="mt-3 flex flex-wrap gap-2">
                      {top.map((o) => (
                        <li key={o.id} className="flex items-center gap-1.5 rounded-full border border-neutral-200 px-2 py-1 dark:border-neutral-700">
                          <UrgencyBadge urgency={o.urgency} />
                          <span className="text-xs font-medium">{o.title}</span>
                          <PayerBadge payer={o.likelyPayer} />
                        </li>
                      ))}
                      {sheet.opportunities.length > 3 && (
                        <li className="self-center text-xs text-neutral-500">
                          +{sheet.opportunities.length - 3} more
                        </li>
                      )}
                    </ul>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
