'use client'

import { useActionState } from 'react'
import { recordLeadOutcome, type LeadOutcomeState } from '../actions'

const INITIAL: LeadOutcomeState = {}

/**
 * What happened when somebody rang them.
 *
 * ---------------------------------------------------------------------------
 * OPEN BY DEFAULT, UNLIKE EVERY OTHER FORM IN THIS CONSOLE
 * ---------------------------------------------------------------------------
 * The provisioning form below collapses because standing up a dealership is
 * rare and the form is large. This is the opposite: writing down what was said
 * is the ordinary thing to do on this page, and a note that costs a click to
 * start is a note that does not get written. The existing state is the value of
 * the box, so it doubles as the record — you read the last call and type the
 * next one in the same place.
 *
 * The textarea is deliberately not auto-saving. A half-typed sentence
 * committing itself when somebody tabs away would overwrite the previous call's
 * record with a fragment.
 */
export function OutcomeForm({
  leadId,
  notes,
  contacted,
}: {
  leadId: string
  notes: string | null
  contacted: boolean
}) {
  const [state, formAction, pending] = useActionState(recordLeadOutcome, INITIAL)

  return (
    <form action={formAction} className="mt-3">
      <input type="hidden" name="leadId" value={leadId} />

      <label className="block text-xs font-semibold uppercase tracking-wide text-neutral-500" htmlFor={`notes-${leadId}`}>
        What happened
      </label>
      <textarea
        id={`notes-${leadId}`}
        name="notes"
        rows={2}
        defaultValue={notes ?? ''}
        placeholder="Rang 14th, spoke to the fixed ops director — wants a demo after the model year changeover."
        className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-300"
      />

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400">
          <input
            type="checkbox"
            name="contacted"
            defaultChecked={contacted}
            className="h-4 w-4 rounded border-neutral-300 dark:border-neutral-700"
          />
          {/*
            Unchecking is allowed on purpose. A lead marked by a mis-click
            vanishes from the only count that would ever surface it again.
          */}
          Contacted
        </label>
        <button
          type="submit"
          disabled={pending}
          className="touch-target rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
        {state.ok && <span className="text-xs text-emerald-700 dark:text-emerald-400">{state.ok}</span>}
        {state.error && <span className="text-xs text-rose-700 dark:text-rose-400">{state.error}</span>}
      </div>
    </form>
  )
}
