// Not `server-only`: the provisioning path is also reachable from a CLI script
// when a dealership is stood up ahead of a demo. It still cannot reach a
// browser — it imports the scoped database client.
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { schema } from '@/db/client'
import { withCurrentUserScope } from '@/db/scoped'
import { lifecycleHistory } from '@/lib/billing/store'
import type { LifecycleStatus } from '@/lib/billing/lifecycle'
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
      }
    })
  })
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
  contacted: boolean
  createdAt: Date
}

/**
 * Inbound demo requests.
 *
 * These have been captured since the marketing site went up and never shown
 * anywhere, which means every one of them has sat unread. Ordered newest first
 * and uncontacted first, because a three-day-old lead nobody rang is worth more
 * attention than a fresh one somebody already has.
 */
export async function loadLeads(limit = 50): Promise<Lead[]> {
  return withCurrentUserScope(async (db) => {
    const rows = await db
      .select()
      .from(schema.demoRequests)
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
      contacted: r.contacted,
      createdAt: r.createdAt,
    }))
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
