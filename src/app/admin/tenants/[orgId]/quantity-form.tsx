'use client'

import { useActionState, useState } from 'react'
import { previewProration, describeProration } from '@/lib/billing/proration'
import { changeRooftopQuantity, type TenantActionState } from '../actions'

const INITIAL: TenantActionState = {}

const field =
  'mt-1 w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-300'
const label = 'block text-xs font-semibold uppercase tracking-wide text-neutral-500'

/**
 * Changing the billed rooftop count, with the money shown first.
 *
 * ---------------------------------------------------------------------------
 * THE PREVIEW UPDATES AS YOU TYPE, AND THAT IS THE POINT
 * ---------------------------------------------------------------------------
 * `previewProration` is pure, so it runs here. Typing a new number shows what
 * it does to the monthly bill and what lands on the next invoice, before
 * anything is committed.
 *
 * Volume pricing makes this genuinely necessary rather than a nicety. A group
 * going from 25 to 26 rooftops sees their bill fall by about $1,700, because
 * every rooftop re-prices — not just the new one. A support engineer who
 * committed that change and then had to explain the invoice afterwards would
 * be doing it from a worse position than one who read it off the screen while
 * the dealer was still on the phone.
 */
export function QuantityForm({
  organizationId,
  currentQuantity,
  activeStores,
  periodStart,
  periodEnd,
}: {
  organizationId: string
  currentQuantity: number
  activeStores: number
  /** ISO strings — this is a client component and Dates do not cross cleanly. */
  periodStart: string | null
  periodEnd: string | null
}) {
  const [state, formAction, pending] = useActionState(changeRooftopQuantity, INITIAL)
  const [open, setOpen] = useState(false)
  // Defaults to the real store count, which is the answer in almost every case.
  const [quantity, setQuantity] = useState(String(activeStores || currentQuantity))

  const parsed = Number(quantity)
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= 500

  /*
    A month's window when Stripe has not told us the real one yet.

    Only affects the proration estimate, never the change itself — Stripe
    computes the real figure at invoice time regardless. A missing period
    would otherwise mean no preview at all, which is worse than an approximate
    one clearly labelled as approximate.
  */
  const start = periodStart ? new Date(periodStart) : new Date()
  const end = periodEnd
    ? new Date(periodEnd)
    : new Date(start.getTime() + 30 * 86_400_000)

  const preview = valid && parsed !== currentQuantity
    ? previewProration({
        fromRooftops: currentQuantity,
        toRooftops: parsed,
        periodStart: start,
        periodEnd: end,
        asOf: new Date(),
      })
    : null

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="touch-target rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-semibold hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
      >
        Change rooftop count
      </button>
    )
  }

  return (
    <form action={formAction} className="w-full rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <input type="hidden" name="organizationId" value={organizationId} />

      <p className="text-sm font-semibold">Change rooftop count</p>
      <p className="mt-0.5 text-xs text-neutral-500">
        Billing for {currentQuantity} · {activeStores} rooftop
        {activeStores === 1 ? '' : 's'} active on the account
      </p>

      <label className={`${label} mt-3`} htmlFor="quantity">Rooftops to bill for</label>
      <input
        id="quantity"
        name="quantity"
        type="number"
        min={1}
        max={500}
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        className={field}
      />

      {preview && (
        <div className="mt-3 rounded-lg bg-neutral-100 p-3 text-xs dark:bg-neutral-900">
          <p className="font-medium">{describeProration(preview)}</p>
          {preview.counterIntuitive && (
            <p className="mt-2 rounded bg-amber-100 px-2 py-1.5 font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              {preview.counterIntuitive}
            </p>
          )}
          <p className="mt-2 text-neutral-500">
            An estimate. Stripe works out the exact proration when it issues the invoice.
          </p>
        </div>
      )}

      <label className={`${label} mt-3`} htmlFor="quantity-reason">Reason</label>
      <input
        id="quantity-reason"
        name="reason"
        className={field}
        placeholder="Opened a third rooftop in Georgetown, effective this month"
      />

      <div className="mt-3 flex gap-2">
        <button
          type="submit"
          disabled={pending || !valid || parsed === currentQuantity}
          className="touch-target rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-neutral-900"
        >
          {pending ? 'Changing…' : 'Apply'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="touch-target rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-semibold hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          Cancel
        </button>
      </div>

      {state.error && (
        <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:bg-rose-950 dark:text-rose-200">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          {state.ok}
        </p>
      )}
    </form>
  )
}
