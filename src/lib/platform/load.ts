// Not `server-only`: the provisioning path is also reachable from a CLI script
// when a dealership is stood up ahead of a demo. It still cannot reach a
// browser — it imports the scoped database client.
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { schema } from '@/db/client'
import { withCurrentUserScope } from '@/db/scoped'

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
}

export async function loadTenants(): Promise<TenantSummary[]> {
  return withCurrentUserScope(async (db) => {
    const stores = await db
      .select({
        storeId: schema.stores.id,
        storeName: schema.stores.name,
        organizationName: schema.organizations.name,
        franchiseMake: schema.stores.franchiseMake,
        state: schema.stores.state,
        isActive: schema.stores.isActive,
        createdAt: schema.stores.createdAt,
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
