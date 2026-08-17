// Not `server-only`: the provisioning path is also reachable from a CLI script
// when a dealership is stood up ahead of a demo. It still cannot reach a
// browser — it imports the scoped database client.
import { and, desc, eq, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm'
import { getDb, schema } from '@/db/client'
import { withCurrentUserScope } from '@/db/scoped'
import { lifecycleHistory } from '@/lib/billing/store'
import type { LifecycleStatus } from '@/lib/billing/lifecycle'
import { monthlyTotalCents } from '@/lib/billing/plans'
import { loadProgressForPlatform } from '@/lib/onboarding/load'
import type { OnboardingProgress } from '@/lib/onboarding/steps'

/**
 * The operational view of the platform.
 *
 * Every query here runs under the caller's row-level security, exactly like the
 * dealership surfaces do. That is deliberate: the admin console is not allowed
 * a privileged connection, so the boundary between "operational metadata" and
 * "a dealership's customers" is enforced by the same policies as everything
 * else rather than by this file remembering to be careful. Migration 0016 is
 * where that boundary is actually drawn.
 *
 * The practical consequence is worth stating: a platform admin who queries
 * customers through here gets nothing back. Not an error, not a partial list —
 * nothing. That is the design working.
 */

export interface TenantSummary {
  storeId: string
  storeName: string
  organizationId: string
  organizationName: string
  franchiseMake: string | null
  state: string | null
  isActive: boolean
  createdAt: Date
  staffCount: number
  pendingInvites: number
  /** Last price sync, so a silently broken integration is visible. */
  lastSyncAt: Date | null
  lastSyncStatus: string | null
  lastSyncSummary: string | null
  /** Where they stand commercially. Read next to sync health, deliberately. */
  lifecycleStatus: LifecycleStatus
  lifecycleChangedAt: Date
  trialEndsAt: Date | null
  /**
   * What this rooftop's group bills per month, in cents.
   *
   * Computed from the catalog and the group's rooftop count rather than asked
   * of Stripe. Rendering this page must not depend on a third-party API being
   * up, and an aggregate-of-Stripe call per tenant would make the one screen
   * somebody leaves open all day the slowest in the product.
   *
   * Null for a group with no subscription — a trial or a comp bills nothing,
   * and showing them a number would misstate the pipeline.
   */
  monthlyCents: number | null
}

export async function loadTenants(): Promise<TenantSummary[]> {
  return withCurrentUserScope(async (db) => {
    const stores = await db
      .select({
        storeId: schema.stores.id,
        storeName: schema.stores.name,
        organizationId: schema.organizations.id,
        organizationName: schema.organizations.name,
        franchiseMake: schema.stores.franchiseMake,
        state: schema.stores.state,
        isActive: schema.stores.isActive,
        createdAt: schema.stores.createdAt,
        lifecycleStatus: schema.organizations.lifecycleStatus,
        lifecycleChangedAt: schema.organizations.lifecycleChangedAt,
        trialEndsAt: schema.organizations.trialEndsAt,
      })
      .from(schema.stores)
      .innerJoin(schema.organizations, eq(schema.organizations.id, schema.stores.organizationId))
      .orderBy(schema.stores.name)

    if (stores.length === 0) return []

    /*
      Counted in one pass each rather than per store.

      A group with forty rooftops would otherwise be a hundred and twenty
      round trips, and this page is the one somebody leaves open all day.
    */
    const staff = await db
      .select({
        storeId: schema.userStoreRoles.storeId,
        n: sql<number>`count(*)::int`,
      })
      .from(schema.userStoreRoles)
      .where(eq(schema.userStoreRoles.isActive, true))
      .groupBy(schema.userStoreRoles.storeId)

    const invites = await db
      .select({
        storeId: schema.storeInvitations.storeId,
        n: sql<number>`count(*)::int`,
      })
      .from(schema.storeInvitations)
      .where(and(
        isNull(schema.storeInvitations.acceptedAt),
        isNull(schema.storeInvitations.revokedAt),
      ))
      .groupBy(schema.storeInvitations.storeId)

    // Newest sync per store. DISTINCT ON is the one place raw SQL beats the
    // query builder for readability.
    const syncs = await db.execute(sql`
      SELECT DISTINCT ON (store_id)
        store_id, started_at, status, summary
      FROM pricing_sync_runs
      ORDER BY store_id, started_at DESC
    `) as unknown as {
      store_id: string; started_at: string; status: string; summary: string
    }[]

    /*
      Rooftops per group, so MRR is the group's bill rather than a rooftop's
      share of it. Volume pricing means the two are not proportional — the
      per-rooftop rate depends on how many the group has.
    */
    const rooftopsByOrg = new Map<string, number>()
    for (const s of stores) {
      if (!s.isActive) continue
      rooftopsByOrg.set(s.organizationId, (rooftopsByOrg.get(s.organizationId) ?? 0) + 1)
    }

    const billed = await db
      .select({
        organizationId: schema.billingAccounts.organizationId,
        status: schema.subscriptions.status,
      })
      .from(schema.subscriptions)
      .innerJoin(
        schema.billingAccounts,
        eq(schema.billingAccounts.id, schema.subscriptions.billingAccountId),
      )

    // Only a subscription that actually bills counts toward MRR. A cancelled
    // or comped one is revenue that is not arriving.
    const billingOrgs = new Set(
      billed.filter((b) => b.status === 'ACTIVE' || b.status === 'PAST_DUE')
        .map((b) => b.organizationId),
    )

    const staffBy = new Map(staff.map((s) => [s.storeId, s.n]))
    const invitesBy = new Map(invites.map((i) => [i.storeId, i.n]))
    const syncBy = new Map(syncs.map((s) => [s.store_id, s]))

    return stores.map((s) => {
      const sync = syncBy.get(s.storeId)
      return {
        ...s,
        staffCount: staffBy.get(s.storeId) ?? 0,
        pendingInvites: invitesBy.get(s.storeId) ?? 0,
        lastSyncAt: sync ? new Date(sync.started_at) : null,
        lastSyncStatus: sync?.status ?? null,
        lastSyncSummary: sync?.summary ?? null,
        monthlyCents: billingOrgs.has(s.organizationId)
          ? monthlyTotalCents(rooftopsByOrg.get(s.organizationId) ?? 0)
          : null,
      }
    })
  })
}

/**
 * What needs somebody today, across every tenant.
 *
 * ---------------------------------------------------------------------------
 * THE PAGE EXISTS TO ANSWER ONE QUESTION
 * ---------------------------------------------------------------------------
 * "What needs me?" — and it could not answer it. The console listed stale
 * syncs and uncontacted leads and nothing else, so a failed webhook appeared
 * nowhere at all, a past-due dealership looked identical to a healthy one
 * until somebody opened its page, and a trial ending on Friday was invisible
 * until it had ended.
 *
 * Each count below is a thing somebody has to do something about. Anything
 * that is merely interesting belongs on a tenant page, not here — a rollup
 * that includes things you cannot act on is one people stop reading.
 *
 * Counted rather than listed. The numbers are the alarm; the tenant pages
 * behind them are where the detail lives.
 */
export interface NeedsAttention {
  /** Behind on payment but still working. Recoverable, and worth a call. */
  pastDue: number
  /** Past grace: administrative surface withdrawn. Escalating. */
  restricted: number
  /** Switched off by a human. Here so nobody forgets one is switched off. */
  suspended: number
  /** Trials ending within a week — the window where a call still changes it. */
  trialsEndingSoon: number
  /** Expired trials nobody converted. */
  trialsExpired: number
  /**
   * Webhook deliveries the handler accepted and could not apply.
   *
   * Invisible everywhere else. Stripe stops retrying eventually, and a
   * subscription that never activated because one event failed looks exactly
   * like a customer who never paid.
   */
  failedWebhooks: number
  /** Stripe events that carried no DealerTech metadata. Should be zero. */
  foreignWebhooks: number
  /** Price syncs that refused or failed on their last run. */
  failingSyncs: number
  uncontactedLeads: number
}

/**
 * Runs privileged, and only counts.
 *
 * `stripe_events` is platform-only by policy so the scoped connection would
 * see it fine, but the sync and lifecycle counts span every tenant and the
 * page is a rollup rather than a tenant view. Integers only — the same line
 * drawn in loadProgressForPlatform: counting is not reading.
 */
export async function loadNeedsAttention(): Promise<NeedsAttention> {
  const db = getDb()

  const byStatus = await db
    .select({ status: schema.organizations.lifecycleStatus, n: sql<number>`count(*)::int` })
    .from(schema.organizations)
    .groupBy(schema.organizations.lifecycleStatus)

  const countFor = (status: LifecycleStatus) =>
    byStatus.find((r) => r.status === status)?.n ?? 0

  const soon = new Date(Date.now() + 7 * 86_400_000)
  const [endingSoon] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.organizations)
    .where(and(
      eq(schema.organizations.lifecycleStatus, 'TRIAL'),
      isNotNull(schema.organizations.trialEndsAt),
      lte(schema.organizations.trialEndsAt, soon),
    ))

  const [failedHooks] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.stripeEvents)
    .where(isNotNull(schema.stripeEvents.error))

  const [foreignHooks] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.stripeEvents)
    .where(eq(schema.stripeEvents.relevant, false))

  /*
    The newest sync per store, then the ones that did not say OK.

    DISTINCT ON rather than a window function for the same reason loadTenants
    uses it — this is the one place raw SQL reads better than the builder.
  */
  const failing = (await db.execute(sql`
    SELECT count(*)::int AS n FROM (
      SELECT DISTINCT ON (store_id) status
      FROM pricing_sync_runs
      ORDER BY store_id, started_at DESC
    ) latest
    WHERE latest.status <> 'OK'
  `)) as unknown as { n: number }[]

  const [leads] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.demoRequests)
    .where(eq(schema.demoRequests.contacted, false))

  return {
    pastDue: countFor('PAST_DUE'),
    restricted: countFor('RESTRICTED'),
    suspended: countFor('SUSPENDED'),
    trialsEndingSoon: endingSoon?.n ?? 0,
    trialsExpired: countFor('EXPIRED'),
    failedWebhooks: failedHooks?.n ?? 0,
    foreignWebhooks: foreignHooks?.n ?? 0,
    failingSyncs: failing[0]?.n ?? 0,
    uncontactedLeads: leads?.n ?? 0,
  }
}

export interface Lead {
  id: string
  name: string
  email: string
  phone: string | null
  dealershipName: string
  role: string | null
  rooftops: number | null
  dms: string | null
  message: string | null
  /**
   * Where they came from, captured without cookies or third-party scripts.
   *
   * Carried on the full leads page and not on the operations summary. It is
   * the difference between a referral and a cold form fill, which changes how
   * the call opens — but it is not worth a line on the morning read.
   */
  source: string | null
  referrer: string | null
  contacted: boolean
  contactedAt: Date | null
  /** What happened when somebody rang them. */
  notes: string | null
  createdAt: Date
}

/**
 * Inbound demo requests.
 *
 * These have been captured since the marketing site went up and never shown
 * anywhere, which means every one of them has sat unread. Ordered uncontacted
 * first and newest first within that, because a three-day-old lead nobody rang
 * is worth more attention than a fresh one somebody already has.
 *
 * Reads under the console's own row-level security, which works here and is
 * worth saying why: migration 0016 grants platform staff a read policy on
 * `demo_requests`, and 0017 added the table grant that policy needed to mean
 * anything. Both were required — a policy without a grant raises "permission
 * denied", which looks nothing like a policy problem.
 */
export async function loadLeads(limit = 50, opts: { uncontactedOnly?: boolean } = {}): Promise<Lead[]> {
  return withCurrentUserScope(async (db) => {
    const rows = await db
      .select()
      .from(schema.demoRequests)
      .where(opts.uncontactedOnly ? eq(schema.demoRequests.contacted, false) : undefined)
      .orderBy(schema.demoRequests.contacted, desc(schema.demoRequests.createdAt))
      .limit(limit)

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      phone: r.phone,
      dealershipName: r.dealershipName,
      role: r.role,
      rooftops: r.rooftops,
      dms: r.dms,
      message: r.message,
      source: r.source,
      referrer: r.referrer,
      contacted: r.contacted,
      contactedAt: r.contactedAt,
      notes: r.notes,
      createdAt: r.createdAt,
    }))
  })
}

/**
 * How many leads there are, and how many nobody has rung.
 *
 * Two aggregates rather than counting a loaded list, because the list is
 * filtered — with "not contacted" selected, the rows in hand cannot say how
 * many contacted ones exist, and a tab reading "All (4)" next to "Not
 * contacted (4)" is a plausible wrong number of exactly the kind this console
 * has shipped before. Counting separately is also what keeps the page from
 * loading five hundred rows to render two integers.
 */
export async function loadLeadCounts(): Promise<{ total: number; uncontacted: number }> {
  return withCurrentUserScope(async (db) => {
    const [row] = await db
      .select({
        total: sql<number>`count(*)::int`,
        // Parenthesised before the cast. `count(*) filter (...)::int` leans on
        // how tightly `::` binds against the FILTER clause, and a query that
        // parses by luck is one that stops parsing when somebody edits it.
        uncontacted: sql<number>`(count(*) filter (where contacted = false))::int`,
      })
      .from(schema.demoRequests)

    return { total: row?.total ?? 0, uncontacted: row?.uncontacted ?? 0 }
  })
}

export interface JobRun {
  storeId: string
  storeName: string
  status: string
  summary: string
  quarantinedCount: number
  startedAt: Date
}

/**
 * One dealer group in full, for the tenant page.
 *
 * Returns null rather than throwing when the id does not resolve — which
 * covers both a bad uuid in the URL and, importantly, a caller who is not
 * platform staff: the RLS policies simply return no rows, and the page turns
 * that into a 404 like every other unknown id. The console does not announce
 * itself to people who should not be looking at it.
 *
 * Note what this deliberately does not fetch: a single customer, vehicle or
 * repair order. The policies would refuse anyway (migration 0016), but the
 * query does not ask, so nobody reading this file later mistakes the console
 * for something that can.
 */
export async function loadTenantDetail(organizationId: string) {
  return withCurrentUserScope(async (db) => {
    const [org] = await db
      .select({
        id: schema.organizations.id,
        name: schema.organizations.name,
        slug: schema.organizations.slug,
        lifecycleStatus: schema.organizations.lifecycleStatus,
        lifecycleChangedAt: schema.organizations.lifecycleChangedAt,
        trialEndsAt: schema.organizations.trialEndsAt,
        createdAt: schema.organizations.createdAt,
      })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, organizationId))
      .limit(1)

    if (!org) return null

    const stores = await db
      .select({
        id: schema.stores.id,
        name: schema.stores.name,
        franchiseMake: schema.stores.franchiseMake,
        state: schema.stores.state,
        laborRate: schema.stores.laborRate,
        isActive: schema.stores.isActive,
        createdAt: schema.stores.createdAt,
      })
      .from(schema.stores)
      .where(eq(schema.stores.organizationId, organizationId))
      .orderBy(schema.stores.name)

    const storeIds = stores.map((s) => s.id)

    // Sequential rather than Promise.all: one transaction is one connection,
    // so parallel queries inside a scope serialise anyway. See src/db/README.md.
    const staff = storeIds.length === 0 ? [] : await db
      .select({
        // The role row's own id, not the user's — revoking support access
        // targets one grant, and a person can hold a role at several rooftops.
        roleId: schema.userStoreRoles.id,
        storeId: schema.userStoreRoles.storeId,
        userId: schema.userStoreRoles.userId,
        name: schema.users.fullName,
        email: schema.users.email,
        role: schema.userStoreRoles.role,
        expiresAt: schema.userStoreRoles.expiresAt,
        lastSeenAt: schema.users.lastSeenAt,
      })
      .from(schema.userStoreRoles)
      .innerJoin(schema.users, eq(schema.users.id, schema.userStoreRoles.userId))
      .where(and(
        eq(schema.userStoreRoles.isActive, true),
        inArray(schema.userStoreRoles.storeId, storeIds),
      ))

    const history = await lifecycleHistory(db, organizationId)

    /*
      Onboarding progress per rooftop, next to the commercial state.

      Deliberately on the same page as billing rather than a separate screen.
      A tenant that never presents a menu is a churn certainty whatever their
      invoice says, and the two facts are only useful side by side — "paying
      and never activated" is the row worth a phone call, and it is invisible
      if the numbers live apart.
    */
    const onboarding: { storeId: string; storeName: string; progress: OnboardingProgress }[] = []
    for (const store of stores) {
      /*
        Count-only and privileged — see loadProgressForPlatform.

        Read under the console's own row-level security this returns zero for
        op codes, declines, roster and presentations, because migration 0016
        withholds all four from platform staff. Every tenant would report "0 of
        8 steps, never presented", which is worse than showing nothing: it
        renders plausibly and is wrong in the same direction every time.
      */
      const p = await loadProgressForPlatform(store.id)
      if (p) onboarding.push({ storeId: store.id, storeName: store.name, progress: p })
    }

    const [billing] = await db
      .select({
        id: schema.billingAccounts.id,
        stripeCustomerId: schema.billingAccounts.stripeCustomerId,
        collectionMode: schema.billingAccounts.collectionMode,
        billingEmail: schema.billingAccounts.billingEmail,
        poNumber: schema.billingAccounts.poNumber,
        netTermsDays: schema.billingAccounts.netTermsDays,
      })
      .from(schema.billingAccounts)
      .where(eq(schema.billingAccounts.organizationId, organizationId))
      .limit(1)

    const subscription = billing
      ? (await db
          .select({
            id: schema.subscriptions.id,
            // Carried so the console can deep-link into Stripe rather than
            // re-render its billing UI — see the tenant page.
            stripeSubscriptionId: schema.subscriptions.stripeSubscriptionId,
            planKey: schema.subscriptions.planKey,
            status: schema.subscriptions.status,
            rooftopQuantity: schema.subscriptions.rooftopQuantity,
            currentPeriodEnd: schema.subscriptions.currentPeriodEnd,
            cancelAtPeriodEnd: schema.subscriptions.cancelAtPeriodEnd,
          })
          .from(schema.subscriptions)
          .where(eq(schema.subscriptions.billingAccountId, billing.id))
          .limit(1))[0] ?? null
      : null

    return { org, stores, staff, history, onboarding, billing: billing ?? null, subscription }
  })
}

export type TenantDetail = NonNullable<Awaited<ReturnType<typeof loadTenantDetail>>>

/** Recent price syncs across every tenant, worst first. */
export async function loadRecentJobRuns(limit = 25): Promise<JobRun[]> {
  return withCurrentUserScope(async (db) => {
    const rows = await db
      .select({
        storeId: schema.pricingSyncRuns.storeId,
        storeName: schema.stores.name,
        status: schema.pricingSyncRuns.status,
        summary: schema.pricingSyncRuns.summary,
        quarantinedCount: schema.pricingSyncRuns.quarantinedCount,
        startedAt: schema.pricingSyncRuns.startedAt,
      })
      .from(schema.pricingSyncRuns)
      .innerJoin(schema.stores, eq(schema.stores.id, schema.pricingSyncRuns.storeId))
      .orderBy(desc(schema.pricingSyncRuns.startedAt))
      .limit(limit)
    return rows
  })
}
