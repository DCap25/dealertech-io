'use client'

import { useActionState } from 'react'
import { openPortal, startCheckout, type BillingActionState } from './actions'

const INITIAL: BillingActionState = {}

/**
 * The two buttons.
 *
 * Both post to server actions that redirect to Stripe, so neither carries any
 * payment detail of its own — there is no card field anywhere in this
 * application, and that is a deliberate property rather than an omission.
 *
 * Rendered even when the account is past due. Gating the fix behind the
 * problem is the oldest trap in billing UX.
 */
export function BillingButtons({
  showCheckout,
  showPortal,
}: {
  showCheckout: boolean
  showPortal: boolean
}) {
  const [checkoutState, checkoutAction, checkoutPending] = useActionState(startCheckout, INITIAL)
  const [portalState, portalAction, portalPending] = useActionState(openPortal, INITIAL)

  return (
    <div className="mt-5">
      <div className="flex flex-wrap gap-3">
        {showCheckout && (
          <form action={checkoutAction}>
            <button
              type="submit"
              disabled={checkoutPending}
              className="touch-target rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
            >
              {checkoutPending ? 'Opening…' : 'Set up payment'}
            </button>
          </form>
        )}

        {showPortal && (
          <form action={portalAction}>
            <button
              type="submit"
              disabled={portalPending}
              className="touch-target rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
            >
              {portalPending ? 'Opening…' : 'Invoices & payment method'}
            </button>
          </form>
        )}
      </div>

      {(checkoutState.error || portalState.error) && (
        <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:bg-rose-950 dark:text-rose-200">
          {checkoutState.error ?? portalState.error}
        </p>
      )}
    </div>
  )
}
