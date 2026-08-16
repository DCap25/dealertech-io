// Deliberately NOT marked `server-only`: the nightly reconciler will call this
// from a CLI script as well as from a route handler, and the guard throws
// outside a React Server Component context. It still cannot reach a browser —
// it imports the privileged database client.
import { desc, eq } from 'drizzle-orm'
import { getDb, schema } from '@/db/client'
import { recordAudit } from '@/lib/audit/record'
import type { ScopedDb } from '@/db/scoped'
import {
  transition, type LifecycleActor, type LifecycleEvent, type LifecycleStatus,
} from './lifecycle'

/**
 * Reading and moving a tenant's lifecycle state.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS RUNS PRIVILEGED
 * ---------------------------------------------------------------------------
 * Per src/db/README.md, `getDb()` is for the cases where scoping to the
 * signed-in user is impossible rather than merely inconvenient. Everything
 * here qualifies, in two different ways:
 *
 *  - The reconciler and the webhook handler have no user at all. Same row of
 *    that table as `lib/pricing/run.ts` and `lib/pairing/store.ts`.
 *  - A platform admin holds no role at the dealership whose status they are
 *    changing — that is the entire design of migration 0016 — so no
 *    store-scoped policy can ever match for them.
 *
 * The tables carry no write policy at all (see migration 0022), so an
 * accidental scoped write fails loudly rather than silently affecting zero
 * rows. Authorisation for the platform-admin path is `requirePlatformAdmin()`
 * at the call site, exactly as it is for tenant provisioning.
 */

export interface TenantLifecycle {
  organizationId: string
  status: LifecycleStatus
  statusChangedAt: Date
  trialEndsAt: Date | null
}

/**
 * The lifecycle state of the organization a store belongs to.
 *
 * Takes the caller's transaction handle because it is read on every request
 * through the session — opening a second connection while the first is held
 * would deadlock behind a `max: 1` pool.
 */
export async function lifecycleForStore(
  db: ScopedDb,
  storeId: string,
): Promise<TenantLifecycle | null> {
  const [row] = await db
    .select({
      organizationId: schema.organizations.id,
      status: schema.organizations.lifecycleStatus,
      statusChangedAt: schema.organizations.lifecycleChangedAt,
      trialEndsAt: schema.organizations.trialEndsAt,
    })
    .from(schema.organizations)
    .innerJoin(schema.stores, eq(schema.stores.organizationId, schema.organizations.id))
    .where(eq(schema.stores.id, storeId))
    .limit(1)

  return row ?? null
}

export interface ApplyTransition {
  organizationId: string
  event: LifecycleEvent
  actor: LifecycleActor
  actorUserId?: string | null
  reason?: string | null
  /** Set alongside a TRIAL_EXTENDED, which moves a date rather than a status. */
  trialEndsAt?: Date | null
}

export type ApplyResult =
  | { ok: true; from: LifecycleStatus; to: LifecycleStatus }
  | { ok: false; reason: string }

/**
 * Move a tenant, or explain why not.
 *
 * ---------------------------------------------------------------------------
 * THE STATUS AND ITS HISTORY COMMIT TOGETHER OR NOT AT ALL
 * ---------------------------------------------------------------------------
 * One transaction, always. A status column that says SUSPENDED with no
 * `lifecycle_events` row behind it is precisely the artefact this whole design
 * exists to prevent — six months later nobody can say who decided it or why,
 * and the honest answer becomes "the database says so".
 *
 * The current status is re-read inside the transaction rather than trusted
 * from the caller, because the caller read it seconds ago and a webhook may
 * have moved it since. The engine judges what is true now.
 */
export async function applyTransition(input: ApplyTransition): Promise<ApplyResult> {
  const db = getDb()

  return db.transaction(async (tx) => {
    const [org] = await tx
      .select({
        id: schema.organizations.id,
        status: schema.organizations.lifecycleStatus,
      })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, input.organizationId))
      .limit(1)

    if (!org) return { ok: false as const, reason: 'No such organization.' }

    const decision = transition(org.status, input.event, input.actor)
    if (!decision.ok) return { ok: false as const, reason: decision.reason }

    await tx.update(schema.organizations)
      .set({
        lifecycleStatus: decision.to,
        // Not moved on a self-transition. The grace and churn clocks are
        // measured from this, and a trial extension that reset them would
        // quietly hand back fourteen days of dunning as a side effect.
        ...(decision.isSelfTransition ? {} : { lifecycleChangedAt: new Date() }),
        ...(input.trialEndsAt !== undefined ? { trialEndsAt: input.trialEndsAt } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.organizations.id, org.id))

    await tx.insert(schema.lifecycleEvents).values({
      organizationId: org.id,
      fromStatus: decision.from,
      toStatus: decision.to,
      actor: input.actor,
      actorUserId: input.actorUserId ?? null,
      reason: input.reason ?? null,
    })

    /*
      Audited as well as recorded.

      `lifecycle_events` answers "what did the commercial relationship look
      like in March"; the audit log answers "who touched what" across the whole
      product, and a support engineer suspending a dealership belongs in both.
      storeId is null — this is an organization-level act, and naming one
      rooftop would imply the others were untouched.
    */
    await recordAudit(tx as unknown as ScopedDb, {
      action: 'TENANT_LIFECYCLE_CHANGED',
      entityType: 'organizations',
      entityId: org.id,
      storeId: null,
      userId: input.actorUserId ?? null,
      changes: {
        from: decision.from,
        to: decision.to,
        event: input.event,
        actor: input.actor,
        reason: input.reason ?? null,
      },
    })

    return { ok: true as const, from: decision.from, to: decision.to }
  })
}

/** The transitions a tenant has made, newest first. */
export async function lifecycleHistory(db: ScopedDb, organizationId: string, limit = 25) {
  return db
    .select({
      id: schema.lifecycleEvents.id,
      fromStatus: schema.lifecycleEvents.fromStatus,
      toStatus: schema.lifecycleEvents.toStatus,
      actor: schema.lifecycleEvents.actor,
      reason: schema.lifecycleEvents.reason,
      createdAt: schema.lifecycleEvents.createdAt,
      actorName: schema.users.fullName,
    })
    .from(schema.lifecycleEvents)
    .leftJoin(schema.users, eq(schema.users.id, schema.lifecycleEvents.actorUserId))
    .where(eq(schema.lifecycleEvents.organizationId, organizationId))
    .orderBy(desc(schema.lifecycleEvents.createdAt))
    .limit(limit)
}

/*
  A cross-tenant "who holds support access right now" query lived here and was
  deleted rather than kept: the tenant page derives its grants from the staff
  list it already loads, so this had no caller. It belongs on the operations
  page when that grows a support-access panel, and it is a five-line query to
  write again — which is cheaper than an exported function nobody calls that
  the next person has to work out the status of.
*/
