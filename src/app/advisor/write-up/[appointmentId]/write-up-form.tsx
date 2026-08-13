'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { openRepairOrder, type ActionState } from '../../actions'

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

export function WriteUpForm({
  appointmentId,
  defaultMileage,
  defaultConcerns,
  menu,
  suggestedOpCodeIds,
}: {
  appointmentId: string
  defaultMileage: number
  defaultConcerns: string
  menu: MenuItem[]
  suggestedOpCodeIds: string[]
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(openRepairOrder, INITIAL)
  const [selected, setSelected] = useState<Set<string>>(new Set(suggestedOpCodeIds))
  const [mileage, setMileage] = useState(String(defaultMileage || ''))
  const [concerns, setConcerns] = useState(defaultConcerns)

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
            id="mileage"
            name="mileage"
            type="number"
            min="1"
            required
            value={mileage}
            onChange={(e) => setMileage(e.target.value)}
            className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-lg font-bold tabular-nums outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-300"
          />
          <p className="mt-1 text-xs text-neutral-500">
            Every coverage decision keys off this. Read it, don&rsquo;t guess it.
          </p>
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
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {pending ? 'Opening…' : 'Open repair order'}
        </button>
      </div>

      {state.error && (
        <p className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-100">
          {state.error}
        </p>
      )}
    </form>
  )
}
