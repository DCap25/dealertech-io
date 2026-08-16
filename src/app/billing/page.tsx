import { and, count, eq } from 'drizzle-orm'
import { WorkspaceNav } from '@/components/auth/workspace-nav'
import { schema } from '@/db/client'
import { withCurrentUserScope } from '@/db/scoped'
import { requireUser } from '@/lib/auth/session'
import { canManageStaff } from '@/lib/team/roster'
import { formatCents, bandFor, monthlyTotalCents } from '@/lib/billing/plans'
import { BillingButtons } from './billing-buttons'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Billing' }

/**
 * What this dealership pays, and how to change it.
 *
 * ---------------------------------------------------------------------------
 * DELIBERATELY PLAIN
 * ---------------------------------------------------------------------------
 * This product's whole argument is that a customer should never be surprised
 * by a price. Applying that to our own invoice is not a cute parallel — a
 * dealership that cannot work out what DealerTech charges them has no reason
 * to believe the coverage numbers we put in front of their customers.
 *
 * So the arithmetic is shown, not just the total: the rooftop count, the rate
 * that count earns, and what those multiply to. Invoices and card details live
 * in Stripe's portal rather than being re-rendered here.
 */
export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>
}) {
  const user = await requireUser()
  const { checkout } = await searchParams

  const detail = await withCurrentUserScope(async (db) => {
    const [store] = await db
      .select({
        organizationId: schema.stores.organizationId,
        organizationName: schema.organizations.name,
        lifecycleStatus: schema.organizations.lifecycleStatus,
        trialEndsAt: schema.organizations.trialEndsAt,
      })
      .from(schema.stores)
      .innerJoin(schema.organizations, eq(schema.organizations.id, schema.stores.organizationId))
      .where(eq(schema.stores.id, user.storeId))
      .limit(1)

    if (!store) return null

    const [rooftops] = await db
      .select({ n: count() })
      .from(schema.stores)
      .where(and(
        eq(schema.stores.organizationId, store.organizationId),
        eq(schema.stores.isActive, true),
      )) as [{ n: number }]

    const [account] = await db
      .select({ id: schema.billingAccounts.id, collectionMode: schema.billingAccounts.collectionMode })
      .from(schema.billingAccounts)
      .where(eq(schema.billingAccounts.organizationId, store.organizationId))
      .limit(1)

    const subscription = account
      ? (await db
          .select({
            status: schema.subscriptions.status,
            rooftopQuantity: schema.subscriptions.rooftopQuantity,
            currentPeriodEnd: schema.subscriptions.currentPeriodEnd,
            cancelAtPeriodEnd: schema.subscriptions.cancelAtPeriodEnd,
          })
          .from(schema.subscriptions)
          .where(eq(schema.subscriptions.billingAccountId, account.id))
          .limit(1))[0] ?? null
      : null

    return { ...store, rooftops: rooftops?.n ?? 0, hasAccount: Boolean(account), subscription }
  })

  if (!detail) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <p className="text-sm text-neutral-500">Could not resolve this dealership.</p>
      </main>
    )
  }

  const manages = canManageStaff(user.role)
  const band = bandFor(detail.rooftops)
  const monthly = monthlyTotalCents(detail.rooftops)
  const isPaying = detail.subscription?.status === 'ACTIVE'
    || detail.subscription?.status === 'PAST_DUE'

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="flex justify-end">
        <WorkspaceNav current="billing" />
      </div>

      <h1 className="mt-3 text-3xl font-bold tracking-tight">Billing</h1>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        {detail.organizationName}
      </p>

      {checkout === 'complete' && (
        <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          {/*
            Careful wording. The subscription is confirmed by the webhook, not
            by this redirect — a customer who closes the tab is still a
            customer, and one who lands here before Stripe's event arrives has
            not yet been moved. Saying "you're all set" would be a guess.
          */}
          Payment received. Your subscription will be active within a moment.
        </p>
      )}
      {checkout === 'cancelled' && (
        <p className="mt-4 rounded-xl bg-neutral-100 px-4 py-3 text-sm dark:bg-neutral-900">
          Checkout cancelled. Nothing was charged.
        </p>
      )}

      {/* The arithmetic, not just the total. */}
      <section className="mt-6 rounded-2xl border border-neutral-200 p-5 dark:border-neutral-800">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-neutral-500">
              Your plan
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums">
              {formatCents(monthly)}
              <span className="ml-1 text-base font-normal text-neutral-500">/ month</span>
            </p>
          </div>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            {detail.rooftops} rooftop{detail.rooftops === 1 ? '' : 's'} ×{' '}
            {formatCents(band.unitAmountCents)} <span className="text-neutral-500">({band.label})</span>
          </p>
        </div>

        {detail.subscription && (
          <dl className="mt-4 grid gap-3 border-t border-neutral-200 pt-4 text-sm sm:grid-cols-3 dark:border-neutral-800">
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-neutral-500">Status</dt>
              <dd className="mt-0.5">{detail.subscription.status.toLowerCase().replace('_', ' ')}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-neutral-500">
                {detail.subscription.cancelAtPeriodEnd ? 'Access until' : 'Renews'}
              </dt>
              <dd className="mt-0.5">
                {detail.subscription.currentPeriodEnd?.toISOString().slice(0, 10) ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-neutral-500">Billed for</dt>
              <dd className="mt-0.5">
                {detail.subscription.rooftopQuantity} rooftop
                {detail.subscription.rooftopQuantity === 1 ? '' : 's'}
              </dd>
            </div>
          </dl>
        )}

        {!detail.subscription && detail.lifecycleStatus === 'TRIAL' && (
          <p className="mt-4 border-t border-neutral-200 pt-4 text-sm text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
            You are on a trial
            {detail.trialEndsAt
              ? ` until ${detail.trialEndsAt.toISOString().slice(0, 10)}`
              : ''}
            . Nothing has been charged.
          </p>
        )}

        {detail.lifecycleStatus === 'COMPED' && (
          <p className="mt-4 border-t border-neutral-200 pt-4 text-sm text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
            This account is on a complimentary plan. There is nothing to pay.
          </p>
        )}
      </section>

      {manages ? (
        <BillingButtons showCheckout={!isPaying} showPortal={detail.hasAccount} />
      ) : (
        <p className="mt-5 text-sm text-neutral-500">
          A service manager or administrator can change this.
        </p>
      )}

      {/*
        Said plainly rather than buried. A dealership's rooftop count is the
        thing they are billed on, so how it changes should not be a mystery.
      */}
      <p className="mt-8 text-xs text-neutral-500">
        Rooftops are counted from the dealerships active on your account. Adding one changes your
        next invoice, and larger groups move to a lower per-rooftop rate automatically. Talk to us
        before opening a rooftop if you would like the change quoted first.
      </p>
    </main>
  )
}
