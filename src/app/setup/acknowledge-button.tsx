'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { acknowledgeStep, type SetupState } from './actions'

const INITIAL: SetupState = {}

/**
 * "I have looked at this and the default is right."
 *
 * Two controls rather than one, because there are two things a manager might
 * mean. `Review` opens the settings so they can change them; `Confirm` records
 * that they considered the current values and kept them.
 *
 * Confirming without offering the review link would turn a decision about
 * re-authorisation law into a box somebody clears to make a page go quiet —
 * which is the opposite of the point, since the default exists precisely
 * because the rule varies by state.
 */
export function AcknowledgeButton({ stepKey, href }: { stepKey: string; href: string }) {
  const [state, formAction, pending] = useActionState(acknowledgeStep, INITIAL)

  return (
    <div className="shrink-0 text-right">
      <div className="flex items-center gap-2">
        <Link
          href={href}
          className="touch-target rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-semibold hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          Review
        </Link>
        <form action={formAction}>
          <input type="hidden" name="stepKey" value={stepKey} />
          <button
            type="submit"
            disabled={pending}
            className="touch-target rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
          >
            {pending ? 'Saving…' : 'Confirm'}
          </button>
        </form>
      </div>
      {state.error && (
        <p className="mt-1 text-xs text-rose-700 dark:text-rose-400">{state.error}</p>
      )}
    </div>
  )
}
