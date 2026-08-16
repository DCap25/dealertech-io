// Deliberately NOT marked `server-only`: the reconciler runs from a CLI script
// as well as from a route handler, and the guard throws outside a React Server
// Component context. It cannot reach a browser regardless — the secret key is
// read from the environment, which does not exist there.
import Stripe from 'stripe'

/**
 * The Stripe client.
 *
 * ---------------------------------------------------------------------------
 * ITS OWN ACCOUNT
 * ---------------------------------------------------------------------------
 * DealerTech bills from `acct_1U57SyKD1OmZb0LX`, separate from The DAS Board's
 * account under the same login. That separation is what makes this file
 * simple: our webhook endpoint receives only our events, our catalog contains
 * only our products, and the statement descriptor on a dealership's card says
 * DEALERTECH rather than somebody else's brand.
 *
 * ---------------------------------------------------------------------------
 * A RESTRICTED KEY, AND IT REFUSES WHEN UNSET
 * ---------------------------------------------------------------------------
 * `STRIPE_SECRET_KEY` should be a restricted key — customers, subscriptions,
 * invoices, checkout, billing portal, prices — never the account secret key.
 * Nothing in this product needs to issue refunds or read Connect balances, and
 * a key that cannot do a thing cannot be tricked into doing it.
 *
 * Unset means throw, matching the cron endpoint: a billing integration that
 * quietly does nothing when misconfigured is worse than one that stops, since
 * the failure would look exactly like "no customers have paid yet".
 */

let cached: Stripe | null = null

export function getStripe(): Stripe {
  if (cached) return cached

  const key = process.env.STRIPE_SECRET_KEY
  if (!key) {
    throw new Error(
      'STRIPE_SECRET_KEY is not set. Billing is configured per environment and refuses rather than falling back — see DEPLOYING.md.',
    )
  }

  cached = new Stripe(key, {
    /*
      Pinned, not floating.

      Stripe changes response shapes between versions, and a client that
      follows the account's default version would have its payloads change
      under it the day somebody clicks upgrade in the dashboard — with the
      first symptom being a mis-mirrored subscription rather than an error.
    */
    apiVersion: '2026-07-29.dahlia',
    // Shows up in the Stripe dashboard's request log, which is where somebody
    // will be looking when they are trying to work out what made a call.
    appInfo: { name: 'DealerTech.io', url: 'https://dealertech.io' },
    // A drive waiting on a hung API call is worse than one told it failed.
    timeout: 20_000,
    maxNetworkRetries: 2,
  })

  return cached
}

/** True when billing is configured at all. Lets a page degrade rather than throw. */
export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY)
}

/** Test seam — lets a suite install a fake without touching the environment. */
export function setStripe(client: Stripe | null): void {
  cached = client
}
