import Link from 'next/link'
import { notFound } from 'next/navigation'
import { eq, and, desc } from 'drizzle-orm'
import { getDb, schema } from '@/db/client'
import { loadDriveDay } from '@/lib/prep-sheet/load'
import { money } from '../../../records-ui'
import { WriteUpForm, type MenuItem } from './write-up-form'
import { demoNow } from '@/lib/demo-day'
import { requireUser, getCurrentStore } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

const DAY = () => demoNow()

export const metadata = { title: 'Write-up' }

export default async function WriteUpPage({
  params,
}: {
  params: Promise<{ appointmentId: string }>
}) {
  // Enforced here, not only in the middleware. The middleware is a separate
  // deploy artifact on the host, and this page must not serve a dealership
  // to an anonymous request even if it never runs.
  await requireUser()
  const { appointmentId } = await params
  const store = await getCurrentStore()
  if (!store) notFound()

  const db = getDb()
  const sheets = await loadDriveDay(store.id, DAY(), DAY())
  const sheet = sheets.find((s) => s.appointment?.id === appointmentId)
  if (!sheet) notFound()

  const opCodes = await db.select().from(schema.opCodes).where(and(
    eq(schema.opCodes.storeId, store.id),
    eq(schema.opCodes.isActive, true),
  ))

  /**
   * Preselect what the prep sheet already found.
   *
   * The advisor still sees the whole menu — the point is to make presenting
   * everything the default, not to narrow it.
   */
  const suggestionByGroup = new Map<string, string>()
  for (const o of sheet.opportunities) {
    if (!o.componentGroupKey) continue
    if (suggestionByGroup.has(o.componentGroupKey)) continue
    suggestionByGroup.set(
      o.componentGroupKey,
      o.likelyPayer === 'CUSTOMER_PAY'
        ? o.detail
        : `${o.detail} — likely covered, customer pays ${money(o.customerOutOfPocket)}`,
    )
  }

  const menu: MenuItem[] = opCodes.map((o) => ({
    id: o.id,
    code: o.code,
    description: o.description,
    laborAmount: Number(o.laborAmount ?? 0),
    partsAmount: Number(o.partsAmount ?? 0),
    isMaintenance: o.isMaintenance,
    suggested: o.componentGroupKey ? suggestionByGroup.get(o.componentGroupKey) : undefined,
  }))

  const suggestedOpCodeIds = menu.filter((m) => m.suggested).map((m) => m.id)

  /**
   * The newest actual reading, for the odometer warning.
   *
   * Deliberately not `sheet.projectedMileage` — that is an estimate, and the
   * form is already prefilled with it. Warning that an entry falls below a
   * projection would fire on most of the drive and mean nothing.
   */
  const [lastReadingRow] = await db.select({
    mileage: schema.mileageReadings.mileage,
    recordedAt: schema.mileageReadings.recordedAt,
    source: schema.mileageReadings.source,
  })
    .from(schema.mileageReadings)
    .where(eq(schema.mileageReadings.vehicleId, sheet.vehicle.id))
    .orderBy(desc(schema.mileageReadings.recordedAt), desc(schema.mileageReadings.mileage))
    .limit(1)

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <Link href="/advisor" className="text-sm text-neutral-500 hover:underline">
        ← My day
      </Link>

      <header className="mt-3 flex flex-wrap items-start justify-between gap-4 border-b border-neutral-200 pb-5 dark:border-neutral-800">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-neutral-500">Write-up</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">{sheet.customer.name}</h1>
          <p className="mt-1 text-lg text-neutral-700 dark:text-neutral-300">
            {sheet.vehicle.modelYear} {sheet.vehicle.make} {sheet.vehicle.model}
          </p>
          <p className="font-mono text-xs text-neutral-500">{sheet.vehicle.vin}</p>
        </div>
        <div className="text-right text-sm">
          <p className="text-neutral-500">
            {sheet.customer.visitCount} visits · {money(sheet.customer.lifetimeSpend)} lifetime
          </p>
          <Link
            href={`/drive/${appointmentId}`}
            className="mt-1 inline-block rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium transition hover:border-neutral-900 dark:border-neutral-700 dark:hover:border-neutral-300"
          >
            Full prep sheet
          </Link>
        </div>
      </header>

      {sheet.alerts.length > 0 && (
        <div className="mt-5 rounded-lg border border-rose-300 bg-rose-50 p-3 dark:border-rose-800 dark:bg-rose-950">
          <ul className="space-y-1">
            {sheet.alerts.map((a, i) => (
              <li key={i} className="text-sm font-medium text-rose-900 dark:text-rose-200">{a}</li>
            ))}
          </ul>
        </div>
      )}

      {sheet.opportunities.length > 0 && (
        <div className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
          <h2 className="text-xs font-bold uppercase tracking-widest text-amber-900 dark:text-amber-200">
            Before you start — {money(sheet.totals.opportunityValue)} outstanding
          </h2>
          <ul className="mt-2 space-y-1">
            {sheet.opportunities.slice(0, 4).map((o) => (
              <li key={o.id} className="text-sm text-amber-950 dark:text-amber-100">
                <span className="font-semibold">{o.title}</span>
                {o.customerOutOfPocket === 0 && o.estimatedAmount > 0 && (
                  <span className="ml-1 font-medium">— covered, customer pays nothing</span>
                )}
                <span className="ml-1 opacity-80">{o.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6">
        <WriteUpForm
          appointmentId={appointmentId}
          defaultMileage={sheet.projectedMileage}
          defaultConcerns={sheet.appointment?.concerns ?? ''}
          menu={menu}
          suggestedOpCodeIds={suggestedOpCodeIds}
          lastReading={lastReadingRow ? {
            mileage: lastReadingRow.mileage,
            recordedAt: lastReadingRow.recordedAt.toISOString(),
            source: lastReadingRow.source,
          } : null}
        />
      </div>
    </main>
  )
}
