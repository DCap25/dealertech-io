import 'server-only'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { getDb, schema } from '@/db/client'
import { withCurrentUserScope } from '@/db/scoped'
import { recordAudit } from '@/lib/audit/record'
import {
  createTourCode,
  hashTourCode,
  isWellFormedTourCode,
  normalizeTourCode,
  tourCodeStatus,
  tourExpiryFrom,
  tourHashesMatch,
  type TourCodeStatus,
  type TourRole,
} from './codes'

/**
 * Reading and writing tour codes. The decisions are all in ./codes.
 *
 * ---------------------------------------------------------------------------
 * WHICH CONNECTION, AND WHY — src/db/README.md §"Data access"
 * ---------------------------------------------------------------------------
 * Reads run scoped (`withCurrentUserScope`), exactly like `loadLeads`: the
 * caller is a signed-in platform admin, migration 0033 gives them a read policy
 * and the matching SELECT grant, and running the console's reads under the same
 * row-level security as everything else is what keeps the boundary a property
 * of the database rather than of this file remembering to be careful.
 *
 * Writes run privileged (`getDb`), and there are two distinct justifications:
 *
 *   * `redeemTourCode` is reached by an anonymous visitor who has not signed in
 *     yet — there is no `auth.uid()` for a policy to key off. Same row of the
 *     README table as `app/request-demo/actions.ts`.
 *   * `issueTourCode` and `revokeTourCode` are console actions, authorised by
 *     `requirePlatformAdmin()` rather than by a tenancy policy, which is the
 *     reason `provisionFromLead` gives for the same choice. 0033 grants
 *     SELECT and nothing else, so a scoped write here would affect zero rows
 *     and report success — the silent-write failure 0021 exists to prevent.
 */

export interface IssuedTourCode {
  id: string
  /** Shown once. Only the hash is stored, so there is nothing to recover. */
  code: string
  expiresAt: Date
}

/**
 * Issue a code.
 *
 * Returns the raw value exactly once, like `createInvitation`. There is
 * deliberately no "resend" and no "show it to me again" — a credential the
 * database can hand back is a credential the database is responsible for
 * keeping, and re-issuing is one click.
 *
 * Three writes in one transaction: the code, the lead's timeline entry, and
 * the audit row. See the note beside the `lead_events` insert for why the
 * narrative one lives here rather than in the action that calls this.
 */
export async function issueTourCode(params: {
  label: string
  demoRequestId: string | null
  createdByUserId: string
}): Promise<IssuedTourCode> {
  const now = new Date()
  const { code, codeHash } = createTourCode()
  const expiresAt = tourExpiryFrom(now)

  const db = getDb()

  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.demoTourCodes)
      .values({
        label: params.label,
        demoRequestId: params.demoRequestId,
        codeHash,
        expiresAt,
        createdByUserId: params.createdByUserId,
      })
      .returning({ id: schema.demoTourCodes.id })

    if (!row) throw new Error('The code was not written.')

    /*
      The lead's own timeline, in the same transaction as the code.

      Here rather than in `issueTourCodeForLead` deliberately, and the reason is
      the one the provisioning transaction was written for: a code that exists
      with no timeline entry beside it is the half-completed state, and an
      insert after this function returns would be a second transaction that can
      fail on its own. The audit row and the narrative row commit with the thing
      they describe or not at all.

      Three consequences follow from it, and all three were wrong without it.
      The timeline was missing its most common system event. The privacy policy
      claims we write entries "when it issues a code", which was an over-claim.
      And `lastActivityAt` never moved, so a lead could be flagged as having
      gone quiet the morning after Dan sent them a code.

      Null `demoRequestId` — a conference handout — has no lead to write to, and
      skipping is right: the audit row above still records that a code was
      issued and to whom.
    */
    if (params.demoRequestId) {
      await tx.insert(schema.leadEvents).values({
        demoRequestId: params.demoRequestId,
        kind: 'SYSTEM',
        body: `Tour code issued to ${params.label}. It opens /tour and expires `
          + `${expiresAt.toISOString().slice(0, 10)}.`,
        createdByUserId: params.createdByUserId,
      })
    }

    await recordAudit(tx, {
      action: 'DEMO_TOUR_CODE_ISSUED',
      entityType: 'demo_tour_codes',
      entityId: row.id,
      // No tenant. That is the whole nature of a lead — see LEAD_OUTCOME_RECORDED.
      storeId: null,
      userId: params.createdByUserId,
      /*
        The label and the lead, never the code. The audit log is never deleted
        (0020), so a bearer credential written into it stays valid and readable
        for as long as the log does.
      */
      changes: { label: params.label, leadId: params.demoRequestId, expiresAt: expiresAt.toISOString() },
    })

    return row.id
  })

  return { id, code, expiresAt }
}

export interface TourCodeSummary {
  id: string
  demoRequestId: string | null
  label: string
  expiresAt: Date
  revokedAt: Date | null
  uses: number
  lastUsedAt: Date | null
  createdAt: Date
  /** Derived here so the console and the entry form cannot disagree. */
  status: TourCodeStatus
}

/**
 * Every code, newest first, optionally narrowed to one lead.
 *
 * `asOf` is a parameter rather than a `new Date()` inside the map for the
 * reason the leads page hoists its clock out of the render: a status computed
 * from a fresh clock per row can show two codes issued in the same second on
 * opposite sides of an expiry boundary.
 */
export async function listTourCodes(
  opts: { demoRequestId?: string; limit?: number; asOf?: Date } = {},
): Promise<TourCodeSummary[]> {
  const asOf = opts.asOf ?? new Date()

  return withCurrentUserScope(async (db) => {
    const rows = await db
      .select({
        id: schema.demoTourCodes.id,
        demoRequestId: schema.demoTourCodes.demoRequestId,
        label: schema.demoTourCodes.label,
        expiresAt: schema.demoTourCodes.expiresAt,
        revokedAt: schema.demoTourCodes.revokedAt,
        uses: schema.demoTourCodes.uses,
        lastUsedAt: schema.demoTourCodes.lastUsedAt,
        createdAt: schema.demoTourCodes.createdAt,
      })
      .from(schema.demoTourCodes)
      .where(
        opts.demoRequestId
          ? eq(schema.demoTourCodes.demoRequestId, opts.demoRequestId)
          : undefined,
      )
      .orderBy(desc(schema.demoTourCodes.createdAt))
      .limit(opts.limit ?? 100)

    return rows.map((r) => ({ ...r, status: tourCodeStatus(r, asOf) }))
  })
}

/**
 * Withdraw a code.
 *
 * Only ever a live one — the `isNull(revokedAt)` clause means re-revoking is a
 * no-op rather than a rewrite of when it happened, and "when was this pulled"
 * is the question the row is kept to answer. Returns false when nothing
 * changed, so the console can say "already withdrawn" instead of claiming to
 * have done something.
 */
export async function revokeTourCode(params: {
  id: string
  revokedByUserId: string
}): Promise<boolean> {
  const db = getDb()

  return db.transaction(async (tx) => {
    const revoked = await tx
      .update(schema.demoTourCodes)
      .set({ revokedAt: new Date(), revokedByUserId: params.revokedByUserId })
      .where(and(
        eq(schema.demoTourCodes.id, params.id),
        isNull(schema.demoTourCodes.revokedAt),
      ))
      .returning({ id: schema.demoTourCodes.id, label: schema.demoTourCodes.label, uses: schema.demoTourCodes.uses })

    const row = revoked[0]
    if (!row) return false

    await recordAudit(tx, {
      action: 'DEMO_TOUR_CODE_REVOKED',
      entityType: 'demo_tour_codes',
      entityId: row.id,
      storeId: null,
      userId: params.revokedByUserId,
      changes: { label: row.label, usesAtRevocation: row.uses },
    })

    return true
  })
}

export type TourLookup =
  | { found: false }
  | { found: true; id: string; label: string; status: TourCodeStatus }

/**
 * Resolve a code a visitor typed.
 *
 * Malformed input never reaches the database. That is not only a performance
 * point: `normalizeTourCode` strips everything outside the alphabet, so an
 * eleven-character paste and a five-character typo would otherwise both become
 * a lookup for a hash that cannot exist, and the well-formedness gate lets the
 * form say "that is not the right shape" rather than "not one of ours".
 *
 * The `tourHashesMatch` re-check after the equality lookup is belt-and-braces
 * in the same spirit as `tokenMatches` in the pairing module — Postgres did the
 * matching, and a constant-time comparison on the way back out costs nothing
 * and closes the question of whether anything downstream ever compares these
 * with `===`.
 */
export async function findTourCode(rawCode: string, asOf: Date): Promise<TourLookup> {
  if (!isWellFormedTourCode(rawCode)) return { found: false }

  const codeHash = hashTourCode(normalizeTourCode(rawCode))
  const db = getDb()

  const [row] = await db
    .select({
      id: schema.demoTourCodes.id,
      label: schema.demoTourCodes.label,
      codeHash: schema.demoTourCodes.codeHash,
      expiresAt: schema.demoTourCodes.expiresAt,
      revokedAt: schema.demoTourCodes.revokedAt,
    })
    .from(schema.demoTourCodes)
    .where(eq(schema.demoTourCodes.codeHash, codeHash))
    .limit(1)

  if (!row || !tourHashesMatch(row.codeHash, codeHash)) return { found: false }

  return { found: true, id: row.id, label: row.label, status: tourCodeStatus(row, asOf) }
}

/**
 * Record that somebody walked the tour.
 *
 * Called *after* the Supabase sign-in succeeded, deliberately. Counting a
 * redemption that then failed to sign in would inflate the one number the
 * console uses to decide whether a prospect ever looked, and "issued, never
 * used" is a phone call somebody makes.
 *
 * `uses` increments in SQL rather than read-modify-write. Two people on the
 * same walkthrough clicking two roles at once is an entirely ordinary thing to
 * happen, and a counter that loses one of them is a counter nobody trusts.
 *
 * Never throws for its own sake: a failed count must not turn a working tour
 * into an error page in front of a prospect. Same asymmetry `recordAudit`
 * documents — the log can have gaps, it cannot have lies.
 */
export async function recordTourRedemption(params: {
  codeId: string
  role: TourRole
  /** The seeded demo account the visitor was signed in as. */
  demoUserId: string
}): Promise<void> {
  try {
    const db = getDb()
    await db.transaction(async (tx) => {
      await tx
        .update(schema.demoTourCodes)
        .set({
          uses: sql`${schema.demoTourCodes.uses} + 1`,
          lastUsedAt: new Date(),
        })
        .where(eq(schema.demoTourCodes.id, params.codeId))

      await recordAudit(tx, {
        action: 'DEMO_TOUR_REDEEMED',
        entityType: 'demo_tour_codes',
        entityId: params.codeId,
        /*
          Null, though the tour lands in the seeded store and we know its id.
          The subject of this row is the code, which belongs to DealerTech; a
          store id here would put the fictional dealership's own staff in the
          audience for it, since the audit policy lets a store read its own log.
        */
        storeId: null,
        userId: params.demoUserId,
        changes: { role: params.role },
      })
    })
  } catch (error) {
    console.error('[demo-tour] could not record a redemption:', error)
  }
}
