import Link from 'next/link'
import { UserBadge } from '@/components/auth/user-badge'
import { loadAdvisorWorkspace } from '@/lib/advisor/load'
import { getDefaultStore } from '@/lib/prep-sheet/load'
import { money } from '../records-ui'
import { demoNow } from '@/lib/demo-day'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'My Day' }

const DAY = () => demoNow()

const RO_STATUS_STYLE: Record<string, string> = {
  OPEN: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  DISPATCHED: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  IN_PROGRESS: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200',
  WAITING_PARTS: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  WAITING_APPROVAL: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200',
  WAITING_SUBLET: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  COMPLETE: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
}

function timeOf(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' })
}

export default async function AdvisorPage() {
  const store = await getDefaultStore()
  if (!store) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="text-xl font-bold">No store found</h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">
          Run <code className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">npm run db:seed</code>.
        </p>
      </main>
    )
  }

  const ws = await loadAdvisorWorkspace(store.id, DAY())
  const awaiting = ws.appointments.filter(
    (a) => !a.repairOrderId && a.status !== 'CANCELLED' && a.status !== 'NO_SHOW',
  )

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <p className="text-xs font-bold uppercase tracking-widest text-neutral-500">
            {ws.storeName} · Service Advisor
          </p>
          <nav className="flex gap-3 text-sm text-neutral-500">
            <Link href="/drive" className="hover:underline">Prep sheets</Link>
            <Link href="/customers" className="hover:underline">Customers</Link>
            <Link href="/follow-up" className="hover:underline">Follow-ups</Link>
            <Link href="/advisor/scorecard" className="font-semibold hover:underline">
              My scorecard
            </Link>
            <UserBadge />
          </nav>
        </div>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">My day</h1>
      </header>

      <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <p className="text-xs uppercase tracking-wide text-neutral-500">To write up</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{ws.totals.awaitingWriteUp}</p>
        </div>
        <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <p className="text-xs uppercase tracking-wide text-neutral-500">Awaiting approval</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-rose-600">
            {ws.totals.awaitingApproval}
          </p>
          {ws.totals.approvalValue > 0 && (
            <p className="text-xs text-neutral-500">{money(ws.totals.approvalValue)} pending</p>
          )}
        </div>
        <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <p className="text-xs uppercase tracking-wide text-neutral-500">Ready to deliver</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
            {ws.totals.readyForDelivery}
          </p>
        </div>
        <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <p className="text-xs uppercase tracking-wide text-neutral-500">Aged 2+ days</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{ws.totals.aged}</p>
          <p className="text-xs text-neutral-500">where CSI goes to die</p>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* --------------------------------------------------- write-up queue */}
        <section>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-widest text-neutral-500">
            Arriving today ({awaiting.length})
          </h2>
          {awaiting.length === 0 ? (
            <p className="rounded-xl border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500 dark:border-neutral-700">
              Everyone is written up.
            </p>
          ) : (
            <ul className="space-y-2">
              {awaiting.map((a) => (
                <li key={a.id}>
                  <div className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className="font-mono text-sm font-bold tabular-nums">
                            {timeOf(a.scheduledAt)}
                          </span>
                          <span className="font-semibold">{a.customerName}</span>
                        </div>
                        <p className="text-sm text-neutral-500">{a.vehicleLabel}</p>
                        <p className="mt-0.5 text-sm text-neutral-600 dark:text-neutral-400">
                          {a.concerns ?? 'No concern recorded'}
                        </p>
                        <span className="mt-1 inline-block rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                          {a.transportType.replace('_', ' ')}
                        </span>
                      </div>
                      <div className="flex shrink-0 flex-col gap-1.5">
                        <Link
                          href={`/advisor/write-up/${a.id}`}
                          className="rounded-lg bg-neutral-900 px-3 py-1.5 text-center text-sm font-semibold text-white transition hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
                        >
                          Write up
                        </Link>
                        <Link
                          href={`/drive/${a.id}`}
                          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-center text-xs font-medium transition hover:border-neutral-900 dark:border-neutral-700 dark:hover:border-neutral-300"
                        >
                          Prep sheet
                        </Link>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* --------------------------------------------------------- WIP board */}
        <section>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-widest text-neutral-500">
            Work in process ({ws.repairOrders.length})
          </h2>
          {ws.repairOrders.length === 0 ? (
            <p className="rounded-xl border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500 dark:border-neutral-700">
              No open repair orders.
            </p>
          ) : (
            <ul className="space-y-2">
              {ws.repairOrders.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/advisor/ro/${r.id}`}
                    className="block rounded-xl border border-neutral-200 p-3 transition hover:border-neutral-900 dark:border-neutral-800 dark:hover:border-neutral-400"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-bold">RO {r.roNumber}</span>
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                              RO_STATUS_STYLE[r.status] ?? 'bg-neutral-100 text-neutral-700'
                            }`}
                          >
                            {r.status.replace('_', ' ')}
                          </span>
                          {r.ageDays >= 2 && (
                            <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                              {r.ageDays}d
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 font-medium">{r.customerName}</p>
                        <p className="text-sm text-neutral-500">{r.vehicleLabel}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        {r.pendingLineCount > 0 ? (
                          <>
                            <p className="font-bold tabular-nums text-rose-600">
                              {money(r.pendingValue)}
                            </p>
                            <p className="text-xs text-rose-600">
                              {r.pendingLineCount} awaiting the sell call
                            </p>
                          </>
                        ) : (
                          <p className="text-xs text-neutral-500">
                            {r.lineCount} line{r.lineCount === 1 ? '' : 's'}
                          </p>
                        )}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  )
}
