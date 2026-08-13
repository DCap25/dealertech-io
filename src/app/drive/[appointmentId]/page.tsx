import Link from 'next/link'
import { notFound } from 'next/navigation'
import { loadDriveDay, getDefaultStore } from '@/lib/prep-sheet/load'
import { vinLastSix } from '@/lib/prep-sheet/presentation'
import { PrepSheetView } from '@/components/prep-sheet/prep-sheet-view'

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

function timeOf(d: Date): string {
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago',
  })
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

  return (
    <main className="mx-auto max-w-5xl px-4 py-5 sm:px-6 sm:py-8">
      <Link
        href="/drive"
        className="touch-target inline-flex items-center text-sm text-neutral-500 hover:underline"
      >
        ← Today&rsquo;s drive
      </Link>

      {/* Identity stays a server component — it never changes as the advisor
          works the list, so there is no reason to ship it to the client. */}
      <header className="mt-2 border-b border-[var(--border)] pb-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
              {sheet.customer.name}
            </h1>
            <p className="mt-1 text-lg text-neutral-700 dark:text-neutral-300 sm:text-xl">
              {sheet.vehicle.modelYear} {sheet.vehicle.make} {sheet.vehicle.model}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-neutral-500">
              <span className="font-mono">…{vinLastSix(sheet.vehicle.vin)}</span>
              <span className="tabular-nums">
                {sheet.projectedMileage.toLocaleString()} mi at arrival
              </span>
              <Link href={`/vehicles/${sheet.vehicle.id}`} className="underline hover:text-neutral-900 dark:hover:text-white">
                Vehicle history
              </Link>
            </div>
          </div>

          <div className="text-right">
            <p className="text-2xl font-bold tabular-nums sm:text-3xl">
              {sheet.appointment && timeOf(sheet.appointment.scheduledAt)}
            </p>
            <p className="text-sm text-neutral-500">
              {sheet.appointment?.transportType.replace('_', ' ').toLowerCase()}
              {sheet.appointment?.advisorName ? ` · ${sheet.appointment.advisorName}` : ''}
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              {sheet.customer.visitCount} visits · $
              {sheet.customer.lifetimeSpend.toLocaleString()} lifetime
            </p>
          </div>
        </div>

        {sheet.appointment?.concerns && (
          <p className="mt-3 rounded-xl bg-[var(--surface-muted)] px-4 py-3 text-base">
            <span className="text-xs font-bold uppercase tracking-wide text-neutral-500">
              Their words:
            </span>{' '}
            {sheet.appointment.concerns}
          </p>
        )}
      </header>

      {sheet.alerts.length > 0 && (
        <div className="mt-4 rounded-2xl border-2 border-rose-400 bg-rose-50 p-4 dark:border-rose-700 dark:bg-rose-950">
          <ul className="space-y-1.5">
            {sheet.alerts.map((a, i) => (
              <li key={i} className="text-sm font-semibold text-rose-900 dark:text-rose-200">
                {a}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4">
        <PrepSheetView sheet={sheet} />
      </div>
    </main>
  )
}
