'use client'

import { useActionState, useState, useTransition } from 'react'
import { ServiceMenu, money } from '@/components/present/service-menu'
import { revertDecision, totalDecisions, type Decision } from '@/lib/presentation/decisions'
import {
  linkStatusMessage, linkStatusTitle, refusalFromStatus, type LinkRefusal,
} from '@/lib/presentation/link'
import type { DeviceSnapshot } from '@/lib/pairing/snapshot'
import { authorise, saveAnswer, type AuthoriseState } from './actions'

const INITIAL: AuthoriseState = {}

/**
 * The menu on a customer's own phone, hours after they dropped the car off.
 *
 * Answers save as they are tapped rather than only at the end. Somebody
 * reading this between meetings will close the tab halfway through, and losing
 * their choices would mean the advisor rings them to ask questions they already
 * answered — which is exactly the experience the product exists to remove.
 *
 * The other half of that promise is admitting when a tap did not save. A link
 * lives twelve hours and a tab can sit open longer, so the server refuses
 * writes it is right to refuse — and this screen used to accept every one of
 * them anyway and let the customer find out at the button (F9).
 */
export function CustomerMenu({
  token,
  snapshot,
  initialDecisions,
  authorized,
}: {
  token: string
  snapshot: DeviceSnapshot
  initialDecisions: Record<string, Decision>
  authorized: { at: string; name: string } | null
}) {
  const [decisions, setDecisions] = useState<Record<string, Decision>>(initialDecisions)
  const [, startSaving] = useTransition()
  const [state, formAction, pending] = useActionState(authorise, INITIAL)
  const [refusedBySave, setRefusedBySave] = useState<LinkRefusal | null>(null)

  // Either path can find the link shut: a tap the server would not record, or a
  // submit that arrived after it closed. One banner, one sentence, one state.
  const refused = refusedBySave ?? state.refused ?? null

  /*
    An unpriced line counts as answered but adds nothing to the total.

    We do not know what it costs — that is the whole reason it says "price to
    be confirmed" — so adding our estimate into the running figure would put
    the same unhonourable number back on screen by another route.
  */
  const items = snapshot.tiers.flatMap((t) =>
    t.items.map((i) => ({
      id: i.id,
      customerPrice: i.priceConfirmed === false ? 0 : i.customerOutOfPocket,
    })))
  const totals = totalDecisions(items, decisions)
  const answered = totals.accepted + totals.declined + totals.callMe
  const isDone = Boolean(authorized) || state.done
  // Nothing more can be answered: they have sent it, or the link will not take
  // another word. Either way the buttons stop being controls.
  const closed = isDone || refused !== null

  function decide(id: string, decision: Decision) {
    if (refused) return

    // Optimistic: a tap must feel instant on a phone with two bars.
    const previous = decisions[id]
    setDecisions((prev) => ({ ...prev, [id]: decision }))

    startSaving(async () => {
      const outcome = refusalFromStatus(await saveAnswer(token, id, decision))
      if (!outcome) return

      /*
        Put the tap back and say why, at the first one that failed.

        Reverted rather than left on screen and greyed out: the answer is not
        in the record, and a menu that keeps showing it under a banner reading
        "this link has expired" is telling the same lie in smaller print. What
        stays is everything that did save while the link was open, which is
        what makes "nothing you chose has been lost" true on this screen rather
        than merely well meant.
      */
      setDecisions((prev) => revertDecision(prev, id, previous))
      setRefusedBySave(outcome)
    })
  }

  return (
    <main className={`min-h-dvh bg-[var(--background)] ${
      // Room for the fixed confirm bar, and none reserved when there is no bar.
      !closed && snapshot.itemCount > 0 ? 'pb-40' : 'pb-12'
    }`}>
      <div className="mx-auto max-w-3xl px-5 py-8 sm:px-6">
        {isDone && (
          <div className="mb-6 rounded-2xl border border-emerald-300 bg-emerald-50 p-5 dark:border-emerald-800 dark:bg-emerald-950">
            <p className="text-lg font-bold text-emerald-900 dark:text-emerald-100">
              Sent to your advisor
            </p>
            <p className="mt-1 text-sm text-emerald-900/90 dark:text-emerald-200/90">
              {authorized
                ? `Confirmed by ${authorized.name}.`
                : 'Thank you — they will confirm the work and the final price with you.'}{' '}
              Nothing starts until they have spoken to you.
            </p>
          </div>
        )}

        {refused && (
          /*
            Where the tap was, not at the bottom of the page.

            Somebody halfway down a menu is looking at the item they just
            answered, so the notice sits above the list they are working
            through and the list itself stops responding. The wording is the
            page's own — the same sentence a fresh load of a closed link shows,
            because a customer who then reloads must not be told two things.
          */
          <div
            role="status"
            className="mb-6 rounded-2xl border border-amber-300 bg-amber-50 p-5 dark:border-amber-800 dark:bg-amber-950"
          >
            <p className="text-lg font-bold text-amber-900 dark:text-amber-100">
              {linkStatusTitle(refused)}
            </p>
            <p className="mt-1 text-sm text-amber-900/90 dark:text-amber-200/90">
              {linkStatusMessage(refused)}
            </p>
          </div>
        )}

        <ServiceMenu
          snapshot={snapshot}
          decisions={decisions}
          onDecide={decide}
          readOnly={closed}
        />

        <p className="mt-8 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
          Choosing here tells your advisor what you would like done — they will confirm the work and
          the final price with you before anything starts. Prices are estimates until parts are
          confirmed.
        </p>
      </div>

      {/*
        Nothing to answer means nothing to send.

        An empty list still rendered "0 of 0 answered", a £0 total and a button
        asking the customer to type their name and confirm it. Confirming an
        empty list is not a thing anybody means to do, and being asked to sign
        for nothing is the kind of small wrongness that makes a person doubt
        the rest of the screen.
      */}
      {!closed && snapshot.itemCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 border-t border-[var(--border)] bg-[var(--background)]/95 px-5 py-4 backdrop-blur sm:px-6">
          <div className="mx-auto max-w-3xl">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-sm font-semibold">
                {answered} of {snapshot.itemCount} answered
                {totals.callMe > 0 && (
                  <span className="ml-2 font-normal text-sky-700 dark:text-sky-400">
                    · {totals.callMe} to talk through
                  </span>
                )}
              </span>
              <span className="text-3xl font-bold tabular-nums">
                {money(totals.authorisedAmount)}
              </span>
            </div>

            <form action={formAction} className="mt-3 flex flex-wrap items-center gap-2">
              <input type="hidden" name="token" value={token} />
              <label htmlFor="name" className="sr-only">Your name</label>
              <input
                id="name"
                name="name"
                required
                placeholder="Type your name to confirm"
                autoComplete="name"
                className="min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-base"
              />
              {/*
                Enabled even with nothing chosen.

                "No thank you, none of it" is a real and complete answer, and
                an advisor is far better off hearing it now than ringing at
                four o'clock to find out. Blocking the button until something
                is accepted would be the product quietly refusing to take no.
              */}
              <button
                type="submit"
                disabled={pending}
                className="touch-target rounded-xl bg-neutral-900 px-6 py-3 text-base font-bold text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
              >
                {pending ? 'Sending…' : 'Send to my advisor'}
              </button>
            </form>

            {state.error && (
              <p className="mt-2 text-sm font-medium text-rose-700 dark:text-rose-400">
                {state.error}
              </p>
            )}
          </div>
        </div>
      )}
    </main>
  )
}
