'use client'

import { useActionState } from 'react'
import { reissueAdminInvite, type ReinviteState } from '../actions'
import type { GoLiveItem } from '@/lib/platform/go-live'

const INITIAL: ReinviteState = {}

/**
 * The road from "signed" to "advisors working", one rooftop at a time.
 *
 * ---------------------------------------------------------------------------
 * WHY EVERY UNFINISHED ROW CARRIES SOMETHING TO DO
 * ---------------------------------------------------------------------------
 * A checklist that only reports gets read once. Each row that is not done
 * names the thing that would finish it: the dealership's own screen for the
 * setup work, the invitation button for the one thing DealerTech can do from
 * here, and — for the first appointment — an honest admission that nobody on
 * this side can do anything but ring them.
 *
 * The decisions are all in `src/lib/platform/go-live.ts`, which is pure. This
 * renders them.
 */
export function GoLiveChecklist({
  organizationId,
  storeId,
  items,
}: {
  organizationId: string
  storeId: string
  items: GoLiveItem[]
}) {
  return (
    <ul className="mt-2 space-y-1">
      {items.map((item) => (
        <li key={item.key} className="flex flex-wrap items-baseline gap-2 text-xs">
          <span
            className={item.done
              ? 'text-emerald-700 dark:text-emerald-400'
              : 'text-neutral-400 dark:text-neutral-600'}
            aria-hidden
          >
            {item.done ? '✓' : '○'}
          </span>
          <span className={item.done ? 'text-neutral-500' : 'font-medium'}>{item.label}</span>
          {item.detail && <span className="text-neutral-500">{item.detail}</span>}
          {item.pointer?.kind === 'LINK' && (
            <span className="font-mono text-neutral-500">{item.pointer.href}</span>
          )}
          {item.pointer?.kind === 'WAIT' && (
            <span className="text-neutral-500">{item.pointer.label}</span>
          )}
          {item.pointer?.kind === 'SCRIPT' && (
            /*
              A command to copy, not a button.

              Writing eight rows into somebody else's dealership deserves a
              person who has read what the script does — and it lists before it
              writes, which a button cannot offer. Selectable on click because
              the whole point is getting it into a terminal.
            */
            <>
              <span className="text-neutral-500">{item.pointer.label}</span>
              <code
                className="select-all rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[11px] dark:bg-neutral-800"
              >
                {item.pointer.command}
              </code>
            </>
          )}
          {item.pointer?.kind === 'REINVITE' && (
            <ReinviteButton
              organizationId={organizationId}
              storeId={storeId}
              email={item.pointer.email}
            />
          )}
        </li>
      ))}
    </ul>
  )
}

/**
 * Issue the invitation again.
 *
 * Not "show me the link again", which is impossible: only the token's SHA-256
 * is stored, so there is nothing to recover — see `reissueAdminInvite`. The
 * new link is shown exactly once here, with the same discipline as
 * provisioning, and re-issuing revokes whatever was pending so the dealership
 * never has two working links.
 */
function ReinviteButton({ organizationId, storeId, email }: {
  organizationId: string; storeId: string; email: string
}) {
  const [state, formAction, pending] = useActionState(reissueAdminInvite, INITIAL)

  if (state.link) {
    return (
      <span className="flex min-w-0 flex-wrap items-center gap-2">
        <input
          readOnly
          value={state.link}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded border border-emerald-300 bg-white px-2 py-1 font-mono text-xs dark:border-emerald-800 dark:bg-neutral-950"
        />
        <span className="text-neutral-500">
          shown once — send it to {state.email}
        </span>
      </span>
    )
  }

  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="storeId" value={storeId} />
      <input type="hidden" name="email" value={email} />
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-neutral-300 px-2 py-0.5 font-medium transition hover:border-neutral-900 disabled:opacity-50 dark:border-neutral-700 dark:hover:border-neutral-300"
      >
        {pending ? 'Issuing…' : 'Invite again'}
      </button>
      {state.error && <span className="text-rose-700 dark:text-rose-400">{state.error}</span>}
    </form>
  )
}
