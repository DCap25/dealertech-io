import Link from 'next/link'
import { and, desc, eq } from 'drizzle-orm'
import { schema } from '@/db/client'
import { withCurrentUserScope } from '@/db/scoped'
import { WorkspaceNav } from '@/components/auth/workspace-nav'
import { requireUser, getCurrentStore } from '@/lib/auth/session'
import { demoNow } from '@/lib/demo-day'
import { getDmsAdapter } from '@/lib/dms/registry'
import { loadCustomerRecord, searchCustomers } from '@/lib/records/customer'
import { bookLoad, dayRulesFor, firstServiceDefault, slotsForDay, waiterLoad } from '@/lib/scheduling'
import {
  loadAdvisorsOnDuty, loadDayBook, loadMaintenanceIntervals, loadSchedulingRules,
} from '@/lib/scheduling/store-rules'
import { dayKey } from '@/lib/drive/week'
import { IntroduceForm } from './introduce-form'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Introduce a customer to service' }

/**
 * The delivery introduction — DRIVE_PLAN D5, and the whole of the SALES role's
 * surface.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS PAGE EXISTS AT ALL
 * ---------------------------------------------------------------------------
 * The highest-leverage retention moment a dealership owns is delivery. The
 * customer is standing in the building, happy, keys in hand. A walk to the
 * service drive, a named advisor shaking their hand, and the first maintenance
 * visit already on the calendar is what converts a sales customer into a
 * service customer — and the first service visit is the strongest single
 * predictor of whether the store ever sees the car again.
 *
 * So the job of this page is not to be capable. It is to be *easier than not
 * doing it*: the date is already filled in from the maintenance schedule, the
 * slot grid is painted, and the only things anyone has to type are the name and
 * the VIN off the buyer's order.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS THIS SMALL
 * ---------------------------------------------------------------------------
 * One page, one workflow. Sales-side CRM — desking, ups, deals — stays out on
 * purpose (D5, "what deliberately stays out"), and the SALES role is fenced to
 * this route by src/lib/auth/sales.ts. Everything that decides is the same pure
 * scheduling engine the drive's own booking screen renders over, and the write
 * goes through the same action; the difference is what gets recorded, not how
 * the appointment is chosen.
 *
 * Advisors and managers can open it too. It is not a sales-only page, it is a
 * sales-*shaped* page — a service manager covering the desk on a Saturday
 * should not have to route a delivery through a different screen.
 */
export default async function IntroducePage({
  searchParams,
}: {
  searchParams: Promise<{
    date?: string
    advisor?: string
    customerId?: string
    make?: string
    q?: string
  }>
}) {
  // Enforced here, not only in the middleware — same reasoning as /drive.
  const user = await requireUser()
  const params = await searchParams
  const store = await getCurrentStore()

  if (!store) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="text-xl font-bold">No store found</h1>
      </main>
    )
  }

  const today = demoNow()

  /*
    The make is in the URL for the same reason the day is: the interval that
    decides the default date depends on it, and the server is what reads
    `maintenance_schedules`. A dropdown that changed the date in the browser
    would be a second copy of that decision that can drift from the one the
    booking is actually made against.

    Defaulted to the rooftop's franchise, which is the car being delivered on a
    franchise floor almost every time.
  */
  const make = (params.make || store.franchiseMake || '').toUpperCase()

  const rules = await loadSchedulingRules(store.id)
  const schedules = make ? await loadMaintenanceIntervals(store.id, make) : []

  /*
    The date the form opens on.

    Model year is this year: the car is being handed over today, so if the
    schedule rows are bounded by model year, "the current one" is the right
    bucket and the only one we could honestly guess before a VIN is typed.
  */
  const suggested = firstServiceDefault({
    from: today,
    make,
    modelYear: today.getFullYear(),
    schedules,
    isOpen: (d) => dayRulesFor(rules, d) !== null,
  })

  const day = params.date ? new Date(`${params.date}T12:00:00`) : suggested.date
  const dateValue = dayKey(day)

  const advisors = await loadAdvisorsOnDuty(store.id)
  const dayBook = await loadDayBook(store.id, day)

  const slots = slotsForDay(rules, day)
  const dayRules = dayRulesFor(rules, day)
  const introducedAdvisorId = advisors.some((a) => a.advisorId === params.advisor)
    ? params.advisor!
    : ''

  const advisorLoad = introducedAdvisorId ? bookLoad(slots, dayBook, introducedAdvisorId) : null
  const waiters = waiterLoad(slots, dayBook)
  const advisorName = advisors.find((a) => a.advisorId === introducedAdvisorId)?.name ?? null

  const customer = params.customerId
    ? await loadCustomerRecord(store.id, params.customerId)
    : null
  // Only while nobody is chosen — once a customer is on the form the list
  // underneath it is noise.
  const matches = !customer && params.q ? await searchCustomers(store.id, params.q, 8) : []

  /*
    What this person has already walked over.

    The payoff for the attribution the schema carries (`sold_by_user_id`): a
    salesperson can see that this morning's three deliveries are all on the
    calendar, which is the only feedback the workflow gives them. Scoped and
    narrow — five rows, their own bookings.
  */
  const mine = await withCurrentUserScope((db) => db
    .select({
      id: schema.appointments.id,
      scheduledAt: schema.appointments.scheduledAt,
      customerId: schema.appointments.customerId,
      advisorId: schema.appointments.advisorId,
    })
    .from(schema.appointments)
    .where(and(
      eq(schema.appointments.storeId, store.id),
      eq(schema.appointments.soldByUserId, user.id),
    ))
    .orderBy(desc(schema.appointments.createdAt))
    .limit(5))

  const advisorNameById = new Map(advisors.map((a) => [a.advisorId, a.name]))

  const keep = (patch: Record<string, string | undefined>) => {
    const q = new URLSearchParams()
    const merged = {
      date: params.date, advisor: params.advisor, customerId: params.customerId,
      make: params.make, q: params.q, ...patch,
    }
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v)
    const s = q.toString()
    return s ? `/introduce?${s}` : '/introduce'
  }

  const stepDay = (delta: number) => {
    const d = new Date(day)
    d.setDate(d.getDate() + delta)
    return dayKey(d)
  }

  const dmsVendor = getDmsAdapter().capabilities.vendor
  const dmsPushes = getDmsAdapter().capabilities.canPushAppointment

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <p className="text-xs font-bold uppercase tracking-widest text-neutral-500">
            {store.name} · Delivery
          </p>
          <WorkspaceNav current="introduce" />
        </div>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Introduce a customer to service</h1>
        <p className="mt-1 text-neutral-600 dark:text-neutral-400">
          Walk them over, put a name to a face, and leave with the first service booked.
        </p>
      </header>

      {/* ------------------------------------------------------- customer */}
      <section className="mb-6 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
        <h2 className="text-xs font-bold uppercase tracking-wide text-neutral-500">Customer</h2>

        {customer ? (
          <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <p className="text-lg font-semibold">{customer.name}</p>
              <p className="text-sm text-neutral-500">
                {customer.mobilePhone ?? 'No number on file'} · {customer.visitCount} service visit
                {customer.visitCount === 1 ? '' : 's'}
              </p>
            </div>
            <Link href={keep({ customerId: undefined })} className="text-sm font-semibold hover:underline">
              Change
            </Link>
          </div>
        ) : (
          <>
            {/* A plain GET form, so a half-filled introduction is a link. */}
            <form action="/introduce" method="get" className="mt-2">
              {(['date', 'advisor', 'make'] as const).map((k) =>
                params[k] ? <input key={k} type="hidden" name={k} value={params[k]} /> : null,
              )}
              <input
                type="search"
                name="q"
                defaultValue={params.q ?? ''}
                placeholder="Have they bought here before? Name, phone or email…"
                className="w-full rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-300"
              />
            </form>

            {matches.length > 0 && (
              <ul className="mt-2 divide-y divide-neutral-100 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
                {matches.map((m) => (
                  <li key={m.id}>
                    <Link href={keep({ customerId: m.id, q: undefined })} className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-900">
                      <span className="font-semibold">{m.name}</span>
                      <span className="truncate text-xs text-neutral-500">
                        {m.mobilePhone ?? '—'}{m.vehicleSummary ? ` · ${m.vehicleSummary}` : ''}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            <p className="mt-2 text-sm text-neutral-500">
              {params.q && matches.length === 0
                ? `Nobody matches “${params.q}” — a first-time buyer, then. Fill in their details below.`
                : 'Most deliveries are new to us. Search only if they have bought or serviced here before.'}
            </p>
          </>
        )}
      </section>

      {/* ----------------------------------------------------------- day */}
      <section className="mb-6 flex flex-wrap items-center gap-2">
        <Link href={keep({ date: stepDay(-1) })} className="rounded-lg border border-neutral-200 px-2.5 py-1.5 text-sm font-semibold dark:border-neutral-800" aria-label="Previous day">←</Link>
        <Link href={keep({ date: undefined })} className="rounded-lg border border-neutral-200 px-2.5 py-1.5 text-sm font-semibold dark:border-neutral-800">
          Suggested day
        </Link>
        <Link href={keep({ date: stepDay(1) })} className="rounded-lg border border-neutral-200 px-2.5 py-1.5 text-sm font-semibold dark:border-neutral-800" aria-label="Next day">→</Link>

        <div className="ml-auto flex flex-wrap items-center gap-1 text-sm">
          <span className="text-neutral-500">Introduce to:</span>
          <Link
            href={keep({ advisor: undefined })}
            className={`rounded-lg border px-2.5 py-1.5 font-semibold ${!introducedAdvisorId ? 'border-neutral-900 dark:border-neutral-300' : 'border-neutral-200 dark:border-neutral-800'}`}
          >
            Nobody yet
          </Link>
          {advisors.map((a) => (
            <Link
              key={a.advisorId}
              href={keep({ advisor: a.advisorId })}
              className={`rounded-lg border px-2.5 py-1.5 font-semibold ${introducedAdvisorId === a.advisorId ? 'border-neutral-900 dark:border-neutral-300' : 'border-neutral-200 dark:border-neutral-800'}`}
            >
              {a.name.split(' ')[0]}
            </Link>
          ))}
        </div>
      </section>

      <IntroduceForm
        date={dateValue}
        dateLabel={day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        /*
          Said in the store's own words, and honest about whose number it is.
          "Your Ford schedule says 7,500 miles" and "we assumed six months" are
          different claims and only one of them is the dealership's.
        */
        dateReason={
          params.date
            ? null
            : suggested.basis === 'SCHEDULE'
              ? `${suggested.description ?? 'The maintenance schedule'} for ${make} — every ${suggested.months} months${suggested.miles ? ` or ${suggested.miles.toLocaleString()} miles` : ''}.`
              : `No maintenance schedule on file for ${make || 'this make'}, so this is the usual ${suggested.months} months / ${suggested.miles?.toLocaleString()} miles. Move it if your schedule says otherwise.`
        }
        slots={slots.map((s) => {
          const key = s.start.getTime()
          const theirs = advisorLoad?.perSlot.get(key) ?? 0
          const waiting = waiters.get(key) ?? 0
          const notes: string[] = []
          if (introducedAdvisorId && dayRules) {
            notes.push(`${advisorName?.split(' ')[0]} ${theirs}/${dayRules.maxPerAdvisorSlot}`)
          }
          if (waiting > 0 && dayRules) notes.push(`${waiting}/${dayRules.maxWaitersPerSlot} waiting`)
          return {
            value: `${String(s.start.getHours()).padStart(2, '0')}:${String(s.start.getMinutes()).padStart(2, '0')}`,
            label: s.label,
            note: notes.join(' · '),
            // Painted, never disabled — capacity warns, it does not block (D3).
            tight: dayRules
              ? (introducedAdvisorId ? theirs >= dayRules.maxPerAdvisorSlot : false)
                || waiting >= dayRules.maxWaitersPerSlot
              : false,
          }
        })}
        closedMessage={
          dayRules
            ? null
            : `${store.name} is closed on ${day.toLocaleDateString('en-US', { weekday: 'long' })}. Step to the next day.`
        }
        advisors={advisors.map((a) => ({ id: a.advisorId, name: a.name }))}
        introducedAdvisorId={introducedAdvisorId}
        customer={customer ? { id: customer.id, name: customer.name } : null}
        knownVehicles={customer?.vehicles.map((v) => ({ id: v.id, label: v.label })) ?? []}
        defaultMake={make}
        defaultModelYear={String(today.getFullYear())}
      />

      {mine.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs font-bold uppercase tracking-wide text-neutral-500">
            Your introductions
          </h2>
          <ul className="mt-2 divide-y divide-neutral-100 rounded-xl border border-neutral-200 text-sm dark:divide-neutral-800 dark:border-neutral-800">
            {mine.map((m) => (
              <li key={m.id} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2">
                <span className="font-medium tabular-nums">
                  {m.scheduledAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  {' · '}
                  {m.scheduledAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                </span>
                <span className="text-xs text-neutral-500">
                  {m.advisorId
                    ? `with ${advisorNameById.get(m.advisorId) ?? 'an advisor'}`
                    : 'advisor decided at arrival'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-6 text-xs leading-relaxed text-neutral-500">
        {dmsPushes
          ? `Bookings are written through to ${dmsVendor}.`
          : `This appointment lives in DealerTech. ${dmsVendor} does not see it until the visit is handed off at write-up.`}
      </p>
    </main>
  )
}
