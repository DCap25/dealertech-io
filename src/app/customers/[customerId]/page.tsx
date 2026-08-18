import Link from 'next/link'
import { notFound } from 'next/navigation'
import { loadCustomerRecord } from '@/lib/records/customer'
import {
  ConsentBadge, Empty, formatPhone, money, Panel, shortDate, Stat, VehicleLink,
} from '../../records-ui'
import { requireUser, getCurrentStore } from '@/lib/auth/session'
import { fenceSales } from '@/lib/auth/sales'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ customerId: string }>
}) {
  const { customerId } = await params
  const store = await getCurrentStore()
  if (!store) return { title: 'Customer' }
  const record = await loadCustomerRecord(store.id, customerId)
  return { title: record ? `${record.name}` : 'Customer' }
}

export default async function CustomerPage({
  params,
}: {
  params: Promise<{ customerId: string }>
}) {
  // Enforced here, not only in the middleware. The middleware is a separate
  // deploy artifact on the host, and this page must not serve a dealership
  // to an anonymous request even if it never runs.
  const user = await requireUser()
  // A salesperson has one page and this is not it (DRIVE_PLAN §9 Q2).
  fenceSales(user.role)
  const { customerId } = await params
  const store = await getCurrentStore()
  if (!store) notFound()

  const record = await loadCustomerRecord(store.id, customerId)
  if (!record) notFound()

  const openDeclineValue = record.openDeclines.reduce((s, d) => s + d.quotedAmount, 0)
  const pinned = record.notes.filter((n) => n.isPinned)

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <Link href="/customers" className="text-sm text-neutral-500 hover:underline">
        ← Customers
      </Link>

      <header className="mt-3 flex flex-wrap items-start justify-between gap-4 border-b border-neutral-200 pb-5 dark:border-neutral-800">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{record.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-neutral-600 dark:text-neutral-400">
            {record.mobilePhone && (
              <a href={`tel:${record.mobilePhone}`} className="font-mono hover:underline">
                {formatPhone(record.mobilePhone)}
              </a>
            )}
            {record.email && <span>{record.email}</span>}
            {record.address && <span>{record.address}</span>}
          </div>
          {record.doNotCall && (
            <p className="mt-2 inline-block rounded bg-rose-100 px-2 py-1 text-xs font-bold uppercase text-rose-700 dark:bg-rose-950 dark:text-rose-300">
              Do not contact — suppressed from every follow-up rule
            </p>
          )}
        </div>
        <dl className="flex gap-6">
          <Stat label="Visits" value={String(record.visitCount)} />
          <Stat label="Lifetime" value={money(record.lifetimeSpend)} />
          <Stat
            label="Declined"
            value={money(openDeclineValue)}
            tone={openDeclineValue > 0 ? 'text-amber-700 dark:text-amber-400' : undefined}
          />
        </dl>
      </header>

      {pinned.length > 0 && (
        <div className="mt-5 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
          {pinned.map((n) => (
            <p key={n.id} className="text-sm font-medium text-amber-900 dark:text-amber-200">
              {n.body}
            </p>
          ))}
        </div>
      )}

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          {/* ------------------------------------------------- vehicles */}
          <Panel title={`Vehicles (${record.vehicles.length})`}>
            {record.vehicles.length === 0 ? (
              <Empty>No vehicles on file.</Empty>
            ) : (
              <ul className="space-y-2">
                {record.vehicles.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <VehicleLink id={v.id} label={v.label} />
                      <p className="font-mono text-xs text-neutral-500">{v.vin}</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      {v.isOriginalOwner && (
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                          Original owner
                        </span>
                      )}
                      {v.soldByStore && (
                        <span className="rounded bg-sky-100 px-1.5 py-0.5 font-medium text-sky-800 dark:bg-sky-950 dark:text-sky-200">
                          We sold it
                        </span>
                      )}
                      {v.contractCount > 0 && (
                        <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                          {v.contractCount} contract{v.contractCount === 1 ? '' : 's'}
                        </span>
                      )}
                      {v.currentMileage !== null && (
                        <span className="tabular-nums text-neutral-500">
                          {v.currentMileage.toLocaleString()} mi
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {/* ------------------------------------------ declined work */}
          <Panel title={`Open declined work (${record.openDeclines.length})`}>
            {record.openDeclines.length === 0 ? (
              <Empty>Nothing outstanding.</Empty>
            ) : (
              <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {record.openDeclines.map((d) => (
                  <li key={d.id} className="flex items-baseline justify-between gap-3 py-2">
                    <div>
                      <p className="font-medium">{d.description}</p>
                      <p className="text-xs text-neutral-500">
                        {shortDate(d.declinedAt)}
                        {d.vehicleLabel ? ` · ${d.vehicleLabel}` : ''}
                        {d.declineReason ? ` · “${d.declineReason}”` : ''}
                      </p>
                    </div>
                    <span className="shrink-0 font-bold tabular-nums">{money(d.quotedAmount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {/* ---------------------------------------- service history */}
          <Panel title={`Service history (${record.repairOrders.length})`}>
            {record.repairOrders.length === 0 ? (
              <Empty>No repair orders yet.</Empty>
            ) : (
              <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {record.repairOrders.map((ro) => (
                  <li key={ro.id} className="flex items-baseline justify-between gap-3 py-2">
                    <div>
                      <p className="text-sm">
                        <span className="font-mono font-medium">RO {ro.roNumber}</span>
                        <span className="ml-2 text-neutral-500">{shortDate(ro.openedAt)}</span>
                      </p>
                      <p className="text-xs text-neutral-500">
                        {ro.vehicleLabel ?? 'Unknown vehicle'}
                        {ro.mileageIn !== null ? ` · ${ro.mileageIn.toLocaleString()} mi` : ''}
                        {` · ${ro.lineCount} line${ro.lineCount === 1 ? '' : 's'}`}
                      </p>
                    </div>
                    <span className="shrink-0 tabular-nums">{money(ro.customerPayTotal)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        {/* ------------------------------------------------------ sidebar */}
        <aside className="space-y-5">
          <Panel title="Contact preferences">
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-neutral-500">Prefers</dt>
                <dd className="font-medium">{record.preferredChannel}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-neutral-500">First visit</dt>
                <dd className="font-medium">{shortDate(record.firstVisitAt)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-neutral-500">Last visit</dt>
                <dd className="font-medium">{shortDate(record.lastVisitAt)}</dd>
              </div>
            </dl>
          </Panel>

          <Panel title="Consent">
            <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {record.consent.map((c) => (
                <ConsentBadge key={c.scope} {...c} />
              ))}
            </div>
            <p className="mt-3 text-xs text-neutral-500">
              Sourced from the append-only consent log. The flags on the customer row are only a
              cache of this.
            </p>
          </Panel>

          <Panel title={`Open follow-ups (${record.openTasks.length})`}>
            {record.openTasks.length === 0 ? (
              <Empty>Nothing queued.</Empty>
            ) : (
              <ul className="space-y-2">
                {record.openTasks.map((t) => (
                  <li key={t.id} className="text-sm">
                    <p className="font-medium">{t.title}</p>
                    <p className="text-xs text-neutral-500">
                      due {shortDate(t.dueAt)}
                      {t.estimatedValue > 0 ? ` · ${money(t.estimatedValue)}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title={`Appointments (${record.appointments.length})`}>
            {record.appointments.length === 0 ? (
              <Empty>None scheduled.</Empty>
            ) : (
              <ul className="space-y-2 text-sm">
                {record.appointments.slice(0, 6).map((a) => (
                  <li key={a.id}>
                    <Link href={`/drive/${a.id}`} className="font-medium hover:underline">
                      {shortDate(a.scheduledAt)}
                    </Link>
                    <span className="ml-2 text-xs text-neutral-500">{a.status.toLowerCase()}</span>
                    {a.vehicleLabel && (
                      <p className="text-xs text-neutral-500">{a.vehicleLabel}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title={`Notes (${record.notes.length})`}>
            {record.notes.length === 0 ? (
              <Empty>No notes.</Empty>
            ) : (
              <ul className="space-y-2 text-sm">
                {record.notes.slice(0, 8).map((n) => (
                  <li key={n.id}>
                    <p>{n.body}</p>
                    <p className="text-xs text-neutral-500">{shortDate(n.createdAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </aside>
      </div>
    </main>
  )
}
