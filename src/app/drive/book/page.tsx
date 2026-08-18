import Link from 'next/link'
import { WorkspaceNav } from '@/components/auth/workspace-nav'
import { requireUser, getCurrentStore } from '@/lib/auth/session'
import { canManageStaff } from '@/lib/team/roster'
import { demoNow } from '@/lib/demo-day'
import { getDmsAdapter } from '@/lib/dms/registry'
import { loadCustomerRecord, searchCustomers } from '@/lib/records/customer'
import { bookLoad, dayRulesFor, slotsForDay, waiterLoad } from '@/lib/scheduling'
import {
  loadAdvisorsOnDuty, loadDayBook, loadSchedulingRules,
} from '@/lib/scheduling/store-rules'
import { dayKey } from '@/lib/drive/week'
import { BookForm } from './book-form'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Book an appointment' }

/**
 * The booking surface — one form, every role that books.
 *
 * ---------------------------------------------------------------------------
 * WHY THE DAY AND THE ADVISOR ARE IN THE URL
 * ---------------------------------------------------------------------------
 * The slot grid is painted with the engine's load, and load depends on which
 * day and whose book. Keeping both in the query string means the server paints
 * them — one authority for "how full is Tuesday", the same functions the action
 * re-runs before it writes — instead of a client copy that can drift from it.
 * It also makes a half-filled booking a link somebody can send.
 *
 * Everything that decides is pure and lives in `src/lib/scheduling/`.
 */
export default async function BookPage({
  searchParams,
}: {
  searchParams: Promise<{
    date?: string
    advisor?: string
    customerId?: string
    vehicleId?: string
    taskId?: string
    callLogId?: string
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

  const day = params.date ? new Date(`${params.date}T12:00:00`) : demoNow()
  const dateValue = dayKey(day)

  const rules = await loadSchedulingRules(store.id)
  const advisors = await loadAdvisorsOnDuty(store.id)
  const dayBook = await loadDayBook(store.id, day)

  const slots = slotsForDay(rules, day)
  const dayRules = dayRulesFor(rules, day)
  const requestedAdvisorId = advisors.some((a) => a.advisorId === params.advisor)
    ? params.advisor!
    : ''

  const advisorLoad = requestedAdvisorId ? bookLoad(slots, dayBook, requestedAdvisorId) : null
  const waiters = waiterLoad(slots, dayBook)
  /*
    Every book plus the pool, per slot. `bookLoad` answers for one book at a
    time — deliberately, since a cap is a fact about a book — so the "3 booked"
    a booker reads at a glance is counted here off the same slot boundaries.
  */
  const totalPerSlot = new Map<number, number>()
  for (const s of slots) {
    totalPerSlot.set(
      s.start.getTime(),
      dayBook.filter((a) => a.scheduledAt >= s.start && a.scheduledAt < s.end).length,
    )
  }

  const customer = params.customerId
    ? await loadCustomerRecord(store.id, params.customerId)
    : null
  // The search only runs when nobody is chosen yet — once a customer is on the
  // form, the list underneath it is noise.
  const matches = !customer && params.q ? await searchCustomers(store.id, params.q, 8) : []

  const advisorName = advisors.find((a) => a.advisorId === requestedAdvisorId)?.name ?? null

  const keep = (patch: Record<string, string | undefined>) => {
    const q = new URLSearchParams()
    const merged = {
      date: params.date, advisor: params.advisor, customerId: params.customerId,
      vehicleId: params.vehicleId, taskId: params.taskId, callLogId: params.callLogId,
      q: params.q, ...patch,
    }
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v)
    const s = q.toString()
    return s ? `/drive/book?${s}` : '/drive/book'
  }

  const stepDay = (delta: number) => {
    const d = new Date(day)
    d.setDate(d.getDate() + delta)
    return dayKey(d)
  }

  /*
    D1, said once where it is true. The hand-off panel says "the mock doesn't
    persist" the same way: a store running its loaner fleet off the DMS
    scheduler has to know that what is booked here is not there yet.
  */
  const dmsVendor = getDmsAdapter().capabilities.vendor
  const dmsPushes = getDmsAdapter().capabilities.canPushAppointment

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <p className="text-xs font-bold uppercase tracking-widest text-neutral-500">
            {store.name} · Service Drive
          </p>
          <WorkspaceNav />
        </div>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Book an appointment</h1>
        <p className="mt-1 text-neutral-600 dark:text-neutral-400">
          {day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          {dayRules
            ? ` · ${dayBook.length} on the book`
            : ' · the store is closed'}
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
                {customer.mobilePhone ?? 'No number on file'} · {customer.visitCount} visit
                {customer.visitCount === 1 ? '' : 's'}
              </p>
            </div>
            <Link href={keep({ customerId: undefined, vehicleId: undefined })} className="text-sm font-semibold hover:underline">
              Change
            </Link>
          </div>
        ) : (
          <>
            {/* A plain GET form, so a search is a shareable URL. */}
            <form action="/drive/book" method="get" className="mt-2">
              {(['date', 'advisor', 'taskId', 'callLogId'] as const).map((k) =>
                params[k] ? <input key={k} type="hidden" name={k} value={params[k]} /> : null,
              )}
              <input
                type="search"
                name="q"
                defaultValue={params.q ?? ''}
                placeholder="Name, phone, email, VIN or plate…"
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

            {params.q && matches.length === 0 && (
              <p className="mt-2 text-sm text-neutral-500">
                Nobody matches “{params.q}”. Fill in the new-customer fields below instead.
              </p>
            )}
          </>
        )}
      </section>

      {/* ----------------------------------------------------------- day */}
      <section className="mb-6 flex flex-wrap items-center gap-2">
        <Link href={keep({ date: stepDay(-1) })} className="rounded-lg border border-neutral-200 px-2.5 py-1.5 text-sm font-semibold dark:border-neutral-800" aria-label="Previous day">←</Link>
        <Link href={keep({ date: undefined })} className="rounded-lg border border-neutral-200 px-2.5 py-1.5 text-sm font-semibold dark:border-neutral-800">Today</Link>
        <Link href={keep({ date: stepDay(1) })} className="rounded-lg border border-neutral-200 px-2.5 py-1.5 text-sm font-semibold dark:border-neutral-800" aria-label="Next day">→</Link>

        <div className="ml-auto flex flex-wrap items-center gap-1 text-sm">
          <span className="text-neutral-500">Advisor:</span>
          <Link
            href={keep({ advisor: undefined })}
            className={`rounded-lg border px-2.5 py-1.5 font-semibold ${!requestedAdvisorId ? 'border-neutral-900 dark:border-neutral-300' : 'border-neutral-200 dark:border-neutral-800'}`}
          >
            Anyone
          </Link>
          {advisors.map((a) => (
            <Link
              key={a.advisorId}
              href={keep({ advisor: a.advisorId })}
              className={`rounded-lg border px-2.5 py-1.5 font-semibold ${requestedAdvisorId === a.advisorId ? 'border-neutral-900 dark:border-neutral-300' : 'border-neutral-200 dark:border-neutral-800'}`}
            >
              {a.name.split(' ')[0]}
            </Link>
          ))}
        </div>
      </section>

      <BookForm
        date={dateValue}
        slots={slots.map((s) => {
          const key = s.start.getTime()
          const mine = advisorLoad?.perSlot.get(key) ?? 0
          const waiting = waiters.get(key) ?? 0
          const notes: string[] = []
          const booked = totalPerSlot.get(key) ?? 0
          if (booked > 0) notes.push(`${booked} booked`)
          if (requestedAdvisorId && dayRules) {
            notes.push(`${advisorName?.split(' ')[0]} ${mine}/${dayRules.maxPerAdvisorSlot}`)
          }
          if (waiting > 0 && dayRules) notes.push(`${waiting}/${dayRules.maxWaitersPerSlot} waiting`)
          return {
            value: `${String(s.start.getHours()).padStart(2, '0')}:${String(s.start.getMinutes()).padStart(2, '0')}`,
            label: s.label,
            note: notes.join(' · '),
            // Painted, never disabled — capacity warns, it does not block (D3).
            tight: dayRules
              ? (requestedAdvisorId ? mine >= dayRules.maxPerAdvisorSlot : false)
                || waiting >= dayRules.maxWaitersPerSlot
              : false,
          }
        })}
        closedMessage={
          dayRules
            ? null
            : `${store.name} is closed on ${day.toLocaleDateString('en-US', { weekday: 'long' })}. A tow-in can still be recorded, and a manager can book any time.`
        }
        advisors={advisors.map((a) => ({ id: a.advisorId, name: a.name }))}
        requestedAdvisorId={requestedAdvisorId}
        customer={customer ? { id: customer.id, name: customer.name } : null}
        vehicles={customer?.vehicles.map((v) => ({ id: v.id, label: v.label })) ?? []}
        selectedVehicleId={params.vehicleId ?? ''}
        taskId={params.taskId ?? ''}
        callLogId={params.callLogId ?? ''}
        canOverrideHours={canManageStaff(user.role)}
        bookingAs={user.role === 'BDC' ? 'BDC' : 'ADVISOR'}
        autoAssign={dayRules?.autoAssign ?? true}
        dayLoad={dayBook.length}
      />

      <p className="mt-6 text-xs leading-relaxed text-neutral-500">
        {dmsPushes
          ? `Bookings are written through to ${dmsVendor}.`
          : `This appointment lives in DealerTech. ${dmsVendor} does not see it until the visit is handed off at write-up — if your loaner fleet or shuttle runs off the DMS scheduler, book those there too.`}
      </p>
    </main>
  )
}
