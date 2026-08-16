// Not `server-only`: reachable from a CLI when a group is set up ahead of a
// signature, and the guard throws outside a React Server Component context.
import { eq } from 'drizzle-orm'
import { getDb, schema } from '@/db/client'
import { getStripe } from './stripe'
import { ourMetadata, toMirror } from './stripe-map'
import { PRICE_LOOKUP_KEY } from './plans'
import { recordChange } from './subscription-ops'

/**
 * How dealer groups actually pay.
 *
 * ---------------------------------------------------------------------------
 * THE CARD RAIL IS THE LESS COMMON CASE
 * ---------------------------------------------------------------------------
 * Everything built so far assumes a card on file, which suits a self-serve
 * signup and almost no franchise dealer group. A group has an accounts payable
 * department, a purchase order, and terms — and the person who signs the
 * contract has no authority to put $20,000 a month on a card even if they
 * wanted to.
 *
 * This is the same subscription, the same price, the same webhooks and the
 * same lifecycle. Only the collection method changes: Stripe emails an invoice
 * with a due date instead of charging a card, and the dealership pays it by
 * ACH or card from the hosted page. That sameness is the entire design — one
 * pipeline, so every lifecycle state, every dunning transition and every
 * reconciliation works identically on both rails.
 *
 * ---------------------------------------------------------------------------
 * WHAT ACH NEEDS THAT CODE CANNOT PROVIDE
 * ---------------------------------------------------------------------------
 * Bank debits are a dashboard setting on the Stripe account, not a parameter
 * here. Deliberately: `payment_method_types` is never passed, so Stripe offers
 * whatever the account has enabled and the invoice adapts on its own. Enable
 * ACH once, in the dashboard, and every invoice from that point offers it.
 * Hardcoding it here would lock out everything else and would have to be
 * revisited every time a payment method is added.
 */

export interface InvoiceRailTerms {
  /** Where invoices go. Accounts payable, usually — not the signer. */
  billingEmail: string
  /** The legal entity, where it differs from the trading name. */
  billingName?: string | null
  /** Echoed onto every invoice. AP rejects an invoice without it, silently. */
  poNumber?: string | null
  /** 30, 45 or 60. Anything else is an exception somebody agreed to. */
  netTermsDays: number
}

export type RailResult =
  | { ok: true; subscriptionId: string; invoiceUrl: string | null }
  | { ok: false; reason: string }

/**
 * Put a dealer group on invoiced billing.
 *
 * Creates the Stripe subscription with `collection_method: send_invoice`, or
 * converts an existing card subscription across. Either way the tenant keeps
 * its lifecycle status — moving to ACTIVE is the webhook's job when the first
 * invoice is actually paid, exactly as on the card rail. Marking somebody
 * active because we sent them a bill would be the same mistake as trusting a
 * checkout success page.
 */
export async function putOnInvoiceRail(
  organizationId: string,
  rooftops: number,
  terms: InvoiceRailTerms,
  opts: { changedByUserId?: string | null; reason?: string | null } = {},
): Promise<RailResult> {
  if (!Number.isInteger(rooftops) || rooftops < 1) {
    return { ok: false, reason: 'A subscription bills for at least one rooftop.' }
  }
  if (![30, 45, 60].includes(terms.netTermsDays)) {
    return { ok: false, reason: 'Net terms are 30, 45 or 60 days.' }
  }
  if (!terms.billingEmail.includes('@')) {
    return { ok: false, reason: 'Enter the accounts payable email address.' }
  }

  const db = getDb()
  const stripe = getStripe()

  const [account] = await db
    .select({
      id: schema.billingAccounts.id,
      stripeCustomerId: schema.billingAccounts.stripeCustomerId,
    })
    .from(schema.billingAccounts)
    .where(eq(schema.billingAccounts.organizationId, organizationId))
    .limit(1)

  const [org] = await db
    .select({ name: schema.organizations.name })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, organizationId))
    .limit(1)

  if (!org) return { ok: false, reason: 'No such dealer group.' }

  try {
    // ---- the price, by lookup key rather than id. See ./plans.
    const prices = await stripe.prices.list({
      lookup_keys: [PRICE_LOOKUP_KEY], active: true, limit: 1,
    })
    const price = prices.data[0]
    if (!price) {
      return { ok: false, reason: `No active Stripe price with lookup key "${PRICE_LOOKUP_KEY}".` }
    }

    // ---- the customer, carrying the terms Stripe needs to render an invoice
    let customerId = account?.stripeCustomerId ?? null
    const customerFields = {
      name: terms.billingName || org.name,
      email: terms.billingEmail,
      metadata: ourMetadata(organizationId),
      invoice_settings: {
        /*
          The PO number as a custom field on every invoice.

          Not decoration. A dealer group's AP department rejects an invoice
          that does not carry the PO they raised, and the rejection arrives as
          silence — the invoice simply ages until somebody chases it, by which
          time the account is past due for a reason nobody can see.
        */
        custom_fields: terms.poNumber
          ? [{ name: 'PO Number', value: terms.poNumber.slice(0, 30) }]
          : null,
      },
    }

    if (customerId) {
      await stripe.customers.update(customerId, customerFields)
    } else {
      const created = await stripe.customers.create(customerFields)
      customerId = created.id
    }

    // ---- existing subscription: convert it rather than create a second
    const [existing] = account
      ? await db
          .select({
            id: schema.subscriptions.id,
            stripeSubscriptionId: schema.subscriptions.stripeSubscriptionId,
            rooftopQuantity: schema.subscriptions.rooftopQuantity,
          })
          .from(schema.subscriptions)
          .where(eq(schema.subscriptions.billingAccountId, account.id))
          .limit(1)
      : []

    let stripeSubscriptionId: string

    if (existing?.stripeSubscriptionId) {
      /*
        Converted in place. Creating a second subscription would bill the
        dealership twice until somebody noticed, and "noticed" here means an
        invoice arriving at an AP department that already pays us.
      */
      const updated = await stripe.subscriptions.update(existing.stripeSubscriptionId, {
        collection_method: 'send_invoice',
        days_until_due: terms.netTermsDays,
      })
      stripeSubscriptionId = updated.id
    } else {
      const created = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: price.id, quantity: rooftops }],
        collection_method: 'send_invoice',
        days_until_due: terms.netTermsDays,
        metadata: ourMetadata(organizationId),
        // No `payment_method_types`. Stripe offers whatever the account has
        // enabled — see the header on ACH.
      })
      stripeSubscriptionId = created.id
    }

    const fresh = await stripe.subscriptions.retrieve(stripeSubscriptionId)
    const mirror = toMirror(fresh as never)

    // ---- our tables
    const billingAccountId = await db.transaction(async (tx) => {
      let id = account?.id
      if (id) {
        await tx.update(schema.billingAccounts).set({
          stripeCustomerId: customerId,
          collectionMode: 'INVOICE',
          billingEmail: terms.billingEmail,
          billingName: terms.billingName ?? null,
          poNumber: terms.poNumber ?? null,
          netTermsDays: terms.netTermsDays,
          updatedAt: new Date(),
        }).where(eq(schema.billingAccounts.id, id))
      } else {
        const [created] = await tx.insert(schema.billingAccounts).values({
          organizationId,
          stripeCustomerId: customerId,
          collectionMode: 'INVOICE',
          billingEmail: terms.billingEmail,
          billingName: terms.billingName ?? null,
          poNumber: terms.poNumber ?? null,
          netTermsDays: terms.netTermsDays,
        }).returning({ id: schema.billingAccounts.id })
        id = created!.id
      }

      if (existing) {
        await tx.update(schema.subscriptions).set({
          stripeSubscriptionId: mirror.stripeSubscriptionId,
          status: mirror.status,
          rooftopQuantity: mirror.rooftopQuantity,
          currentPeriodEnd: mirror.currentPeriodEnd,
          updatedAt: new Date(),
        }).where(eq(schema.subscriptions.id, existing.id))

        await recordChange(tx, {
          subscriptionId: existing.id,
          kind: 'COLLECTION_MODE',
          before: { mode: 'CARD' },
          after: { mode: 'INVOICE', netTermsDays: terms.netTermsDays, poNumber: terms.poNumber ?? null },
          changedByUserId: opts.changedByUserId,
          reason: opts.reason,
        })
      } else {
        const [createdSub] = await tx.insert(schema.subscriptions).values({
          billingAccountId: id,
          stripeSubscriptionId: mirror.stripeSubscriptionId,
          planKey: 'STANDARD',
          status: mirror.status,
          rooftopQuantity: mirror.rooftopQuantity,
          currentPeriodEnd: mirror.currentPeriodEnd,
          trialEndsAt: mirror.trialEndsAt,
        }).returning({ id: schema.subscriptions.id })

        await recordChange(tx, {
          subscriptionId: createdSub!.id,
          kind: 'COLLECTION_MODE',
          before: null,
          after: { mode: 'INVOICE', netTermsDays: terms.netTermsDays, rooftops: mirror.rooftopQuantity },
          changedByUserId: opts.changedByUserId,
          reason: opts.reason,
        })
      }

      return id
    })

    void billingAccountId

    /*
      The first invoice's hosted page, when Stripe has already drafted one.

      Handed back so a support engineer can send the link directly rather than
      waiting for the email to arrive and asking whether it did. Absent is
      normal — an invoice at the start of a period may not exist yet.
    */
    const invoices = await stripe.invoices.list({ customer: customerId, limit: 1 })
    const invoiceUrl = invoices.data[0]?.hosted_invoice_url ?? null

    return { ok: true, subscriptionId: stripeSubscriptionId, invoiceUrl }
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause)
    return { ok: false, reason: `Stripe refused: ${why}` }
  }
}
