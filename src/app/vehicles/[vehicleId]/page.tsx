import Link from 'next/link'
import { notFound } from 'next/navigation'
import { loadVehicleRecord } from '@/lib/records/vehicle'
import { WearPanel } from '@/components/wear/wear-panel'
import type { TermStatus } from '@/lib/warranty'
import type { WearPrediction } from '@/lib/prep-sheet'
import { Empty, money, Panel, shortDate, Stat } from '../../records-ui'
import { demoNow } from '@/lib/demo-day'
import { requireUser, getCurrentStore } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

/** The seeded dealership lives on a fixed date so the demo is stable. */
const AS_OF = () => demoNow()

export async function generateMetadata({
  params,
}: {
  params: Promise<{ vehicleId: string }>
}) {
  const { vehicleId } = await params
  const user = await requireUser()
  const store = await getCurrentStore()
  if (!store) return { title: 'Vehicle' }
  const record = await loadVehicleRecord(user.id, store.id, vehicleId, AS_OF())
  return { title: record ? `${record.label}` : 'Vehicle' }
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

function WearSummary({
  label,
  unit,
  prediction,
  position,
}: {
  label: string
  unit: string
  prediction: WearPrediction
  position?: string
}) {
  const tone = prediction.isCritical
    ? 'text-rose-700 dark:text-rose-400'
    : prediction.isAtSellThreshold
      ? 'text-amber-700 dark:text-amber-400'
      : 'text-emerald-700 dark:text-emerald-400'

  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">
          {label}
          {position && <span className="ml-1 text-xs text-neutral-500">worst: {position}</span>}
        </span>
        <span className={`text-lg font-bold tabular-nums ${tone}`}>
          {prediction.currentValue}
          {unit}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-neutral-500">
        {prediction.ratePerThousandMiles > 0
          ? `Wearing ${prediction.ratePerThousandMiles}${unit} per 1,000 miles across ${prediction.readingCount} inspections.`
          : `${prediction.readingCount} inspection${prediction.readingCount === 1 ? '' : 's'} — not enough to project a rate.`}
      </p>
      {prediction.milesUntilSellThreshold !== null && prediction.milesUntilSellThreshold > 0 && (
        <p className="mt-0.5 text-xs">
          <span className="font-medium">
            {prediction.milesUntilSellThreshold.toLocaleString()} miles
          </span>
          {prediction.daysUntilSellThreshold !== null && (
            <span className="text-neutral-500">
              {' '}(about {prediction.daysUntilSellThreshold} days)
            </span>
          )}
          <span className="text-neutral-500"> until replacement</span>
        </p>
      )}
      {prediction.isCritical && (
        <p className="mt-1 rounded bg-rose-50 px-2 py-1 text-xs font-medium text-rose-800 dark:bg-rose-950 dark:text-rose-200">
          At or below the safety minimum. This is a safety conversation, not a sale.
        </p>
      )}
    </div>
  )
}

export default async function VehiclePage({
  params,
}: {
  params: Promise<{ vehicleId: string }>
}) {
  // Enforced here, not only in the middleware. The middleware is a separate
  // deploy artifact on the host, and this page must not serve a dealership
  // to an anonymous request even if it never runs.
  const user = await requireUser()
  const { vehicleId } = await params
  const store = await getCurrentStore()
  if (!store) notFound()

  const v = await loadVehicleRecord(user.id, store.id, vehicleId, AS_OF())
  if (!v) notFound()

  const terms = [v.warranty.basic, v.warranty.powertrain, v.warranty.emissionsLong,
    v.warranty.hybridEv, v.warranty.corrosion]
    .filter((t): t is TermStatus => Boolean(t))

  const openDeclineValue = v.openDeclines.reduce((s, d) => s + d.quotedAmount, 0)
  const lifetimeService = v.serviceHistory.reduce((s, r) => s + r.customerPayTotal, 0)

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      {v.owner ? (
        <Link href={`/customers/${v.owner.id}`} className="text-sm text-neutral-500 hover:underline">
          ← {v.owner.name}
        </Link>
      ) : (
        <Link href="/customers" className="text-sm text-neutral-500 hover:underline">← Customers</Link>
      )}

      <header className="mt-3 flex flex-wrap items-start justify-between gap-4 border-b border-neutral-200 pb-5 dark:border-neutral-800">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{v.label}</h1>
          <p className="mt-1 font-mono text-sm text-neutral-500">
            {v.vin}
            {!v.vinValid && (
              <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                check digit failed
              </span>
            )}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
            {/* Joined explicitly rather than relying on flex gap: any of these
                can be null, and adjacent values ran together as "BCD5837Gasoline". */}
            <span>
              {[v.licensePlate, v.trim, v.bodyClass, v.fuelType].filter(Boolean).join(' · ') || '—'}
            </span>
            {v.isHybridOrEv && (
              <span className="rounded bg-sky-100 px-1.5 py-0.5 text-xs font-medium text-sky-800 dark:bg-sky-950 dark:text-sky-200">
                Hybrid / EV
              </span>
            )}
          </div>
        </div>
        <dl className="flex gap-6">
          <Stat label="Odometer" value={v.currentMileage?.toLocaleString() ?? '—'} />
          <Stat label="Miles/day" value={v.avgMilesPerDay?.toFixed(0) ?? '—'} />
          <Stat label="Service spend" value={money(lifetimeService)} />
        </dl>
      </header>

      {v.recalls.some((r) => r.parkIt) && (
        <div className="mt-5 rounded-lg border border-rose-300 bg-rose-50 p-3 dark:border-rose-800 dark:bg-rose-950">
          <p className="text-sm font-bold text-rose-900 dark:text-rose-200">
            DO NOT DRIVE advisory on an open campaign. Arrange transport before releasing.
          </p>
        </div>
      )}

      {/*
        Says which odometer this page is reasoning from when that is not the one
        on the vehicle row. Every warranty figure below is computed from it, so
        correcting it silently would leave the page confidently telling someone
        about coverage they may not have.
      */}
      {v.odometerNote && (
        <div className="mt-5 rounded-lg border border-amber-400 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950">
          <p className="text-xs font-bold uppercase tracking-widest text-amber-900 dark:text-amber-200">
            Odometer on the vehicle record disagrees with its own history
          </p>
          <p className="mt-1 text-sm text-amber-950 dark:text-amber-100">{v.odometerNote}</p>
        </div>
      )}

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          <Panel title="Wear trends">
            {!v.wear.tires && !v.wear.brakes ? (
              <Empty>No inspection measurements recorded yet.</Empty>
            ) : (
              <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {v.wear.tires && (
                  <WearSummary
                    label="Tire tread"
                    unit="/32&quot;"
                    prediction={v.wear.tires.prediction}
                    position={v.wear.tires.position}
                  />
                )}
                {v.wear.brakes && (
                  <WearSummary label="Front brake pads" unit="mm" prediction={v.wear.brakes} />
                )}
              </div>
            )}

            {/* The chart is the persuasive version of the table below it. */}
            <WearPanel
              history={v.inspectionHistory}
              avgMilesPerDay={v.avgMilesPerDay}
              vehicleLabel={v.label}
              customerName={v.owner?.name}
              asOf={AS_OF()}
            />
            {v.wear.treadSeries.length > 1 && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-neutral-500">
                      <th className="pb-1 pr-4 font-medium">Mileage</th>
                      <th className="pb-1 pr-4 font-medium">Date</th>
                      {['LF', 'RF', 'LR', 'RR'].map((p) => (
                        <th key={p} className="pb-1 pr-3 font-medium">{p}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                    {v.wear.treadSeries.map((s) => (
                      <tr key={s.mileage}>
                        <td className="py-1 pr-4 tabular-nums">{s.mileage.toLocaleString()}</td>
                        <td className="py-1 pr-4 text-neutral-500">{shortDate(s.recordedAt)}</td>
                        {['LF', 'RF', 'LR', 'RR'].map((p) => {
                          const value = s.byPosition[p]
                          return (
                            <td
                              key={p}
                              className={`py-1 pr-3 tabular-nums ${
                                value !== undefined && value <= 2 ? 'font-bold text-rose-600'
                                : value !== undefined && value <= 4 ? 'font-medium text-amber-600'
                                : ''
                              }`}
                            >
                              {value ?? '—'}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-neutral-500">
                  Tread in 32nds. Every visit adds a point — two give a slope, three give a trend.
                </p>
              </div>
            )}
          </Panel>

          <Panel title={`Service history (${v.serviceHistory.length})`}>
            {v.serviceHistory.length === 0 ? (
              <Empty>No repair orders yet.</Empty>
            ) : (
              <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {v.serviceHistory.map((ro) => (
                  <li key={ro.id} className="py-2">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-sm">
                        <span className="font-mono font-medium">RO {ro.roNumber}</span>
                        <span className="ml-2 text-neutral-500">{shortDate(ro.openedAt)}</span>
                        {ro.mileageIn !== null && (
                          <span className="ml-2 tabular-nums text-neutral-500">
                            {ro.mileageIn.toLocaleString()} mi
                          </span>
                        )}
                      </p>
                      <span className="shrink-0 tabular-nums">{money(ro.customerPayTotal)}</span>
                    </div>
                    {ro.lines.length > 0 && (
                      <p className="mt-0.5 text-xs text-neutral-500">
                        {ro.lines.map((l) => l.description).join(' · ')}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {v.openDeclines.length > 0 && (
            <Panel title={`Open declined work — ${money(openDeclineValue)}`}>
              <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {v.openDeclines.map((d) => (
                  <li key={d.id} className="flex items-baseline justify-between gap-3 py-2">
                    <div>
                      <p className="font-medium">{d.description}</p>
                      <p className="text-xs text-neutral-500">
                        {shortDate(d.declinedAt)}
                        {d.mileageAtDecline !== null ? ` at ${d.mileageAtDecline.toLocaleString()} mi` : ''}
                      </p>
                    </div>
                    <span className="shrink-0 font-bold tabular-nums">{money(d.quotedAmount)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>

        <aside className="space-y-5">
          <Panel title="Coverage stack">
            <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {terms.map((t) => <TermBar key={t.name} term={t} />)}
            </div>
            {!v.warranty.known && (
              <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                No reference data for {v.make}. Verify in the OEM portal.
              </p>
            )}
            <dl className="mt-3 space-y-1 border-t border-neutral-100 pt-3 text-sm dark:border-neutral-800">
              <div className="flex justify-between gap-2">
                <dt className="text-neutral-500">In service</dt>
                <dd className="font-medium">{shortDate(v.inServiceDate)}</dd>
              </div>
              {v.owner && (
                <div className="flex justify-between gap-2">
                  <dt className="text-neutral-500">Owner</dt>
                  <dd className="font-medium">
                    {v.owner.isOriginalOwner ? 'Original' : 'Subsequent'}
                  </dd>
                </div>
              )}
            </dl>
            {v.owner && !v.owner.isOriginalOwner && (
              <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                Not the original owner — some brands cut powertrain coverage sharply for a second
                owner.
              </p>
            )}
          </Panel>

          <Panel title={`Contracts (${v.contracts.length})`}>
            {v.contracts.length === 0 ? (
              <Empty>No F&amp;I products on file.</Empty>
            ) : (
              <ul className="space-y-3">
                {v.contracts.map((c) => (
                  <li key={c.id} className="text-sm">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium">{c.adminCompany}</span>
                      <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                        {c.productType.replace('_', ' ')}
                      </span>
                    </div>
                    <p className="text-xs text-neutral-500">
                      {c.coverageTier ? `${c.coverageTier} · ` : ''}
                      {c.tierType === 'EXCLUSIONARY' ? 'exclusionary' : 'named component'}
                      {c.deductibleAmount > 0 ? ` · ${money(c.deductibleAmount)} deductible` : ' · no deductible'}
                    </p>
                    <p className="text-xs text-neutral-500">
                      {c.termMonths ? `${c.termMonths} mo` : ''}
                      {c.termMiles ? ` / ${c.termMiles.toLocaleString()} mi` : ''}
                      {c.contractNumber ? ` · ${c.contractNumber}` : ''}
                    </p>
                    {c.requiresPriorAuthorization && (
                      <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                        Prior authorization required{c.claimPhone ? ` — ${c.claimPhone}` : ''}
                      </p>
                    )}
                    {c.source === 'PDF_EXTRACTION' && !c.verifiedAt && (
                      <p className="mt-1 text-xs font-medium text-rose-700 dark:text-rose-400">
                        Read from a document, not yet verified by a human.
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {v.entitlements.length > 0 && (
            <Panel title="Prepaid maintenance">
              <ul className="space-y-2 text-sm">
                {v.entitlements.map((e) => (
                  <li key={e.label} className="flex items-baseline justify-between gap-2">
                    <span>{e.label}</span>
                    <span className="text-right">
                      <span className={e.remaining > 0 ? 'font-bold' : 'text-neutral-400'}>
                        {e.remaining} of {e.totalAllowed}
                      </span>
                      {e.expiresOn && (
                        <span className="block text-xs text-neutral-500">
                          expires {shortDate(e.expiresOn)}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {v.recalls.length > 0 && (
            <Panel title={`Recalls (${v.recalls.length})`}>
              <ul className="space-y-2 text-sm">
                {v.recalls.map((r) => (
                  <li key={r.campaignNumber}>
                    <span className="font-mono text-xs font-medium">{r.campaignNumber}</span>
                    {r.isCandidate && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                        verify
                      </span>
                    )}
                    <p className="text-xs text-neutral-500">{r.component}</p>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-neutral-500">
                NHTSA publishes by make/model/year, not by VIN. Confirm in the OEM portal before
                telling a customer anything is open.
              </p>
            </Panel>
          )}
        </aside>
      </div>
    </main>
  )
}
