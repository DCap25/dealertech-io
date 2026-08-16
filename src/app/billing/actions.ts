'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { and, count, eq } from 'drizzle-orm'
import { schema } from '@/db/client'
import { withCurrentUserScope } from '@/db/scoped'
import { requireUser } from '@/lib/auth/session'
import { createCheckoutSession, createPortalSession } from '@/lib/billing/checkout'
import { canManageStaff } from '@/lib/team/roster'

/**
 * Starting and managing a subscription, from the dealership's side.
 *
 * ---------------------------------------------------------------------------
 * WHO IS ALLOWED
 * ---------------------------------------------------------------------------
 * The same three roles that can administer staff. An advisor must not be able
 * to reach a payment page — not because they would do anything wrong, but
 * because the person who spends the dealership's money is a specific person,
 * and a product that lets anyone with a login commit their employer to a
 * subscription is one a fixed-ops director cannot deploy.
 *
 * Deliberately NOT gated on access level. A dealership whose card failed must
 * still be able to reach the page that lets them fix it — gating the fix
 * behind the problem is the oldest trap in billing UX.
 */

export interface BillingActionState {
  error?: string
}

async function origin(): Promise<string> {
  // Built server-side so the return URL is right behind a proxy or on a
  // custom domain, rather than whatever the browser happens to think.
  const host = (await headers()).get('host') ?? ''
  const protocol = host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https'
  return `${protocol}://${host}`
}

export async function startCheckout(
  _previous: BillingActionState,
  _formData: FormData,
): Promise<BillingActionState> {
  const user = await requireUser()
  if (!canManageStaff(user.role)) {
    return { error: 'Only a service manager or administrator can set up billing.' }
  }

  let url: string
  try {
    const context = await withCurrentUserScope(async (db) => {
      const [store] = await db
        .select({
          organizationId: schema.stores.organizationId,
          organizationName: schema.organizations.name,
        })
        .from(schema.stores)
        .innerJoin(schema.organizations, eq(schema.organizations.id, schema.stores.organizationId))
        .where(eq(schema.stores.id, user.storeId))
        .limit(1)

      if (!store) return null

      /*
        Counted from the database, not asked for.

        The rooftop count is what they are billed for, and letting it arrive
        from a form field would mean a hand-edited request could buy a
        forty-rooftop group a one-rooftop subscription.
      */
      const [rooftops] = await db
        .select({ n: count() })
        .from(schema.stores)
        .where(and(
          eq(schema.stores.organizationId, store.organizationId),
          eq(schema.stores.isActive, true),
        )) as [{ n: number }]

      return { ...store, rooftops: rooftops?.n ?? 1 }
    })

    if (!context) return { error: 'Could not resolve this dealership.' }

    url = await createCheckoutSession({
      organizationId: context.organizationId,
      organizationName: context.organizationName,
      billingEmail: user.email,
      rooftops: context.rooftops,
      origin: await origin(),
    })
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause)
    return { error: `Could not start checkout: ${why}` }
  }

  // Outside the try: redirect() throws by design, and catching it would turn
  // a successful checkout into an error message.
  redirect(url)
}

export async function openPortal(
  _previous: BillingActionState,
  _formData: FormData,
): Promise<BillingActionState> {
  const user = await requireUser()
  if (!canManageStaff(user.role)) {
    return { error: 'Only a service manager or administrator can manage billing.' }
  }

  let url: string
  try {
    const organizationId = await withCurrentUserScope(async (db) => {
      const [store] = await db
        .select({ organizationId: schema.stores.organizationId })
        .from(schema.stores)
        .where(eq(schema.stores.id, user.storeId))
        .limit(1)
      return store?.organizationId ?? null
    })

    if (!organizationId) return { error: 'Could not resolve this dealership.' }
    url = await createPortalSession(organizationId, await origin())
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause)
    return { error: `Could not open the billing portal: ${why}` }
  }

  redirect(url)
}
