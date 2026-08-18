import Link from 'next/link'
import { notFound } from 'next/navigation'
import { loadDriveDay } from '@/lib/prep-sheet/load'
import { firstServiceCue } from '@/lib/prep-sheet'
import { vinLastSix } from '@/lib/prep-sheet/presentation'
import { fenceSales } from '@/lib/auth/sales'
import { loadVisitCard } from '@/lib/timeline/load'
import { VisitCardStrip } from '@/components/timeline/visit-card'
import { PrepSheetView } from '@/components/prep-sheet/prep-sheet-view'
import { demoNow } from '@/lib/demo-day'
import { requireUser, getCurrentStore } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

const DAY = () => demoNow()

export async function generateMetadata({
  params,
}: {
  params: Promise<{ appointmentId: string }>
}) {
  const { appointmentId } = await params
  const store = await getCurrentStore()
  if (!store) return { title: 'Prep Sheet' }
  const sheets = await loadDriveDay(store.id, DAY(), DAY())
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
  // Enforced here, not only in the middleware. The middleware is a separate
  // deploy artifact on the host, and this page must not serve a dealership
  // to an anonymous request even if it never runs.
  const user = await requireUser()
  // A salesperson has one page and this is not it (DRIVE_PLAN §9 Q2).
  fenceSales(user.role)
  const { appointmentId } = await params
  const store = await getCurrentStore()
  if (!store) notFound()

  const sheets = await loadDriveDay(store.id, DAY(), DAY())
  const sheet = sheets.find((s) => s.appointment?.id === appointmentId)
  if (!sheet) notFound()

  const firstService = firstServiceCue(sheet, DAY())

  /*
    The compressed relationship card — DRIVE_PLAN D6.

    Scoped to this car and deliberately the cheap loader: six queries rather
    than the record page's fourteen, because this is the drive and the advisor
    is walking. It renders nothing when there is nothing to say, which is the
    ordinary case for a first-service customer and is why this and the emerald
    cue below do not fight each other.
  */
  const visitCard = await loadVisitCard(store.id, sheet.vehicle.id, DAY())

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

      {/*
        Above the alerts, and a different colour on purpose.

        The alerts panel is rose because everything in it is bad news — a
        do-not-drive recall, a contradicted odometer. This is the opposite kind
        of fact and putting it in the same red box would teach the advisor to
        read "first service" as a warning. Emerald, and it leads because it
        changes how the greeting starts rather than what gets quoted.
      */}
      {firstService && (
        <div className="mt-4 rounded-2xl border-2 border-emerald-400 bg-emerald-50 p-4 dark:border-emerald-700 dark:bg-emerald-950">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="text-sm font-bold uppercase tracking-wide text-emerald-900 dark:text-emerald-200">
              {firstService.label}
            </p>
            {firstService.attribution && (
              <p className="text-sm text-emerald-900/80 dark:text-emerald-200/80">
                {firstService.attribution}
              </p>
            )}
          </div>
          {firstService.notes.length > 0 && (
            <ul className="mt-2 space-y-1">
              {firstService.notes.map((n) => (
                <li key={n} className="text-sm text-emerald-900 dark:text-emerald-200">
                  {n}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

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

      {/*
        Below both boxes and above the list, one line tall.

        The cue above changes how the greeting starts and the alerts above it
        are things that must not be missed; this is context, and context does
        not outrank either. It sits directly on top of the ranked opportunities
        because that is where an advisor's eye already is — and it is a strip
        rather than a panel precisely so it does not push the first
        opportunity down.
      */}
      <VisitCardStrip card={visitCard} recordHref={`/customers/${sheet.customer.id}`} />

      <div className="mt-4">
        <PrepSheetView sheet={sheet} />
      </div>
    </main>
  )
}
