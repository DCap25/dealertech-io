// Deliberately NOT marked `server-only`, for the same reason as the cadence
// job: this runs from the morning CLI as well as from a route handler, and the
// guard throws outside a React Server Component context. It still cannot reach
// a browser — it imports the privileged database client, which can only be
// resolved on the server.
import { and, eq, inArray } from 'drizzle-orm'
import { getDb, schema } from '@/db/client'
import { getDmsAdapter } from '@/lib/dms/registry'
import { describePlan, planPriceSync, type SyncPlan } from './sync'

/**
 * The morning price sync.
 *
 * Pulls the dealership's priced operations from whatever DMS is configured and
 * brings the local book into line, so an advisor quoting at 7am is quoting
 * today's prices rather than whatever was true when the store was onboarded.
 *
 * Runs privileged and outside any user's session, like the nightly cadence job:
 * there is nobody signed in at six in the morning, and the row-level policies
 * are written against a person.
 */

export interface StoreSyncResult {
  storeId: string
  storeName: string
  status: 'OK' | 'REFUSED' | 'SKIPPED'
  summary: string
  quarantined: number
}

/** Sync one store. Never throws for an expected outcome — it records one. */
export async function syncStorePricing(
  storeId: string,
  storeName: string,
): Promise<StoreSyncResult> {
  const db = getDb()
  const adapter = getDmsAdapter()
  const vendor = adapter.capabilities.vendor
  const startedAt = new Date()

  const record = async (
    status: StoreSyncResult['status'],
    summary: string,
    plan: SyncPlan | null,
    detail: unknown = null,
  ): Promise<StoreSyncResult> => {
    await db.insert(schema.pricingSyncRuns).values({
      storeId, status, vendor, summary,
      createdCount: plan?.create.length ?? 0,
      updatedCount: plan?.update.length ?? 0,
      deactivatedCount: plan?.deactivate.length ?? 0,
      reactivatedCount: plan?.reactivate.length ?? 0,
      quarantinedCount: plan?.quarantined.length ?? 0,
      unchangedCount: plan?.unchanged ?? 0,
      detail: detail ?? null,
      startedAt,
      finishedAt: new Date(),
    })
    return { storeId, storeName, status, summary, quarantined: plan?.quarantined.length ?? 0 }
  }

  if (!adapter.capabilities.canPullPriceBook) {
    return record('SKIPPED', `${vendor} has no price book to pull.`, null)
  }

  let incoming: Awaited<ReturnType<typeof adapter.pullPriceBook>>
  try {
    incoming = await adapter.pullPriceBook(storeId)
  } catch (cause) {
    /*
      A failed pull is a normal Tuesday, not a crash.

      Recorded and moved past so one unreachable rooftop does not stop the rest
      of a group from syncing. The book is left exactly as it was, which is the
      safe direction.
    */
    const why = cause instanceof Error ? cause.message : String(cause)
    return record('REFUSED', `Could not reach ${vendor}: ${why}`, null)
  }

  if (incoming === null) {
    return record('SKIPPED', `${vendor} does not expose a price book for this store.`, null)
  }

  const existing = await db
    .select({
      id: schema.opCodes.id,
      code: schema.opCodes.code,
      description: schema.opCodes.description,
      laborHours: schema.opCodes.laborHours,
      laborAmount: schema.opCodes.laborAmount,
      partsAmount: schema.opCodes.partsAmount,
      isActive: schema.opCodes.isActive,
    })
    .from(schema.opCodes)
    .where(eq(schema.opCodes.storeId, storeId))

  const decision = planPriceSync(
    incoming,
    existing.map((e) => ({
      ...e,
      laborHours: e.laborHours === null ? null : Number(e.laborHours),
      laborAmount: e.laborAmount === null ? null : Number(e.laborAmount),
      partsAmount: e.partsAmount === null ? null : Number(e.partsAmount),
    })),
  )

  if (!decision.ok) {
    return record('REFUSED', decision.refusal.message, null, { kind: decision.refusal.kind })
  }

  const { plan } = decision
  const money = (n: number | null) => (n === null ? null : n.toFixed(2))

  for (const change of plan.update) {
    await db.update(schema.opCodes).set({
      description: change.description,
      laborHours: money(change.after.laborHours),
      laborAmount: money(change.after.laborAmount),
      partsAmount: money(change.after.partsAmount),
    }).where(eq(schema.opCodes.id, change.id))
  }

  if (plan.create.length > 0) {
    /*
      New codes arrive unmapped.

      componentGroupKey is ours, not the DMS's — it is what lets the coverage
      engine arbitrate who pays, and guessing it from a description would be
      inventing the one field the whole product reasons from. A new code shows
      up on the menu priced correctly and simply carries no coverage opinion
      until somebody maps it.
    */
    await db.insert(schema.opCodes).values(plan.create.map((c) => ({
      storeId,
      code: c.code,
      description: c.description,
      laborHours: money(c.laborHours),
      laborAmount: money(c.laborAmount),
      partsAmount: money(c.partsAmount),
      isActive: true,
    })))
  }

  if (plan.deactivate.length > 0) {
    await db.update(schema.opCodes)
      .set({ isActive: false })
      .where(and(
        eq(schema.opCodes.storeId, storeId),
        inArray(schema.opCodes.id, plan.deactivate.map((d) => d.id)),
      ))
  }

  if (plan.reactivate.length > 0) {
    await db.update(schema.opCodes)
      .set({ isActive: true })
      .where(and(
        eq(schema.opCodes.storeId, storeId),
        inArray(schema.opCodes.id, plan.reactivate.map((r) => r.id)),
      ))
  }

  return record('OK', describePlan(plan), plan, {
    repriced: plan.update.map((u) => ({
      code: u.code, from: u.beforeTotal, to: u.afterTotal,
    })),
    heldBack: plan.quarantined.map((q) => ({
      code: q.code, from: q.beforeTotal, to: q.afterTotal,
    })),
  })
}

/** Every active store. What the scheduled job calls. */
export async function syncAllStorePricing(): Promise<StoreSyncResult[]> {
  const db = getDb()
  const stores = await db
    .select({ id: schema.stores.id, name: schema.stores.name })
    .from(schema.stores)
    .where(eq(schema.stores.isActive, true))

  const results: StoreSyncResult[] = []
  for (const store of stores) {
    // Sequential on purpose. A rate-limited vendor API answers a group of
    // twenty rooftops far better one at a time than twenty at once.
    results.push(await syncStorePricing(store.id, store.name))
  }
  return results
}
