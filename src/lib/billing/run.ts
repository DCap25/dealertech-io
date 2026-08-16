// Deliberately NOT marked `server-only`, matching lib/pricing/run.ts and
// lib/cadence/run.ts: this runs from a CLI as well as from a route handler,
// and the guard throws outside a React Server Component context.
import { count, eq } from 'drizzle-orm'
import { getDb, schema } from '@/db/client'
import { getStripe, isStripeConfigured } from './stripe'
import { dueTransition } from './lifecycle'
import { applyTransition } from './store'
import { toMirror } from './stripe-map'
import { diff, needsHuman, type Discrepancy } from './reconcile'

/**
 * The nightly billing job.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT IS FOR
 * ---------------------------------------------------------------------------
 * Two things that nothing else does.
 *
 * **It runs the clocks.** A trial expiring and a past-due account reaching the
 * end of its fourteen days are both events with no external trigger — Stripe
 * never sends a webhook saying "this trial you never converted has lapsed".
 * Without this job, `dueTransition` is a well-tested function nobody calls,
 * and every status only ever changes when somebody clicks something.
 *
 * **It catches what webhooks lost.** A delivery Stripe gave up retrying, an
 * event our handler failed and nobody replayed, a quantity somebody changed in
 * the Stripe dashboard directly. Webhooks are the fast path; this is the one
 * that is eventually right.
 *
 * ---------------------------------------------------------------------------
 * IT NEVER SUSPENDS ANYBODY
 * ---------------------------------------------------------------------------
 * Worth stating plainly, because this is the job with the most power to do
 * damage while nobody is watching. The lifecycle engine refuses
 * SUSPENDED_BY_ADMIN from any automatic actor, so the worst this can do is
 * move a tenant to RESTRICTED — which leaves the drive working. Switching a
 * dealership off stays a decision a person makes.
 */

export interface TenantResult {
  organizationId: string
  organizationName: string
  status: 'OK' | 'MOVED' | 'ATTENTION' | 'FAILED' | 'SKIPPED'
  summary: string
  discrepancies: Discrepancy[]
}

/** The clock half. Runs with or without Stripe configured. */
async function advanceClock(tenant: {
  id: string
  name: string
  lifecycleStatus: string
  lifecycleChangedAt: Date
  trialEndsAt: Date | null
}, asOf: Date): Promise<string | null> {
  const due = dueTransition(
    tenant.lifecycleStatus as never,
    tenant.lifecycleChangedAt,
    tenant.trialEndsAt,
    asOf,
  )
  if (!due) return null

  const moved = await applyTransition({
    organizationId: tenant.id,
    event: due,
    actor: 'RECONCILER',
    reason: `Scheduled: ${due} became due.`,
  })

  return moved.ok ? `${moved.from} → ${moved.to}` : null
}

/**
 * Reconcile and advance every tenant.
 *
 * Sequential, like the pricing sync. A group of forty rooftops answers a
 * rate-limited API far better one at a time, and this job has all night.
 */
export async function runBillingReconciliation(asOf = new Date()): Promise<TenantResult[]> {
  const db = getDb()

  const tenants = await db
    .select({
      id: schema.organizations.id,
      name: schema.organizations.name,
      lifecycleStatus: schema.organizations.lifecycleStatus,
      lifecycleChangedAt: schema.organizations.lifecycleChangedAt,
      trialEndsAt: schema.organizations.trialEndsAt,
    })
    .from(schema.organizations)

  const results: TenantResult[] = []

  for (const tenant of tenants) {
    try {
      const moved = await advanceClock(tenant, asOf)

      const [billing] = await db
        .select({ id: schema.billingAccounts.id })
        .from(schema.billingAccounts)
        .where(eq(schema.billingAccounts.organizationId, tenant.id))
        .limit(1)

      const local = billing
        ? (await db
            .select({
              id: schema.subscriptions.id,
              stripeSubscriptionId: schema.subscriptions.stripeSubscriptionId,
              status: schema.subscriptions.status,
              rooftopQuantity: schema.subscriptions.rooftopQuantity,
              currentPeriodEnd: schema.subscriptions.currentPeriodEnd,
              cancelAtPeriodEnd: schema.subscriptions.cancelAtPeriodEnd,
            })
            .from(schema.subscriptions)
            .where(eq(schema.subscriptions.billingAccountId, billing.id))
            .limit(1))[0] ?? null
        : null

      /*
        No subscription is not a discrepancy.

        A tenant on trial has not been asked for money yet, and a comped one
        never will be. Reporting either as "missing in Stripe" every night
        would fill the console with rows nobody can act on.
      */
      if (!local) {
        results.push({
          organizationId: tenant.id,
          organizationName: tenant.name,
          status: moved ? 'MOVED' : 'OK',
          summary: moved ?? `${tenant.lifecycleStatus}, no subscription yet.`,
          discrepancies: [],
        })
        continue
      }

      if (!isStripeConfigured()) {
        results.push({
          organizationId: tenant.id,
          organizationName: tenant.name,
          status: 'SKIPPED',
          summary: 'Clocks advanced; Stripe not configured, so nothing was reconciled.',
          discrepancies: [],
        })
        continue
      }

      const [{ n: activeStores }] = await db
        .select({ n: count() })
        .from(schema.stores)
        .where(eq(schema.stores.organizationId, tenant.id)) as [{ n: number }]

      let remote = null
      if (local.stripeSubscriptionId) {
        try {
          const fetched = await getStripe().subscriptions.retrieve(local.stripeSubscriptionId)
          remote = toMirror(fetched as never)
        } catch {
          // Left null — `diff` reports MISSING_IN_STRIPE, which is exactly
          // what an unretrievable subscription means for our purposes.
          remote = null
        }
      }

      const discrepancies = diff(local, remote, activeStores)

      // Only the mechanical ones. Quantity drift is a question, not a repair.
      const fixable = discrepancies.filter((d) => d.autoFixable)
      if (fixable.length > 0 && remote) {
        await db.update(schema.subscriptions).set({
          status: remote.status,
          currentPeriodEnd: remote.currentPeriodEnd,
          cancelAtPeriodEnd: remote.cancelAtPeriodEnd,
          trialEndsAt: remote.trialEndsAt,
          updatedAt: new Date(),
        }).where(eq(schema.subscriptions.id, local.id))
      }

      results.push({
        organizationId: tenant.id,
        organizationName: tenant.name,
        status: needsHuman(discrepancies) ? 'ATTENTION' : moved ? 'MOVED' : 'OK',
        summary: [
          moved,
          fixable.length > 0 ? `${fixable.length} mirror field(s) refreshed` : null,
          needsHuman(discrepancies) ? 'needs a decision' : null,
        ].filter(Boolean).join(' · ') || 'In step with Stripe.',
        discrepancies,
      })
    } catch (cause) {
      /*
        One tenant failing must not stop the rest.

        Same shape as the pricing sync: record it and move on, so an outage
        affecting one dealer group does not leave forty others with clocks
        that never advanced.
      */
      const why = cause instanceof Error ? cause.message : String(cause)
      results.push({
        organizationId: tenant.id,
        organizationName: tenant.name,
        status: 'FAILED',
        summary: why,
        discrepancies: [],
      })
    }
  }

  return results
}
