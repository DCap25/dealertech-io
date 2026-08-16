import 'server-only'
import { eq } from 'drizzle-orm'
import { getDb, schema } from '@/db/client'
import { getStripe } from './stripe'
import { ourMetadata } from './stripe-map'
import { PRICE_LOOKUP_KEY } from './plans'

/**
 * Turning a trial into a paying subscription.
 *
 * ---------------------------------------------------------------------------
 * HOSTED CHECKOUT, NOT AN EMBEDDED FORM
 * ---------------------------------------------------------------------------
 * The dealership is redirected to Stripe, pays there, and comes back. Nothing
 * resembling a card number ever touches this application — no Stripe.js on our
 * pages, no PCI surface, no CSP to get subtly wrong. For a product whose
 * customers are covered "financial institutions" under the FTC Safeguards
 * Rule, the smallest possible payments footprint is the right one.
 *
 * ---------------------------------------------------------------------------
 * THE SUCCESS PAGE IS NOT WHERE ACCESS IS GRANTED
 * ---------------------------------------------------------------------------
 * A customer closing the tab after paying, a redirect that fails, a browser
 * that drops the return — none of those may cost a dealership the subscription
 * they just bought. So the success page says "thank you" and nothing else;
 * `checkout.session.completed` arriving at the webhook is what actually moves
 * the tenant. The page they land on is cosmetic by design.
 */

/**
 * The price, resolved by lookup key rather than id.
 *
 * Stripe prices are immutable — changing a number means creating a new price —
 * so a hardcoded `price_...` would mean a code change and a deploy every time
 * pricing moved. A lookup key is re-pointed in the dashboard instead.
 */
async function priceId(): Promise<string> {
  const stripe = getStripe()
  const found = await stripe.prices.list({
    lookup_keys: [PRICE_LOOKUP_KEY],
    active: true,
    limit: 1,
  })

  const price = found.data[0]
  if (!price) {
    throw new Error(
      `No active Stripe price with lookup key "${PRICE_LOOKUP_KEY}". Run the catalog setup before taking payments.`,
    )
  }
  return price.id
}

/**
 * Eight random letters, appended to the Checkout integration label.
 *
 * Stripe uses this to group and compare checkout flows in the dashboard. The
 * random suffix keeps one deployment's sessions distinguishable from another's
 * without encoding anything identifying in it.
 */
function integrationLabel(): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz'
  let suffix = ''
  for (let i = 0; i < 8; i++) {
    suffix += letters[Math.floor(Math.random() * letters.length)]
  }
  return `dealertech_rooftop_${suffix}`
}

/** The Stripe customer for this dealer group, created on first need. */
async function customerFor(
  organizationId: string,
  organizationName: string,
  email: string,
): Promise<string> {
  const db = getDb()

  const [account] = await db
    .select({ id: schema.billingAccounts.id, stripeCustomerId: schema.billingAccounts.stripeCustomerId })
    .from(schema.billingAccounts)
    .where(eq(schema.billingAccounts.organizationId, organizationId))
    .limit(1)

  if (account?.stripeCustomerId) return account.stripeCustomerId

  const customer = await getStripe().customers.create({
    name: organizationName,
    email,
    metadata: ourMetadata(organizationId),
  })

  if (account) {
    await db.update(schema.billingAccounts)
      .set({ stripeCustomerId: customer.id, updatedAt: new Date() })
      .where(eq(schema.billingAccounts.id, account.id))
  } else {
    await db.insert(schema.billingAccounts).values({
      organizationId,
      stripeCustomerId: customer.id,
      billingEmail: email,
      collectionMode: 'CARD',
    })
  }

  return customer.id
}

export interface CheckoutRequest {
  organizationId: string
  organizationName: string
  billingEmail: string
  /** Active rooftops. What they are billed for. */
  rooftops: number
  origin: string
}

/**
 * A hosted Checkout session for a subscription.
 *
 * Note what is deliberately absent: `payment_method_types`. Hardcoding it —
 * `['card']` being the tempting one — locks out every other method Stripe
 * could offer, including the bank debits that matter for dealer groups.
 * Omitting it lets the account's dashboard settings decide, which is where
 * that decision belongs.
 */
export async function createCheckoutSession(input: CheckoutRequest): Promise<string> {
  const stripe = getStripe()
  const customer = await customerFor(
    input.organizationId, input.organizationName, input.billingEmail,
  )

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer,
    integration_identifier: integrationLabel(),
    line_items: [{
      price: await priceId(),
      // Volume tiers on the price mean the band is chosen from this number.
      // Adding a rooftop is a quantity change and nothing else.
      quantity: Math.max(1, input.rooftops),
    }],
    subscription_data: {
      // Carried onto the subscription so the webhook can match it to a tenant
      // without a lookup — and so any object in the account is traceable.
      metadata: ourMetadata(input.organizationId),
    },
    /*
      Both URLs point at the console rather than the workspace.

      Whoever is buying is an administrator, not an advisor mid-drive, and
      landing them back where they started is less disorienting than dropping
      them into the drive of whichever rooftop happened to be active.
    */
    success_url: `${input.origin}/billing?checkout=complete`,
    cancel_url: `${input.origin}/billing?checkout=cancelled`,
    // Lets a dealer group's AP department put the invoice where it belongs.
    billing_address_collection: 'auto',
  })

  if (!session.url) throw new Error('Stripe returned a session with no URL.')
  return session.url
}

/**
 * The Stripe-hosted portal, for everything after the first payment.
 *
 * Updating a card, downloading invoices, cancelling — all of it lives here
 * rather than being rebuilt. Re-rendering Stripe's billing history in our own
 * UI would mean a second implementation of every edge case Stripe has already
 * handled, kept in sync forever, for no gain to a service manager who only
 * wants last month's invoice.
 */
export async function createPortalSession(
  organizationId: string,
  origin: string,
): Promise<string> {
  const db = getDb()

  const [account] = await db
    .select({ stripeCustomerId: schema.billingAccounts.stripeCustomerId })
    .from(schema.billingAccounts)
    .where(eq(schema.billingAccounts.organizationId, organizationId))
    .limit(1)

  if (!account?.stripeCustomerId) {
    throw new Error('This dealership has no billing account yet.')
  }

  const session = await getStripe().billingPortal.sessions.create({
    customer: account.stripeCustomerId,
    return_url: `${origin}/billing`,
  })

  return session.url
}
