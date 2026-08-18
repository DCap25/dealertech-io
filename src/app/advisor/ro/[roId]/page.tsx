import Link from 'next/link'
import { notFound } from 'next/navigation'
import { loadRepairOrder } from '@/lib/advisor/load'
import type { TermStatus } from '@/lib/warranty'
import { money, Panel, shortDate } from '../../../records-ui'
import { AddRecommendation, CloseRoButton, PendingLine } from './sell-call'
import { demoNow } from '@/lib/demo-day'
import { requireUser, getCurrentStore } from '@/lib/auth/session'
import { fenceSales } from '@/lib/auth/sales'

export const dynamic = 'force-dynamic'

const AS_OF = () => demoNow()

const PAYER_LABEL: Record<string, string> = {
  OEM_RECALL: 'Recall — OEM pays',
  PPM: 'Prepaid plan',
  TIRE_WHEEL: 'Tire & wheel',
  OEM_WARRANTY: 'Factory warranty',
  VSC: 'Service contract',
  GOODWILL: 'Goodwill',
  CUSTOMER_PAY: 'Customer pay',
}

export async function generateMetadata({ params }: { params: Promise<{ roId: string }> }) {
  const { roId } = await params
  const store = await getCurrentStore()
  if (!store) return { title: 'Repair Order' }
  const ro = await loadRepairOrder(store.id, roId, AS_OF())
  return { title: ro ? `RO ${ro.roNumber} — ${ro.customerName}` : 'Repair Order' }
}

export default async function RepairOrderPage({
  params,
}: {
  params: Promise<{ roId: string }>
}) {
  // Enforced here, not only in the middleware. The middleware is a separate
  // deploy artifact on the host, and this page must not serve a dealership
  // to an anonymous request even if it never runs.
  const user = await requireUser()
  // A salesperson has one page and this is not it (DRIVE_PLAN §9 Q2).
  fenceSales(user.role)
  const { roId } = await params
  const store = await getCurrentStore()
  if (!store) notFound()

  const ro = await loadRepairOrder(store.id, roId, AS_OF())
  if (!ro) notFound()

  const pending = ro.lines.filter((l) => l.status === 'RECOMMENDED' || l.status === 'PENDING_APPROVAL')
  const approved = ro.lines.filter((l) => l.status === 'APPROVED' || l.status === 'COMPLETE')
  const declined = ro.lines.filter((l) => l.status === 'DECLINED')
  const activeTerms = [ro.warranty.basic, ro.warranty.powertrain, ro.warranty.hybridEv]
    .filter((t): t is TermStatus => Boolean(t?.active))

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <Link href="/advisor" className="text-sm text-neutral-500 hover:underline">← My day</Link>

      <header className="mt-3 flex flex-wrap items-start justify-between gap-4 border-b border-neutral-200 pb-5 dark:border-neutral-800">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-2xl font-bold">RO {ro.roNumber}</h1>
            <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
              {ro.status.replace('_', ' ')}
            </span>
          </div>
          <p className="mt-1 text-lg font-semibold">
            <Link href={`/customers/${ro.customerId}`} className="hover:underline">
              {ro.customerName}
            </Link>
          </p>
          <p className="text-neutral-600 dark:text-neutral-400">
            <Link href={`/vehicles/${ro.vehicleId}`} className="hover:underline">
              {ro.vehicleLabel}
            </Link>
            {ro.mileageIn !== null && (
              <span className="ml-2 tabular-nums text-neutral-500">
                {ro.mileageIn.toLocaleString()} mi in
              </span>
            )}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-neutral-500">Customer owes</p>
          <p className="text-2xl font-bold tabular-nums">{money(ro.totals.customerOwes)}</p>
          {ro.totals.covered > 0 && (
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
              {money(ro.totals.covered)} covered
            </p>
          )}
          <p className="mt-1 text-xs text-neutral-500">opened {shortDate(ro.openedAt)}</p>
        </div>
      </header>

      {activeTerms.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {activeTerms.map((t) => (
            <span
              key={t.name}
              className="rounded bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
            >
              {t.name.replace(' (Bumper-to-Bumper)', '')} active · {t.monthsRemaining ?? '∞'} mo ·{' '}
              {t.milesRemaining?.toLocaleString() ?? '∞'} mi
            </span>
          ))}
        </div>
      )}

      <div className="mt-6 space-y-5">
        {/* ------------------------------------------------------ sell call */}
        <Panel title={`The sell call — ${pending.length} awaiting a decision`}>
          {pending.length === 0 ? (
            <p className="text-sm text-neutral-500">
              Nothing pending. Add what the technician found below.
            </p>
          ) : (
            <>
              <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-400">
                {money(pending.reduce((s, l) => s + l.total, 0))} on the table. Present every item —
                pre-qualifying is how gross gets left behind.
              </p>
              <ul className="space-y-2">
                {pending.map((l) => <PendingLine key={l.id} line={l} />)}
              </ul>
            </>
          )}

          <div className="mt-4 border-t border-neutral-100 pt-4 dark:border-neutral-800">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Add what the tech found
            </p>
            <AddRecommendation repairOrderId={ro.id} opCodes={ro.opCodes} />
          </div>
        </Panel>

        {/* ------------------------------------------------------- approved */}
        <Panel title={`Approved (${approved.length})`}>
          {approved.length === 0 ? (
            <p className="text-sm text-neutral-500">Nothing approved yet.</p>
          ) : (
            <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {approved.map((l) => (
                <li key={l.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="font-medium">{l.description}</p>
                    <p className="text-xs text-neutral-500">
                      {l.payType.replace('_', ' ').toLowerCase()}
                      {l.coverage && l.coverage.payer !== 'CUSTOMER_PAY'
                        ? ` · ${PAYER_LABEL[l.coverage.payer] ?? l.coverage.payer}`
                        : ''}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="tabular-nums">{money(l.customerAmount)}</p>
                    {l.customerAmount < l.total && (
                      <p className="text-xs text-emerald-700 dark:text-emerald-400">
                        {money(l.total - l.customerAmount)} covered
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* ------------------------------------------------------- declined */}
        {declined.length > 0 && (
          <Panel title={`Declined (${declined.length}) — ${money(ro.totals.declined)}`}>
            <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {declined.map((l) => (
                <li key={l.id} className="flex items-baseline justify-between gap-2 py-2">
                  <p className="font-medium text-neutral-600 dark:text-neutral-400">{l.description}</p>
                  <p className="shrink-0 tabular-nums text-neutral-500">{money(l.total)}</p>
                </li>
              ))}
            </ul>
            <p className="mt-3 rounded bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:bg-sky-950 dark:text-sky-200">
              These are now tracked. The BDC worklist will resurface them on the store&rsquo;s
              follow-up cadence, and they appear on this customer&rsquo;s next prep sheet re-priced.
            </p>
          </Panel>
        )}

        {ro.status !== 'CLOSED' && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
            <div>
              <p className="text-sm font-medium">Finished?</p>
              <p className="text-xs text-neutral-500">
                Closing bills the approved lines, records the visit, and updates the customer&rsquo;s
                lifetime totals.
              </p>
            </div>
            <CloseRoButton repairOrderId={ro.id} />
          </div>
        )}
      </div>
    </main>
  )
}
