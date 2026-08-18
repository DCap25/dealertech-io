'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { bookAppointment, type BookingState } from './actions'
import { TRANSPORT_TYPES } from './transport'

/**
 * The form itself.
 *
 * Deliberately dumb: every number on it was computed on the server by the
 * scheduling engine, and the action re-computes all of it before it writes. The
 * only state here is what somebody has typed and not yet sent.
 *
 * A full slot is painted, never disabled. Capacity warns and does not block
 * (DRIVE_PLAN D3) — the person booking may know exactly why a fifth write-up at
 * 8:00 is fine, and a grey box would only send the appointment somewhere we
 * cannot see it.
 */

const INITIAL: BookingState = {}

export interface SlotOption {
  value: string
  label: string
  note: string
  tight: boolean
}

export function BookForm({
  date, slots, closedMessage, advisors, requestedAdvisorId, customer, vehicles,
  selectedVehicleId, taskId, callLogId, canOverrideHours, bookingAs, autoAssign, dayLoad,
}: {
  date: string
  slots: SlotOption[]
  closedMessage: string | null
  advisors: { id: string; name: string }[]
  requestedAdvisorId: string
  customer: { id: string; name: string } | null
  vehicles: { id: string; label: string }[]
  selectedVehicleId: string
  taskId: string
  callLogId: string
  canOverrideHours: boolean
  bookingAs: 'ADVISOR' | 'BDC'
  autoAssign: boolean
  dayLoad: number
}) {
  const [state, action, pending] = useActionState(bookAppointment, INITIAL)
  const [time, setTime] = useState('')
  const [transport, setTransport] = useState('DROP_OFF')
  const [creating, setCreating] = useState(false)

  if (state.ok) {
    return (
      <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950">
        <p className="font-bold text-emerald-900 dark:text-emerald-200">Booked.</p>
        {state.warnings && state.warnings.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm text-emerald-900 dark:text-emerald-200">
            {state.warnings.map((w) => (
              <li key={w}>· {w}</li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap gap-2 text-sm font-semibold">
          <Link href={`/drive/${state.appointmentId}`} className="rounded-lg bg-neutral-900 px-3 py-2 text-white dark:bg-white dark:text-neutral-900">
            Open the prep sheet
          </Link>
          <Link href="/drive/book" className="rounded-lg border border-neutral-300 px-3 py-2 dark:border-neutral-700">
            Book another
          </Link>
        </div>
      </div>
    )
  }

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="customerId" value={customer?.id ?? ''} />
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="callLogId" value={callLogId} />

      {/* --------------------------------------------------- new customer */}
      {!customer && (
        <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <button
            type="button"
            onClick={() => setCreating((v) => !v)}
            className="text-sm font-semibold hover:underline"
          >
            {creating ? 'Cancel new customer' : 'Not on the books — add them here'}
          </button>
          {creating && (
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Field name="newFirstName" label="First name" />
              <Field name="newLastName" label="Last name" />
              <Field name="newMobilePhone" label="Mobile" />
              <Field name="newModelYear" label="Year" />
              <Field name="newMake" label="Make" />
              <Field name="newModel" label="Model" />
              <div className="sm:col-span-3">
                <Field name="newVin" label="VIN" />
                <p className="mt-1 text-xs text-neutral-500">
                  The vehicle is only created when there is a VIN, a year and a make. Without
                  them the appointment is booked against the customer alone and the car is
                  attached at write-up — better than a placeholder VIN that every coverage
                  lookup keys off for the rest of its life.
                </p>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ------------------------------------------------------- vehicle */}
      {customer && vehicles.length > 0 && (
        <section>
          <label htmlFor="vehicleId" className="text-xs font-bold uppercase tracking-wide text-neutral-500">
            Vehicle
          </label>
          <select
            id="vehicleId"
            name="vehicleId"
            defaultValue={selectedVehicleId}
            className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          >
            <option value="">Decide at write-up</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>{v.label}</option>
            ))}
          </select>
        </section>
      )}

      {/* ---------------------------------------------------------- slot */}
      <section>
        <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">
          Time {dayLoad > 0 && <span className="font-medium normal-case text-neutral-400">· {dayLoad} already on the book</span>}
        </p>

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

        {/*
          The way a 7am tow-in gets recorded. It is the only route to the one
          hard stop in the engine, which is what makes the stop meaningful
          rather than an artefact of the grid having no box for it.
        */}
        <div className="mt-3">
          <label htmlFor="other-time" className="text-xs text-neutral-500">
            Or another time
          </label>
          <input
            id="other-time"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="ml-2 rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          />
        </div>
      </section>

      {/* ------------------------------------------------------ the rest */}
      <section className="grid gap-4 sm:grid-cols-2">
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

        <div>
          <label htmlFor="requestedAdvisorId" className="text-xs font-bold uppercase tracking-wide text-neutral-500">
            Requested advisor
          </label>
          <select
            id="requestedAdvisorId"
            name="requestedAdvisorId"
            defaultValue={requestedAdvisorId}
            className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          >
            <option value="">
              {autoAssign ? 'Whoever has room' : 'Leave for whoever claims it'}
            </option>
            {advisors.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-neutral-500">
            {autoAssign
              ? 'Left blank, the balancer picks the lightest book for that day.'
              : 'This store claims at arrival, so a blank stays in the unassigned pool.'}
          </p>
        </div>
      </section>

      <section>
        <label htmlFor="concerns" className="text-xs font-bold uppercase tracking-wide text-neutral-500">
          What they said
        </label>
        <textarea
          id="concerns"
          name="concerns"
          rows={3}
          placeholder="Their words, not an op code — this is what the technician reads."
          className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
        />
      </section>

      {state.outsideHours && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950">
          <p className="font-semibold text-amber-900 dark:text-amber-200">{state.outsideHours.message}</p>
          {state.outsideHours.overridable ? (
            <label className="mt-2 flex items-center gap-2 text-amber-900 dark:text-amber-200">
              <input type="checkbox" name="overrideHours" />
              Book it anyway
            </label>
          ) : (
            <p className="mt-1 text-amber-900 dark:text-amber-200">
              A manager can book outside hours, and anybody can record a tow-in.
            </p>
          )}
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
          {pending ? 'Booking…' : 'Book it'}
        </button>
        <span className="text-xs text-neutral-500">
          Recorded as a {bookingAs === 'BDC' ? 'BDC' : 'drive'} booking, in your name.
          {canOverrideHours && ' You can book outside store hours.'}
        </span>
      </div>
    </form>
  )
}

function Field({ name, label }: { name: string; label: string }) {
  return (
    <div>
      <label htmlFor={name} className="text-xs text-neutral-500">{label}</label>
      <input
        id={name}
        name={name}
        className="mt-0.5 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
      />
    </div>
  )
}
