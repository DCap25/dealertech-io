import 'server-only'
import { and, count, eq, inArray, isNull, min } from 'drizzle-orm'
import { schema } from '@/db/client'
import { withCurrentUserScope, type ScopedDb } from '@/db/scoped'
import { progress, type OnboardingProgress, type StoreSignals } from './steps'

/**
 * Gathering what the checklist reasons from.
 *
 * Counts rather than rows: the engine is pure and takes primitives, so this is
 * the only place that touches a database and the only place that has to change
 * when a step's evidence does.
 *
 * Runs scoped, like every other read a signed-in person makes. `Promise.all`
 * inside a scope runs sequentially — one transaction is one connection — which
 * is the documented cost of the boundary and not worth splitting a setup
 * screen over. Seven small aggregates on one page is nothing.
 */

export async function loadSignals(db: ScopedDb, storeId: string): Promise<StoreSignals | null> {
  const [store] = await db
    .select({
      createdAt: schema.stores.createdAt,
      laborRate: schema.stores.laborRate,
      partsTaxRate: schema.stores.partsTaxRate,
      laborTaxRate: schema.stores.laborTaxRate,
    })
    .from(schema.stores)
    .where(eq(schema.stores.id, storeId))
    .limit(1)

  if (!store) return null

  const [staff] = await db
    .select({ n: count() })
    .from(schema.userStoreRoles)
    .where(and(
      eq(schema.userStoreRoles.storeId, storeId),
      eq(schema.userStoreRoles.isActive, true),
    )) as [{ n: number }]

  const [invites] = await db
    .select({ n: count() })
    .from(schema.storeInvitations)
    .where(and(
      eq(schema.storeInvitations.storeId, storeId),
      // Neither accepted nor revoked: still genuinely outstanding. An accepted
      // invitation is already counted as staff, and a revoked one is evidence
      // of nothing.
      isNull(schema.storeInvitations.acceptedAt),
      isNull(schema.storeInvitations.revokedAt),
    )) as [{ n: number }]

  const [opCodes] = await db
    .select({ n: count() })
    .from(schema.opCodes)
    .where(and(eq(schema.opCodes.storeId, storeId), eq(schema.opCodes.isActive, true))) as [{ n: number }]

  const [declines] = await db
    .select({ n: count() })
    .from(schema.declinedServices)
    .where(eq(schema.declinedServices.storeId, storeId)) as [{ n: number }]

  const [imports] = await db
    .select({ n: count() })
    .from(schema.importBatches)
    .where(and(
      eq(schema.importBatches.storeId, storeId),
      inArray(schema.importBatches.status, ['SUCCESS', 'PARTIAL']),
    )) as [{ n: number }]

  const [presentations] = await db
    .select({ n: count(), first: min(schema.presentationSessions.startedAt) })
    .from(schema.presentationSessions)
    .where(eq(schema.presentationSessions.storeId, storeId)) as [{ n: number; first: Date | string | null }]

  const acknowledgedRows = await db
    .select({ stepKey: schema.onboardingSteps.stepKey })
    .from(schema.onboardingSteps)
    .where(and(
      eq(schema.onboardingSteps.storeId, storeId),
      inArray(schema.onboardingSteps.status, ['DONE', 'SKIPPED']),
    ))

  /*
    `min()` comes back as a string on some drivers and a Date on others
    depending on the column type. Normalised here rather than trusted, because
    an activation metric that silently becomes NaN reads as "nobody has ever
    presented a menu" — which is the one conclusion it must not draw wrongly.
  */
  const firstRaw = presentations?.first ?? null
  const firstPresentationAt = firstRaw
    ? (firstRaw instanceof Date ? firstRaw : new Date(firstRaw))
    : null

  return {
    storeCreatedAt: store.createdAt,
    laborRate: Number(store.laborRate ?? 0),
    partsTaxRate: Number(store.partsTaxRate ?? 0),
    laborTaxRate: Number(store.laborTaxRate ?? 0),
    staffCount: staff?.n ?? 0,
    pendingInvites: invites?.n ?? 0,
    opCodeCount: opCodes?.n ?? 0,
    declineCount: declines?.n ?? 0,
    importCount: imports?.n ?? 0,
    presentationCount: presentations?.n ?? 0,
    firstPresentationAt:
      firstPresentationAt && !Number.isNaN(firstPresentationAt.getTime())
        ? firstPresentationAt
        : null,
    acknowledged: new Set(acknowledgedRows.map((r) => r.stepKey)),
  }
}

/** The checklist for the signed-in user's rooftop. */
export async function loadProgress(storeId: string): Promise<OnboardingProgress | null> {
  return withCurrentUserScope(async (db) => {
    const signals = await loadSignals(db, storeId)
    return signals ? progress(signals) : null
  })
}
