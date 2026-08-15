'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { openRepairOrder, type ActionState } from '../../actions'
import { checkOdometer, OVERRIDE_REASONS, readingSourceLabel } from '@/lib/odometer/check'

export interface MenuItem {
  id: string
  code: string
  description: string
  laborAmount: number
  partsAmount: number
  isMaintenance: boolean
  /** Prefilled when the prep sheet already flagged it. */
  suggested?: string
}

const INITIAL: ActionState = {}

function money(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

export interface LastReadingProp {
  mileage: number
  /** ISO — Dates do not survive the server/client prop boundary cleanly. */
  recordedAt: string
  source: string
}

export function WriteUpForm({
  appointmentId,
  defaultMileage,
  defaultConcerns,
  menu,
  suggestedOpCodeIds,
  lastReading,
}: {
  appointmentId: string
  defaultMileage: number
  defaultConcerns: string
  menu: MenuItem[]
  suggestedOpCodeIds: string[]
  /** Newest actual reading, for the live warning. The server checks it again. */
  lastReading: LastReadingProp | null
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(openRepairOrder, INITIAL)
  const [selected, setSelected] = useState<Set<string>>(new Set(suggestedOpCodeIds))
  const [mileage, setMileage] = useState(String(defaultMileage || ''))
  const [concerns, setConcerns] = useState(defaultConcerns)
  const [reasonCode, setReasonCode] = useState('')
  const [overrideNote, setOverrideNote] = useState('')
  const mileageRef = useRef<HTMLInputElement>(null)

  /**
   * The same check the server runs, for immediate feedback while typing.
   *
   * Not a substitute for the server's — it is a courtesy, so the advisor finds
   * out at the keyboard instead of after pressing the button. The server
   * refuses the write regardless of what happens here.
   */
  const live = checkOdometer(
    Number(mileage),
    lastReading
      ? { ...lastReading, recordedAt: new Date(lastReading.recordedAt) }
      : null,
  )

  /**
   * What to show, from whichever side noticed.
   *
   * `lastReading` is a prop captured when the page rendered. If another advisor
   * records a reading on this vehicle in the meantime, the local check passes
   * and the server's does not — so the server's verdict has to be able to raise
   * this panel on its own, or the advisor gets a refusal with nothing to act on.
   */
  const warning = live.status === 'BELOW_LAST_READING'
    ? {
        entered: live.entered,
        previous: live.last.mileage,
        severity: live.severity,
        headline: live.headline,
        likelyCause: live.likelyCause?.message ?? null,
        recordedAt: live.last.recordedAt.toISOString(),
        source: live.last.source,
      }
    : state.odometer
      ? { ...state.odometer, recordedAt: null, source: null }
      : null

  const isRollback = warning !== null

  // A corrected number invalidates the explanation given for the old one.
  useEffect(() => {
    if (live.status === 'OK') {
      setReasonCode('')
      setOverrideNote('')
    }
  }, [live.status])

  // Navigating in an effect, not during render. Calling router.push() in the
  // render body updates the Router while this component is rendering, which
  // React forbids ("Cannot update a component while rendering a different
  // component") and which fires the navigation on every render pass.
  useEffect(() => {
    if (state.ok && state.repairOrderId) {
      router.push(`/advisor/ro/${state.repairOrderId}`)
    }
  }, [state.ok, state.repairOrderId, router])

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const total = menu
    .filter((m) => selected.has(m.id))
    .reduce((s, m) => s + m.laborAmount + m.partsAmount, 0)

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="appointmentId" value={appointmentId} />
      {[...selected].map((id) => (
        <input key={id} type="hidden" name="opCodeId" value={id} />
      ))}

      <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
        <div>
          <label htmlFor="mileage" className="block text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Odometer
          </label>
          <input
            ref={mileageRef}
            id="mileage"
            name="mileage"
            type="number"
            min="1"
            required
            value={mileage}
            onChange={(e) => setMileage(e.target.value)}
            aria-invalid={isRollback}
            className={`mt-1 w-full rounded-md border bg-white px-3 py-2 text-lg font-bold tabular-nums outline-none dark:bg-neutral-950 ${
              isRollback
                ? 'border-amber-500 focus:border-amber-600 dark:border-amber-600'
                : 'border-neutral-300 focus:border-neutral-900 dark:border-neutral-700 dark:focus:border-neutral-300'
            }`}
          />
          <p className="mt-1 text-xs text-neutral-500">
            Every coverage decision keys off this. Read it, don&rsquo;t guess it.
          </p>
          {lastReading && !isRollback && (
            <p className="mt-1 text-xs text-neutral-500 tabular-nums">
              Last recorded {lastReading.mileage.toLocaleString()} mi on{' '}
              {new Date(lastReading.recordedAt).toLocaleDateString()}.
            </p>
          )}
        </div>
        <div>
          <label htmlFor="concerns" className="block text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Customer concern
          </label>
          <textarea
            id="concerns"
            name="concerns"
            rows={3}
            value={concerns}
            onChange={(e) => setConcerns(e.target.value)}
            className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-300"
          />
          <p className="mt-1 text-xs text-neutral-500">
            Their words, not an op-code description. It is what a warranty claim gets judged on.
          </p>
        </div>
      </div>

      {warning && (
        <section className="rounded-xl border border-amber-400 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950">
          <h2 className="text-xs font-bold uppercase tracking-widest text-amber-900 dark:text-amber-200">
            {warning.severity === 'MAJOR' ? 'Odometer reads well below the last visit' : 'Odometer reads lower than last visit'}
          </h2>
          <p className="mt-1 text-sm font-medium text-amber-950 dark:text-amber-100">
            {warning.headline}
          </p>
          {warning.recordedAt && (
            <p className="mt-1 text-xs text-amber-900 dark:text-amber-200/90">
              Recorded {new Date(warning.recordedAt).toLocaleDateString()}
              {warning.source && readingSourceLabel(warning.source)
                ? ` from ${readingSourceLabel(warning.source)}`
                : ''}
              .
            </p>
          )}
          {warning.likelyCause && (
            <p className="mt-2 rounded-md bg-amber-100 p-2 text-xs font-medium text-amber-950 dark:bg-amber-900/50 dark:text-amber-100">
              {warning.likelyCause}
            </p>
          )}

          {/*
            Correcting the entry comes first, and is styled as the primary way
            out. A mis-key is much the likeliest cause, and a prompt that leads
            with reasons to accept the number teaches advisors to pick one.
          */}
          <button
            type="button"
            onClick={() => {
              mileageRef.current?.focus()
              mileageRef.current?.select()
            }}
            className="mt-3 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            Re-check the cluster and correct it
          </button>

          <div className="mt-4 border-t border-amber-300 pt-3 dark:border-amber-800">
            <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
              Or, if {warning.entered.toLocaleString()} is what the cluster actually reads, say why:
            </p>
            <div className="mt-2 space-y-1.5">
              {OVERRIDE_REASONS.map((reason) => (
                <label
                  key={reason.code}
                  className="flex cursor-pointer items-start gap-2 rounded-md p-1.5 text-sm hover:bg-amber-100 dark:hover:bg-amber-900/40"
                >
                  <input
                    type="radio"
                    name="odometerOverrideReason"
                    value={reason.code}
                    checked={reasonCode === reason.code}
                    onChange={() => setReasonCode(reason.code)}
                    className="mt-1"
                  />
                  <span>
                    <span className="block font-medium text-amber-950 dark:text-amber-100">
                      {reason.label}
                    </span>
                    <span className="block text-xs text-amber-900/80 dark:text-amber-200/70">
                      {reason.hint}
                    </span>
                  </span>
                </label>
              ))}
            </div>

            <label
              htmlFor="odometerOverrideNote"
              className="mt-3 block text-xs font-semibold uppercase tracking-wide text-amber-900 dark:text-amber-200"
            >
              Note {reasonCode === 'OTHER' ? '(required)' : '(optional)'}
            </label>
            <textarea
              id="odometerOverrideNote"
              name="odometerOverrideNote"
              rows={2}
              value={overrideNote}
              onChange={(e) => setOverrideNote(e.target.value)}
              placeholder={
                reasonCode === 'OTHER'
                  ? 'Required — what happened?'
                  : 'Anything else worth recording (optional)'
              }
              className="mt-1 w-full rounded-md border border-amber-400 bg-white px-3 py-2 text-sm outline-none focus:border-amber-600 dark:border-amber-700 dark:bg-neutral-950"
            />
            <p className="mt-1 text-xs text-amber-900/80 dark:text-amber-200/70">
              Kept on the vehicle&rsquo;s record with your name and today&rsquo;s date.
            </p>
          </div>
        </section>
      )}

      <div>
        <h2 className="text-sm font-bold uppercase tracking-widest text-neutral-500">
          Menu — what did they authorise?
        </h2>
        <p className="mt-1 text-xs text-neutral-500">
          Items the prep sheet flagged are preselected. Present all of them; pre-qualifying is how
          gross gets left on the table.
        </p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {menu.map((m) => {
            const isOn = selected.has(m.id)
            return (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => toggle(m.id)}
                  className={`flex w-full items-start justify-between gap-3 rounded-lg border p-3 text-left transition ${
                    isOn
                      ? 'border-neutral-900 bg-neutral-50 dark:border-neutral-300 dark:bg-neutral-900'
                      : 'border-neutral-200 hover:border-neutral-400 dark:border-neutral-800'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span
                        className={`grid h-4 w-4 shrink-0 place-items-center rounded border text-[10px] ${
                          isOn
                            ? 'border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900'
                            : 'border-neutral-300 dark:border-neutral-600'
                        }`}
                      >
                        {isOn ? '✓' : ''}
                      </span>
                      <span className="text-sm font-medium">{m.description}</span>
                    </span>
                    {m.suggested && (
                      <span className="mt-1 block pl-6 text-xs text-amber-700 dark:text-amber-400">
                        {m.suggested}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-sm tabular-nums">
                    {money(m.laborAmount + m.partsAmount)}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200 pt-4 dark:border-neutral-800">
        <p className="text-sm">
          <span className="text-neutral-500">Authorised at write-up:</span>{' '}
          <span className="text-xl font-bold tabular-nums">{money(total)}</span>
        </p>
        {/*
          Blocked until the odometer is either corrected or explained. Disabled
          rather than left clickable-and-rejected: the reason panel is already
          on screen saying what is needed, and a button that fails silently
          teaches people to press it twice.
        */}
        <button
          type="submit"
          disabled={pending || (isRollback && !reasonCode)}
          className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {pending
            ? 'Opening…'
            : isRollback && !reasonCode
              ? 'Confirm the odometer first'
              : isRollback
                ? 'Open repair order with lower odometer'
                : 'Open repair order'}
        </button>
      </div>

      {/*
        The odometer panel above already explains the refusal in full. Repeating
        it in a red box underneath reads as two separate problems.
      */}
      {state.error && !state.odometer && (
        <p className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-100">
          {state.error}
        </p>
      )}
    </form>
  )
}
