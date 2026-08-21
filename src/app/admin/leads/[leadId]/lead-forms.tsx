'use client'

import { useActionState, useState } from 'react'
import { addLeadNote, markLeadLost, type LeadPipelineState } from '../../actions'

const INITIAL: LeadPipelineState = {}

const field =
  'mt-1 w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-300'

/**
 * Append to the story.
 *
 * Deliberately separate from the notes textarea above it, which holds the
 * current position and is rewritten on every save. This one only ever adds:
 * `lead_events` has no update or delete path anywhere in the application, so
 * what somebody wrote in March is what March says in September.
 *
 * NOTE or CALL, and the distinction earns its place — "rang, left a voicemail"
 * and "their DMS contract runs to June" are different kinds of fact, and a
 * timeline that separates them lets you find the last actual conversation
 * without reading everything in between.
 */
export function NoteForm({ leadId }: { leadId: string }) {
  const [state, formAction, pending] = useActionState(addLeadNote, INITIAL)

  return (
    <form action={formAction} className="p-4">
      <input type="hidden" name="leadId" value={leadId} />
      <label className="block text-xs font-semibold uppercase tracking-wide text-neutral-500" htmlFor={`event-${leadId}`}>
        Add to the timeline
      </label>
      <textarea
        id={`event-${leadId}`}
        name="body"
        rows={2}
        required
        maxLength={2000}
        placeholder="Rang the fixed ops director — they run CDK, want to see the prep sheet before committing."
        className={field}
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400">
          <input type="radio" name="kind" value="NOTE" defaultChecked className="h-3.5 w-3.5" />
          Note
        </label>
        <label className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400">
          <input type="radio" name="kind" value="CALL" className="h-3.5 w-3.5" />
          Call
        </label>
        <button
          type="submit"
          disabled={pending}
          className="touch-target rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          {pending ? 'Saving…' : 'Add'}
        </button>
        {state.ok && <span className="text-xs text-emerald-700 dark:text-emerald-400">{state.ok}</span>}
        {state.error && <span className="text-xs text-rose-700 dark:text-rose-400">{state.error}</span>}
      </div>
    </form>
  )
}

/**
 * The one terminal outcome, and the way back from it.
 *
 * Collapsed until asked for. Losing a deal is rare and the button is
 * destructive in the only sense that applies here — LOST beats every other
 * fact, so a mis-click takes the lead off every stage tab at once. Which is
 * also why reopening is right beside it rather than being a support request:
 * a flag that can only be set is one nobody trusts enough to use.
 */
export function LostControls({
  leadId,
  lostAt,
  lostReason,
}: {
  leadId: string
  lostAt: string | null
  lostReason: string | null
}) {
  const [state, formAction, pending] = useActionState(markLeadLost, INITIAL)
  const [open, setOpen] = useState(false)

  if (lostAt) {
    return (
      <form action={formAction} className="p-4">
        <input type="hidden" name="leadId" value={leadId} />
        <input type="hidden" name="intent" value="reopen" />
        <p className="text-sm">
          <span className="font-semibold">Lost</span>
          <span className="ml-2 text-xs text-neutral-500">{lostAt.slice(0, 10)}</span>
        </p>
        {lostReason && (
          <p className="mt-1 text-xs italic text-neutral-600 dark:text-neutral-400">{lostReason}</p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="mt-3 rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium transition hover:border-neutral-900 disabled:opacity-50 dark:border-neutral-700 dark:hover:border-neutral-300"
        >
          {pending ? 'Reopening…' : 'Reopen — they came back'}
        </button>
        {state.error && (
          <p className="mt-2 text-xs text-rose-700 dark:text-rose-400">{state.error}</p>
        )}
      </form>
    )
  }

  if (!open) {
    return (
      <div className="p-4">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium transition hover:border-rose-600 hover:text-rose-700 dark:border-neutral-700"
        >
          Record this as lost
        </button>
      </div>
    )
  }

  return (
    <form action={formAction} className="p-4">
      <input type="hidden" name="leadId" value={leadId} />
      <label className="block text-xs font-semibold uppercase tracking-wide text-neutral-500" htmlFor={`lost-${leadId}`}>
        Why
      </label>
      <input
        id={`lost-${leadId}`}
        name="reason"
        required
        maxLength={500}
        placeholder="Signed with Xtime in July — locked in for two years."
        className={field}
      />
      <div className="mt-3 flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg border border-rose-300 px-3 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950"
        >
          {pending ? 'Saving…' : 'Mark lost'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700"
        >
          Cancel
        </button>
      </div>
      {state.error && (
        <p className="mt-2 rounded-lg border border-rose-300 bg-rose-50 p-2 text-xs text-rose-900 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-100">
          {state.error}
        </p>
      )}
    </form>
  )
}
