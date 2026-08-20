'use server'

import { revalidatePath } from 'next/cache'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { getDb, schema } from '@/db/client'
import { requirePlatformAdmin } from '@/lib/auth/session'
import { buildAuditRow } from '@/lib/audit/events'
import { createStore } from '@/lib/invites/provision'
import { createInvitation } from '@/lib/invites/create'
import { normaliseEmail } from '@/lib/invites/invite'
import { issueTourCode, revokeTourCode } from '@/lib/demo-tour/store'
import { formatTourCode } from '@/lib/demo-tour/codes'
import { knownMakes } from '@/lib/warranty'

export interface ProvisionState {
  error?: string
  /** Shown once. Only the hash is stored, so there is nothing to recover. */
  link?: string
  dealershipName?: string
  invitedEmail?: string
}

/**
 * Turn a lead into a dealership.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS DOES NOT CREATE AN ACCOUNT
 * ---------------------------------------------------------------------------
 * The sales-led path deliberately stops at an invitation. Whoever signs the
 * contract is rarely the person who will sit at the keyboard, and creating an
 * account means choosing a password on somebody's behalf and then transmitting
 * it — which is the one thing a system holding a dealership's customer records
 * should never do. They get a link, they choose their own password, and the
 * account is theirs from the first second.
 *
 * The writes here run privileged rather than under the caller's row-level
 * security, because creating an organisation is not something any policy grants
 * — there is no tenant to belong to yet. `requirePlatformAdmin()` is therefore
 * doing the whole job of authorising this, which is why it is the first line.
 */
export async function provisionFromLead(
  _previous: ProvisionState,
  formData: FormData,
): Promise<ProvisionState> {
  const admin = await requirePlatformAdmin()

  const leadId = String(formData.get('leadId') ?? '')
  const dealershipName = String(formData.get('dealershipName') ?? '').trim()
  const franchiseMake = String(formData.get('franchiseMake') ?? '').trim().toUpperCase()
  const state = String(formData.get('state') ?? '').trim().toUpperCase()
  const laborRate = Number(formData.get('laborRate') ?? 0)
  const adminEmail = normaliseEmail(String(formData.get('adminEmail') ?? ''))

  if (!dealershipName) return { error: 'Enter the dealership name.' }
  if (!adminEmail.includes('@')) return { error: 'Enter the email to invite.' }
  if (!Number.isFinite(laborRate) || laborRate <= 0) {
    return { error: 'Enter their door rate — every estimate is priced from it.' }
  }
  if (state && state.length !== 2) return { error: 'Use the two-letter state code.' }
  if (franchiseMake && !knownMakes().includes(franchiseMake)) {
    // A brand the warranty engine does not know would produce a dealership
    // whose every coverage answer is "no reference data" — a broken-looking
    // product rather than a missing program.
    return { error: 'Pick a franchise brand the warranty engine knows, or leave it blank.' }
  }

  const db = getDb()

  try {
    const { storeId } = await createStore(
      { dealershipName, franchiseMake: franchiseMake || null, state: state || null, laborRate },
      randomUUID().slice(0, 8),
    )

    /*
      ADMIN, not SERVICE_MANAGER.

      They are the first person in an empty dealership and need to be able to
      invite everybody else. Every account after this one comes through an
      invitation with an explicitly chosen role.
    */
    const { token } = await createInvitation({
      storeId,
      email: adminEmail,
      role: 'ADMIN',
      invitedByUserId: admin.id,
    })

    if (leadId) {
      // Marked here rather than as a separate click, so a provisioned lead
      // cannot sit in the "not contacted" count looking like work to do.
      await db.update(schema.demoRequests)
        .set({ contacted: true, contactedAt: new Date() })
        .where(eq(schema.demoRequests.id, leadId))
    }

    revalidatePath('/admin')
    revalidatePath('/admin/leads')
    return { link: `/invite/${token}`, dealershipName, invitedEmail: adminEmail }
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause)
    return { error: `Could not create the dealership: ${why}` }
  }
}

// ===========================================================================

export interface LeadOutcomeState {
  error?: string
  ok?: string
}

/** Long enough for what was actually said, short enough to read in a list. */
const MAX_NOTES = 2_000

/**
 * Write down what happened when somebody rang a lead.
 *
 * ---------------------------------------------------------------------------
 * WHY A NOTE AND A FLAG, RATHER THAN A PIPELINE
 * ---------------------------------------------------------------------------
 * The temptation with a leads page is a stage enum — NEW, CONTACTED,
 * QUALIFIED, LOST — and it would be wrong at this size. A vocabulary invented
 * before there is a sales process to describe produces stages nobody agrees on
 * and a board that is always slightly out of date, which is worse than the
 * honest version: did anyone ring them, and what did they say.
 *
 * `notes` shipped with the table in 0003 and nothing has ever written to it,
 * so the answer to "did we already speak to this dealer group" has lived in
 * somebody's memory. The seam for stages later is one column on this table;
 * it stays unbuilt until a second person is selling.
 *
 * Uncontacting is deliberately possible. A lead marked by a mis-click
 * disappears from the only count that would have surfaced it again, and a
 * flag that can only be set is one nobody trusts enough to use.
 *
 * Runs privileged, like `provisionFromLead` above. Migration 0016 grants
 * platform staff a *read* policy on `demo_requests` and no write policy at
 * all, so a scoped update would affect zero rows and report success — the
 * silent-write failure that 0021 was written about.
 */
export async function recordLeadOutcome(
  _previous: LeadOutcomeState,
  formData: FormData,
): Promise<LeadOutcomeState> {
  const admin = await requirePlatformAdmin()

  const leadId = String(formData.get('leadId') ?? '')
  const notes = String(formData.get('notes') ?? '').trim().slice(0, MAX_NOTES)
  const contacted = formData.get('contacted') === 'on'

  if (!leadId) return { error: 'No lead named.' }

  const db = getDb()

  try {
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({
          contacted: schema.demoRequests.contacted,
          contactedAt: schema.demoRequests.contactedAt,
        })
        .from(schema.demoRequests)
        .where(eq(schema.demoRequests.id, leadId))
        .limit(1)

      if (!existing) throw new Error('That lead no longer exists.')

      await tx.update(schema.demoRequests)
        .set({
          notes: notes || null,
          contacted,
          /*
            The first time it was marked, not the last time anybody edited a
            note. "Contacted 40 days ago" is the number that decides whether a
            lead has gone cold, and re-stamping it on every save would reset
            that clock for a typo correction.

            Cleared when the flag comes off, so an un-marked lead does not keep
            a date claiming somebody rang them.
          */
          contactedAt: contacted ? (existing.contactedAt ?? new Date()) : null,
        })
        .where(eq(schema.demoRequests.id, leadId))

      const row = buildAuditRow({
        action: 'LEAD_OUTCOME_RECORDED',
        entityType: 'demo_requests',
        entityId: leadId,
        // No tenant exists yet — that is the whole nature of a lead.
        storeId: null,
        userId: admin.id,
        changes: { contacted, wasContacted: existing.contacted, noteLength: notes.length },
      })
      if (row) await tx.insert(schema.auditLog).values(row)
    })
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause)
    return { error: `Could not save: ${why}` }
  }

  revalidatePath('/admin/leads')
  revalidatePath('/admin')
  return { ok: contacted ? 'Saved, and marked contacted.' : 'Saved, and marked not contacted.' }
}

// ===========================================================================

export interface TourCodeState {
  error?: string
  ok?: string
  /**
   * Shown once, exactly like a provisioning link, and already hyphenated.
   *
   * Formatted here rather than in the panel that renders it: `formatTourCode`
   * lives beside `createTourCode` in a module that imports `node:crypto`, and
   * importing it from a client component to hyphenate ten characters would drag
   * Node's crypto into the browser bundle.
   *
   * Only the SHA-256 is stored, so there is nothing to recover and deliberately
   * no "show it to me again" — see `issueTourCode`. If Dan loses it before
   * reading it out, the answer is to issue another one and revoke this.
   */
  code?: string
  label?: string
  expiresAt?: string
}

/** Long enough for "Ray at Lone Star, called 19 Aug"; short enough for a list. */
const MAX_TOUR_LABEL = 120

/**
 * Issue a tour code for a lead.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ON THE LEAD AND NOT ON A CODES PAGE
 * ---------------------------------------------------------------------------
 * A code is issued in the middle of a phone call, at the moment the walkthrough
 * gets booked, and the lead's row is where that call is already being written
 * down. A separate console page would mean leaving the conversation, finding
 * the lead again by name, and re-typing who it is for — three chances to
 * associate a code with the wrong dealership.
 *
 * Runs privileged, like `provisionFromLead` and `recordLeadOutcome` above.
 * Migration 0033 grants platform staff SELECT on `demo_tour_codes` and no write
 * policy at all, so a scoped INSERT would affect zero rows and report success —
 * the silent-write failure 0021 was written about.
 */
export async function issueTourCodeForLead(
  _previous: TourCodeState,
  formData: FormData,
): Promise<TourCodeState> {
  const admin = await requirePlatformAdmin()

  const leadId = String(formData.get('leadId') ?? '').trim()
  const label = String(formData.get('label') ?? '').trim().slice(0, MAX_TOUR_LABEL)

  if (!label) return { error: 'Say who this is for — it is the only label the list will have.' }

  try {
    const issued = await issueTourCode({
      label,
      // A code can exist without a lead behind it (a conference handout), so
      // the empty string becomes null rather than a foreign key that fails.
      demoRequestId: leadId || null,
      createdByUserId: admin.id,
    })

    revalidatePath('/admin/leads')
    return {
      code: formatTourCode(issued.code),
      label,
      expiresAt: issued.expiresAt.toISOString(),
    }
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause)
    return { error: `Could not issue a code: ${why}` }
  }
}

/**
 * Withdraw a code.
 *
 * Never deleted — "who could see the product last March" is the question the
 * revoked row is kept to answer, the same reasoning `platform_admins` and
 * `store_invitations` both follow.
 */
export async function revokeTourCodeAction(
  _previous: TourCodeState,
  formData: FormData,
): Promise<TourCodeState> {
  const admin = await requirePlatformAdmin()

  const codeId = String(formData.get('codeId') ?? '').trim()
  if (!codeId) return { error: 'No code named.' }

  try {
    const revoked = await revokeTourCode({ id: codeId, revokedByUserId: admin.id })
    revalidatePath('/admin/leads')
    // Distinguished rather than both reported as success: a button that says
    // "done" when it did nothing is how somebody concludes a live code is dead.
    return revoked
      ? { ok: 'Withdrawn. It stops working on the next click.' }
      : { ok: 'That code was already withdrawn.' }
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause)
    return { error: `Could not withdraw it: ${why}` }
  }
}
