'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { bookAppointment, type BookingState } from '@/app/drive/book/actions'
import { TRANSPORT_TYPES } from '@/app/drive/book/transport'

/**
 * The introduction form.
 *
 * Posts to `bookAppointment` — the drive's own booking action — with
 * `intent=SALES_INTRO`. Not a copy of it and not a second action: the same
 * customer, car, slot, cascade and capacity sentences, differing only in what
 * gets recorded (DRIVE_PLAN D5). Two actions would mean two places that decide
 * who gets the appointment, and they would eventually disagree.
 *
 * Dumb, like the drive's form: every number on it was computed on the server by
 * the scheduling engine, and the action recomputes all of it before it writes.
 * A full slot is painted, never disabled — capacity warns and does not block.
 */

const INITIAL: BookingState = {}

export interface SlotOption {
  value: string
  label: string
  note: string
  tight: boolean
}

export function IntroduceForm({
  date, dateLabel, dateReason, slots, closedMessage, advisors, introducedAdvisorId,
  customer, knownVehicles, defaultMake, defaultModelYear,
}: {
  date: string
  dateLabel: string
  dateReason: string | null
  slots: SlotOption[]
  closedMessage: string | null
  advisors: { id: string; name: string }[]
  introducedAdvisorId: string
  customer: { id: string; name: string } | null
  knownVehicles: { id: string; label: string }[]
  defaultMake: string
  defaultModelYear: string
}) {
  const [state, action, pending] = useActionState(bookAppointment, INITIAL)
  const [time, setTime] = useState('')
  /*
    Pre-picked, and it is the right default rather than a lazy one: a first
    service six months out is planned, and somebody planning a visit that far
    ahead is not standing in the lounge waiting for it.
  */
  const [transport, setTransport] = useState('DROP_OFF')
  const [useKnownVehicle, setUseKnownVehicle] = useState(false)

  if (state.ok) {
    return (
      <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950">
        <p className="font-bold text-emerald-900 dark:text-emerald-200">
          Booked. Walk them over and make the introduction.
        </p>
        <p className="mt-1 text-sm text-emerald-900/80 dark:text-emerald-200/80">
          The advisor sees this as a first service when the day comes — who sold the car, and
          who they were introduced to.
        </p>
        {state.warnings && state.warnings.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm text-emerald-900 dark:text-emerald-200">
            {state.warnings.map((w) => (
              <li key={w}>· {w}</li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap gap-2 text-sm font-semibold">
          <Link href="/introduce" className="rounded-lg bg-neutral-900 px-3 py-2 text-white dark:bg-white dark:text-neutral-900">
            Introduce somebody else
          </Link>
        </div>
      </div>
    )
  }

  return (
    <form action={action} className="space-y-6">
      {/* The flag that turns the drive's booking action into an introduction. */}
      <input type="hidden" name="intent" value="SALES_INTRO" />
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="customerId" value={customer?.id ?? ''} />

      {/* --------------------------------------------------- new customer */}
      {!customer && (
        <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <h2 className="text-xs font-bold uppercase tracking-wide text-neutral-500">
            Who bought the car
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Field name="newFirstName" label="First name" />
            <Field name="newLastName" label="Last name" />
            <Field name="newMobilePhone" label="Mobile" />
          </div>
        </section>
      )}

      {/* ------------------------------------------------------- vehicle */}
      <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xs font-bold uppercase tracking-wide text-neutral-500">
            The car they are taking home
          </h2>
          {/*
            The repeat buyer's escape hatch. Most deliveries are a car we have
            never seen, so the VIN fields lead — but a lease turn-in that was
            already keyed should not be entered twice, and a duplicate VIN is a
            unique-constraint failure the salesperson cannot read.
          */}
          {knownVehicles.length > 0 && (
            <button
              type="button"
              onClick={() => setUseKnownVehicle((v) => !v)}
              className="text-xs font-semibold hover:underline"
            >
              {useKnownVehicle ? 'Enter a new VIN instead' : 'It is already on their record'}
            </button>
          )}
        </div>

        {useKnownVehicle && knownVehicles.length > 0 ? (
          <div className="mt-3">
            <label htmlFor="vehicleId" className="text-xs text-neutral-500">Vehicle on file</label>
            <select
              id="vehicleId"
              name="vehicleId"
              className="mt-0.5 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
            >
              {knownVehicles.map((v) => (
                <option key={v.id} value={v.id}>{v.label}</option>
              ))}
            </select>
          </div>
        ) : (
          <>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Field name="newModelYear" label="Year" defaultValue={defaultModelYear} />
              <Field name="newMake" label="Make" defaultValue={defaultMake} />
              <Field name="newModel" label="Model" />
            </div>
            <div className="mt-3">
              <Field name="newVin" label="VIN" />
              <p className="mt-1 text-xs text-neutral-500">
                Off the buyer&rsquo;s order. Without a VIN, a year and a make the appointment is
                booked against the customer alone and the car is attached at write-up — better
                than a placeholder VIN, which every coverage lookup keys off for the rest of its
                life.
              </p>
            </div>
          </>
        )}
      </section>

      {/* ---------------------------------------------------------- slot */}
      <section>
        <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">
          First service · <span className="font-medium normal-case text-neutral-400">{dateLabel}</span>
        </p>
        {dateReason && <p className="mt-1 text-xs text-neutral-500">{dateReason}</p>}

        {closedMessage && (
          <p className="mt-1 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {closedMessage}
          </p>
        )}

        {slots.length > 0 && (
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {slots.map((s) => (
              <label
                key={s.value}
                className={`cursor-pointer rounded-lg border px-3 py-2 text-sm transition ${
                  time === s.value
                    ? 'border-neutral-900 bg-neutral-900 text-white dark:border-neutral-300 dark:bg-white dark:text-neutral-900'
                    : s.tight
                      ? 'border-amber-300 dark:border-amber-800'
                      : 'border-neutral-200 dark:border-neutral-800'
                }`}
              >
                <input
                  type="radio"
                  name="time"
                  value={s.value}
                  checked={time === s.value}
                  onChange={() => setTime(s.value)}
                  className="sr-only"
                />
                <span className="block font-bold tabular-nums">{s.label}</span>
                <span className="block text-[11px] opacity-70">{s.note || 'open'}</span>
              </label>
            ))}
          </div>
        )}
      </section>

      {/* ------------------------------------------------------ the rest */}
      <section className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="introducedAdvisorId" className="text-xs font-bold uppercase tracking-wide text-neutral-500">
            Introduced to
          </label>
          <select
            id="introducedAdvisorId"
            name="introducedAdvisorId"
            defaultValue={introducedAdvisorId}
            className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          >
            <option value="">Nobody in particular</option>
            {advisors.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          {/*
            The one sentence on this page that explains a real rule. Naming an
            advisor is what forms the relationship (D6) — leaving it blank is
            not a failure, it just means the relationship forms at the first
            visit with whoever actually greets them.
          */}
          <p className="mt-1 text-xs text-neutral-500">
            Name the advisor you walked them to and they become that customer&rsquo;s advisor.
            Leave it blank and the drive picks whoever has room; they get their advisor at the
            first visit instead.
          </p>
        </div>

        <div>
          <label htmlFor="transportType" className="text-xs font-bold uppercase tracking-wide text-neutral-500">
            Transport
          </label>
          <select
            id="transportType"
            name="transportType"
            value={transport}
            onChange={(e) => setTransport(e.target.value)}
            className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          >
            {TRANSPORT_TYPES.map((t) => (
              <option key={t} value={t}>{t.replace(/_/g, ' ').toLowerCase()}</option>
            ))}
          </select>
        </div>
      </section>

      <section>
        <label htmlFor="concerns" className="text-xs font-bold uppercase tracking-wide text-neutral-500">
          Anything the advisor should know
        </label>
        <textarea
          id="concerns"
          name="concerns"
          rows={2}
          placeholder="Anything promised in the deal, or anything they mentioned. Their words, not a code."
          className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
        />
      </section>

      {state.outsideHours && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950">
          <p className="font-semibold text-amber-900 dark:text-amber-200">{state.outsideHours.message}</p>
          <p className="mt-1 text-amber-900 dark:text-amber-200">Step to another day.</p>
        </div>
      )}

      {state.error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-200">
          {state.error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || !time}
          className="rounded-xl bg-neutral-900 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-40 dark:bg-white dark:text-neutral-900"
        >
          {pending ? 'Booking…' : 'Book the first service'}
        </button>
        <span className="text-xs text-neutral-500">Recorded as your delivery introduction.</span>
      </div>
    </form>
  )
}

function Field({ name, label, defaultValue }: { name: string; label: string; defaultValue?: string }) {
  return (
    <div>
      <label htmlFor={name} className="text-xs text-neutral-500">{label}</label>
      <input
        id={name}
        name={name}
        defaultValue={defaultValue}
        className="mt-0.5 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
      />
    </div>
  )
}
