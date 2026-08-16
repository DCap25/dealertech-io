import { STRIPE_ACCOUNT_ID } from '@/lib/billing/account'

/**
 * Deep links into the Stripe dashboard.
 *
 * ---------------------------------------------------------------------------
 * WE DO NOT RE-RENDER STRIPE'S UI
 * ---------------------------------------------------------------------------
 * Invoices, payment state, disputes, receipts and dunning history all live in
 * Stripe and are already built there, correctly, for every edge case we would
 * otherwise reimplement. Copying that into this console would mean a second
 * implementation kept in sync forever, and it would be worse — for a support
 * engineer who needs last month's invoice, Stripe's own page is the answer.
 *
 * So the console links out. What it holds is the thing Stripe does not know:
 * which dealership this is, what they are entitled to, and why somebody
 * changed it.
 *
 * The account id is in the URL because this login owns more than one Stripe
 * account, and a link without it opens whichever was last viewed — which
 * during a support call is the wrong business's data on screen.
 */
export function StripeLink({
  path,
  children,
}: {
  /** Dashboard path after the account segment, e.g. `customers/cus_123`. */
  path: string
  children: React.ReactNode
}) {
  return (
    <a
      href={`https://dashboard.stripe.com/${STRIPE_ACCOUNT_ID}/${path}`}
      target="_blank"
      rel="noreferrer noopener"
      className="underline decoration-dotted underline-offset-2 hover:decoration-solid"
    >
      {children} ↗
    </a>
  )
}
