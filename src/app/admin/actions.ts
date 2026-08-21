'use server'

import { revalidatePath } from 'next/cache'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { getDb, schema } from '@/db/client'
import { requirePlatformAdmin } from '@/lib/auth/session'
import { buildAuditRow } from '@/lib/audit/events'
import { createStoreOn } from '@/lib/invites/provision'
import { createInvitationOn } from '@/lib/invites/create'
import { normaliseEmail } from '@/lib/invites/invite'
import { issueTourCode, revokeTourCode } from '@/lib/demo-tour/store'
import { formatTourCode } from '@/lib/demo-tour/codes'
import { buildWalkthroughIcs, icsFilename } from '@/lib/crm/ics'
import { knownMakes } from '@/lib/warranty'

export interface ProvisionState {
  error?: string
  /** Shown once. Only the hash is stored, so there is nothing to recover. */
  link?: string
  dealershipName?: string
  invitedEmail?: string
  /**
   * Where the new tenant lives, so the panel can offer the way onward.
   *
   * Provisioning used to end at a link and a green box: the dealership existed,
   * the console knew its id, and the only route to it was going back to the
   * tenant list and finding it by name. The onboarding starts here.
   */
  organizationId?: string
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
 *
 * ---------------------------------------------------------------------------
 * ONE TRANSACTION, AFTER A SURVEY FOUND WHAT HALF OF ONE LEAVES BEHIND
 * ---------------------------------------------------------------------------
 * This used to be four independent writes: an organisation and a store, then
 * an invitation on a separate connection, then the lead marked contacted. A
 * failure in the middle — a duplicate email against the invitation's partial
 * unique index is the realistic one — left a dealership standing with nobody
 * invited to it and no way to tell from the console that it had happened. The
 * error message said "could not create the dealership", which was false: the
 * dealership was created.
 *
 * All of it is now one transaction, which is why `createStoreOn` and
 * `createInvitationOn` exist: their wrappers each open a transaction of their
 * own, and a second connection while holding the first is a deadlock on a
 * `max: 1` pool rather than a slow query. See src/db/README.md.
 *
 * It also writes the two records it never wrote. `LEAD_PROVISIONED` is the
 * security record — the most consequential act in this console was silent —
 * and the `lead_events` row is the narrative one, so the lead's timeline says
 * how the conversation ended rather than stopping at the last phone call.
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
    const created = await db.transaction(async (tx) => {
      const { organizationId, storeId } = await createStoreOn(
        tx,
        { dealershipName, franchiseMake: franchiseMake || null, state: state || null, laborRate },
        randomUUID().slice(0, 8),
      )

      /*
        ADMIN, not SERVICE_MANAGER.

        They are the first person in an empty dealership and need to be able to
        invite everybody else. Every account after this one comes through an
        invitation with an explicitly chosen role.
      */
      const { token } = await createInvitationOn(tx, {
        storeId,
        email: adminEmail,
        role: 'ADMIN',
        invitedByUserId: admin.id,
      })

      if (leadId) {
        const [existing] = await tx
          .select({ contactedAt: schema.demoRequests.contactedAt })
          .from(schema.demoRequests)
          .where(eq(schema.demoRequests.id, leadId))
          .limit(1)

        if (existing) {
          // Marked here rather than as a separate click, so a provisioned lead
          // cannot sit in the "not contacted" count looking like work to do.
          // The original contact date survives, for the reason
          // `recordLeadOutcome` gives: it is the clock a cold lead is measured
          // against, and re-stamping it here would reset it at the finish line.
          await tx.update(schema.demoRequests)
            .set({
              contacted: true,
              contactedAt: existing.contactedAt ?? new Date(),
              provisionedOrgId: organizationId,
            })
            .where(eq(schema.demoRequests.id, leadId))

          await tx.insert(schema.leadEvents).values({
            demoRequestId: leadId,
            kind: 'SYSTEM',
            body: `Provisioned ${dealershipName} and invited ${adminEmail} as administrator.`,
            createdByUserId: admin.id,
          })
        }
      }

      /*
        The store id, not null.

        Every other lead action writes `storeId: null` because a lead has no
        tenant — that is the whole nature of one. This is the moment it stops
        being true, and the row belongs to the dealership that now exists:
        their own audit log should carry the fact that DealerTech created it.
      */
      const row = buildAuditRow({
        action: 'LEAD_PROVISIONED',
        entityType: 'organizations',
        entityId: organizationId,
        storeId,
        userId: admin.id,
        changes: {
          leadId: leadId || null,
          dealershipName,
          invitedEmail: adminEmail,
          franchiseMake: franchiseMake || null,
          state: state || null,
          laborRate,
        },
      })
      if (row) await tx.insert(schema.auditLog).values(row)

      return { organizationId, token }
    })

    revalidatePath('/admin')
    revalidatePath('/admin/leads')
    if (leadId) revalidatePath(`/admin/leads/${leadId}`)
    return {
      link: `/invite/${created.token}`,
      dealershipName,
      invitedEmail: adminEmail,
      organizationId: created.organizationId,
    }
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause)
    // Accurate now in a way it was not before: the transaction rolled back, so
    // nothing was created and trying again is safe.
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
 * WHY A NOTE AND A FLAG, RATHER THAN A PIPELINE — AND WHAT CHANGED
 * ---------------------------------------------------------------------------
 * This function used to argue that a stage enum would be wrong at this size: a
 * vocabulary invented before there is a sales process to describe produces
 * stages nobody agrees on and a board that is always slightly out of date. The
 * argument was right about the thing it refused, and the seam it named — "one
 * column on this table" — is the one thing the pipeline that arrived does not
 * use. There is no stage column. `src/lib/crm/stage.ts` computes the stage
 * from facts that already existed and were scattered across four screens, so
 * nothing can go out of date and nobody drags a card.
 *
 * What is left here is exactly what this was always for: `notes` shipped with
 * the table in 0003 and nothing ever wrote to it, so "did we already speak to
 * this dealer group" lived in somebody's memory. It stays the current
 * position, rewritten each save; the history it could never be lives in
 * `lead_events` (0035), which this appends a line to when the flag moves.
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

      /*
        A timeline entry only when the flag actually moved.

        `notes` is the current position and it is rewritten constantly — a
        lead_event per keystroke-correction would bury the calls that matter
        under a dozen "note edited" lines. A lead becoming contacted, or
        un-becoming it, is a fact about the pipeline and belongs in the story.
        Typed notes go through `addLeadNote`, which is what that form is for.
      */
      if (existing.contacted !== contacted) {
        await tx.insert(schema.leadEvents).values({
          demoRequestId: leadId,
          kind: 'STAGE',
          body: contacted ? 'Marked contacted.' : 'Marked not contacted.',
          createdByUserId: admin.id,
        })
      }

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
  revalidatePath(`/admin/leads/${leadId}`)
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
 *
 * The lead's timeline entry is written by `issueTourCode` itself, inside the
 * same transaction as the code and its audit row, rather than here — see the
 * note beside that insert. Issuing a code is the most common thing that
 * happens to a lead, and until it wrote one the timeline had a hole in it and
 * `lastActivityAt` never moved.
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
    if (leadId) revalidatePath(`/admin/leads/${leadId}`)
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
    // The whole segment, because a code is withdrawn from the lead's own page
    // and this action is handed the code id rather than the lead's — 'layout'
    // covers /admin/leads and every /admin/leads/[leadId] under it.
    revalidatePath('/admin/leads', 'layout')
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

// ===========================================================================

export interface LeadPipelineState {
  error?: string
  ok?: string
}

/**
 * The pipeline actions: book a walkthrough, hold it, lose the deal, write it
 * down.
 *
 * ---------------------------------------------------------------------------
 * EVERY ONE OF THESE IS THE SAME FOUR STEPS
 * ---------------------------------------------------------------------------
 * Authorise (platform admin, or nothing happens), write the fact, write the
 * narrative, revalidate — and the ones that change where a deal stands write
 * the security record too. The shape is `tenants/actions.ts`, deliberately:
 * these are the same kind of act on the other side of the signature.
 *
 * Two records, not one, and they are not redundant. `audit_log` keeps a closed
 * vocabulary and answers "who did what, to which record, when"; `lead_events`
 * is prose somebody will read in six months to remember how a deal went.
 * Writing only the first gives a log nobody reads for pleasure and a timeline
 * with gaps where the software acted.
 *
 * Runs privileged, like everything else on this page. Migration 0035 gives
 * platform staff a read policy on `lead_events` and no write policy at all —
 * so a scoped INSERT would affect zero rows and report success, which is the
 * silent-write failure 0021 was written about.
 */

/** Long enough for what was actually said, short enough to read in a list. */
const MAX_EVENT_BODY = 2_000

/** Long enough to be a sentence. Matches the console's other reasons. */
const MAX_LOST_REASON = 500

/**
 * How long a walkthrough blocks out.
 *
 * Forty-five minutes: half an hour of product and fifteen for the questions
 * that follow it, which is what these actually run to. A calendar default, not
 * a rule — the diary entry is editable once it lands.
 */
const WALKTHROUGH_MINUTES = 45

/**
 * Parse the instant the browser sent.
 *
 * The form posts an ISO instant rather than the raw `datetime-local` value,
 * and the conversion happens in the browser on purpose. A `datetime-local`
 * carries no timezone, so parsing it here would resolve it against whatever
 * the server's clock is set to — UTC on Netlify — and a walkthrough booked for
 * two in the afternoon in Texas would land in the calendar at nine in the
 * morning. The one machine that knows which timezone "2pm" meant is the one
 * the founder typed it into.
 */
function instantFrom(value: string): Date | null {
  if (!value) return null
  const at = new Date(value)
  return Number.isNaN(at.getTime()) ? null : at
}

/**
 * Put a walkthrough in the diary.
 *
 * Rebooking overwrites, because a lead has one walkthrough on the books at a
 * time and two rows would immediately disagree about which. What is not lost
 * is the fact that it moved: the audit row and the timeline entry both survive
 * the overwrite, and "this demo was rescheduled three times" is itself the
 * answer to how a deal went.
 */
export async function bookWalkthrough(
  _previous: LeadPipelineState,
  formData: FormData,
): Promise<LeadPipelineState> {
  const admin = await requirePlatformAdmin()

  const leadId = String(formData.get('leadId') ?? '').trim()
  const at = instantFrom(String(formData.get('walkthroughAt') ?? '').trim())
  const note = String(formData.get('note') ?? '').trim().slice(0, MAX_EVENT_BODY)

  if (!leadId) return { error: 'No lead named.' }
  if (!at) return { error: 'Pick a date and a time.' }

  const db = getDb()

  try {
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ walkthroughAt: schema.demoRequests.walkthroughAt })
        .from(schema.demoRequests)
        .where(eq(schema.demoRequests.id, leadId))
        .limit(1)

      if (!existing) throw new Error('That lead no longer exists.')

      await tx.update(schema.demoRequests)
        .set({
          walkthroughAt: at,
          /*
            Booking clears "held".

            Rebooking after a walkthrough happened is a second walkthrough, and
            leaving the old done-stamp in place would compute the stage as
            WALKTHROUGH_DONE while a future appointment sits on the same row —
            a lead that is finished and booked at the same time.
          */
          walkthroughDoneAt: null,
        })
        .where(eq(schema.demoRequests.id, leadId))

      await tx.insert(schema.leadEvents).values({
        demoRequestId: leadId,
        kind: 'STAGE',
        body: [
          existing.walkthroughAt
            ? `Walkthrough moved to ${at.toISOString()} (was ${existing.walkthroughAt.toISOString()}).`
            : `Walkthrough booked for ${at.toISOString()}.`,
          note,
        ].filter(Boolean).join(' '),
        createdByUserId: admin.id,
      })

      const row = buildAuditRow({
        action: 'LEAD_WALKTHROUGH_BOOKED',
        entityType: 'demo_requests',
        entityId: leadId,
        // No tenant exists yet — that is the whole nature of a lead.
        storeId: null,
        userId: admin.id,
        changes: {
          walkthroughAt: at.toISOString(),
          previous: existing.walkthroughAt?.toISOString() ?? null,
        },
      })
      if (row) await tx.insert(schema.auditLog).values(row)
    })
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause)
    return { error: `Could not book it: ${why}` }
  }

  revalidatePath('/admin')
  revalidatePath('/admin/leads')
  revalidatePath(`/admin/leads/${leadId}`)
  return { ok: 'Booked. Add it to your own calendar with the download beside it.' }
}

/**
 * It happened.
 *
 * The one fact on this page that nothing observes — a booking whose time has
 * passed is not evidence anybody dialled in, and treating it as such is how a
 * pipeline reports demos that never took place. So it is a button, and it
 * writes no audit row: nothing changed hands and no access was granted, and
 * the closed vocabulary is for the security record rather than for every
 * click. The timeline carries it, which is where somebody would look.
 */
export async function markWalkthroughDone(
  _previous: LeadPipelineState,
  formData: FormData,
): Promise<LeadPipelineState> {
  const admin = await requirePlatformAdmin()

  const leadId = String(formData.get('leadId') ?? '').trim()
  const note = String(formData.get('note') ?? '').trim().slice(0, MAX_EVENT_BODY)
  if (!leadId) return { error: 'No lead named.' }

  const db = getDb()
  const now = new Date()

  try {
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ walkthroughAt: schema.demoRequests.walkthroughAt })
        .from(schema.demoRequests)
        .where(eq(schema.demoRequests.id, leadId))
        .limit(1)

      if (!existing) throw new Error('That lead no longer exists.')
      if (!existing.walkthroughAt) {
        throw new Error('Nothing is booked. Book it first, even in the past.')
      }

      await tx.update(schema.demoRequests)
        .set({ walkthroughDoneAt: now })
        .where(eq(schema.demoRequests.id, leadId))

      await tx.insert(schema.leadEvents).values({
        demoRequestId: leadId,
        kind: 'CALL',
        body: note || 'Walkthrough held.',
        createdByUserId: admin.id,
      })
    })
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause)
    return { error: `Could not record it: ${why}` }
  }

  revalidatePath('/admin')
  revalidatePath('/admin/leads')
  revalidatePath(`/admin/leads/${leadId}`)
  return { ok: 'Recorded.' }
}

/**
 * The deal ended, or it did not after all.
 *
 * ---------------------------------------------------------------------------
 * WHY BOTH DIRECTIONS LIVE IN ONE ACTION
 * ---------------------------------------------------------------------------
 * LOST beats every other fact, which makes it the one control on this page
 * that can hide a lead from every stage tab at once. A flag that can only be
 * set is one nobody trusts enough to use — the same argument that made
 * uncontacting possible in `recordLeadOutcome` — so reopening is a second
 * button on the same form rather than a support request.
 *
 * Both write `LEAD_MARKED_LOST`, distinguished by `reopened` in the changes.
 * Adding a fifth verb to a closed vocabulary for the undo of a fourth is how a
 * vocabulary stops being closed, and the pair reads correctly in sequence:
 * lost on the third, reopened on the ninth.
 *
 * The reason is required in one direction only. Reasons are demanded on the
 * acts that take something away; a restorative one abandoned because the form
 * asked a question is the worse outcome, and the loss it reverses already
 * carries the explanation.
 */
export async function markLeadLost(
  _previous: LeadPipelineState,
  formData: FormData,
): Promise<LeadPipelineState> {
  const admin = await requirePlatformAdmin()

  const leadId = String(formData.get('leadId') ?? '').trim()
  const reopen = formData.get('intent') === 'reopen'
  const reason = String(formData.get('reason') ?? '').trim().slice(0, MAX_LOST_REASON)

  if (!leadId) return { error: 'No lead named.' }
  if (!reopen && !reason) {
    return {
      error: 'Say why it was lost. It is the only record of it, and it is what every '
        + 'conversation with the next dealership like them should start from.',
    }
  }

  const db = getDb()

  try {
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({
          lostAt: schema.demoRequests.lostAt,
          lostReason: schema.demoRequests.lostReason,
        })
        .from(schema.demoRequests)
        .where(eq(schema.demoRequests.id, leadId))
        .limit(1)

      if (!existing) throw new Error('That lead no longer exists.')

      await tx.update(schema.demoRequests)
        .set(reopen
          ? { lostAt: null, lostReason: null }
          // Kept, not re-stamped. "How long ago did this die" is the question
          // the date answers, and editing the reason should not reset it.
          : { lostAt: existing.lostAt ?? new Date(), lostReason: reason })
        .where(eq(schema.demoRequests.id, leadId))

      await tx.insert(schema.leadEvents).values({
        demoRequestId: leadId,
        kind: 'STAGE',
        body: reopen
          ? `Reopened. Was lost: ${existing.lostReason ?? 'no reason recorded'}.`
          : `Lost. ${reason}`,
        createdByUserId: admin.id,
      })

      const row = buildAuditRow({
        action: 'LEAD_MARKED_LOST',
        entityType: 'demo_requests',
        entityId: leadId,
        storeId: null,
        userId: admin.id,
        changes: reopen
          ? { reopened: true, previousReason: existing.lostReason }
          : { reopened: false, reason },
      })
      if (row) await tx.insert(schema.auditLog).values(row)
    })
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause)
    return { error: `Could not save: ${why}` }
  }

  revalidatePath('/admin')
  revalidatePath('/admin/leads')
  revalidatePath(`/admin/leads/${leadId}`)
  return { ok: reopen ? 'Back in the pipeline.' : 'Recorded as lost.' }
}

/**
 * Write down what was said.
 *
 * The thing `notes` could never be. That field is one textarea holding the
 * current position, rewritten on every save, so the answer to "what did we
 * actually say to them in March" lived in somebody's memory. This appends.
 *
 * No audit row. Nobody's access changed and nothing was decided — the note is
 * itself the record, and copying free text a person typed into the log that is
 * never deleted would put it somewhere it can never be corrected.
 */
export async function addLeadNote(
  _previous: LeadPipelineState,
  formData: FormData,
): Promise<LeadPipelineState> {
  const admin = await requirePlatformAdmin()

  const leadId = String(formData.get('leadId') ?? '').trim()
  const body = String(formData.get('body') ?? '').trim().slice(0, MAX_EVENT_BODY)
  const raw = String(formData.get('kind') ?? 'NOTE')
  /*
    Whitelisted rather than trusted. `kind` is checked in the database too
    (0035), and a value that only failed there would surface as a constraint
    error rather than as a sentence somebody can act on.
  */
  const kind = raw === 'CALL' ? 'CALL' : 'NOTE'

  if (!leadId) return { error: 'No lead named.' }
  if (!body) return { error: 'Nothing to save.' }

  const db = getDb()

  try {
    await db.insert(schema.leadEvents).values({
      demoRequestId: leadId,
      kind,
      body,
      createdByUserId: admin.id,
    })
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause)
    return { error: `Could not save: ${why}` }
  }

  revalidatePath('/admin/leads')
  revalidatePath(`/admin/leads/${leadId}`)
  return { ok: kind === 'CALL' ? 'Call recorded.' : 'Note added.' }
}

export interface WalkthroughIcsResult {
  error?: string
  filename?: string
  /** The whole file, handed back for the browser to save. See below. */
  ics?: string
}

/**
 * The walkthrough, as a calendar file.
 *
 * ---------------------------------------------------------------------------
 * AN ACTION, NOT A ROUTE
 * ---------------------------------------------------------------------------
 * The obvious shape is `/admin/leads/[leadId]/walkthrough.ics`, and it would be
 * a URL carrying a prospect's dealership name, their contact details and the
 * fact that we are courting them — reachable by anyone who guesses a uuid
 * unless the handler remembers its own platform-admin check. A server action
 * carries the session by construction and cannot be fetched by a crawler,
 * which is why the file comes back as a string for the browser to save rather
 * than as a download from a path. The console has never published a lead and
 * this is not the feature that starts.
 *
 * Returning the whole file is comfortable at this size: one event is well
 * under a kilobyte, far inside the 1MB an action response allows.
 */
export async function walkthroughIcs(leadId: string): Promise<WalkthroughIcsResult> {
  await requirePlatformAdmin()

  if (!leadId) return { error: 'No lead named.' }

  const db = getDb()

  const [lead] = await db
    .select({
      dealershipName: schema.demoRequests.dealershipName,
      name: schema.demoRequests.name,
      email: schema.demoRequests.email,
      phone: schema.demoRequests.phone,
      walkthroughAt: schema.demoRequests.walkthroughAt,
    })
    .from(schema.demoRequests)
    .where(eq(schema.demoRequests.id, leadId))
    .limit(1)

  if (!lead) return { error: 'That lead no longer exists.' }
  if (!lead.walkthroughAt) return { error: 'Nothing is booked yet.' }

  const ics = buildWalkthroughIcs({
    // The lead id, so a rebooking replaces the entry already in the calendar
    // rather than leaving two. UIDs only have to be globally unique; the
    // domain is cosmetic.
    uid: `walkthrough-${leadId}@dealertech.io`,
    start: lead.walkthroughAt,
    durationMinutes: WALKTHROUGH_MINUTES,
    summary: `DealerTech walkthrough — ${lead.dealershipName}`,
    description: [
      `${lead.name} · ${lead.email}${lead.phone ? ` · ${lead.phone}` : ''}`,
      `Lead: /admin/leads/${leadId}`,
    ].join('\n'),
    stamp: new Date(),
    /*
      Always zero, and deliberately so rather than counting rebookings.

      A calendar ignores a repeat of a UID it already holds at the same
      sequence — which is exactly what a rebooked walkthrough looks like — so
      this wants to increment. It cannot yet: nothing counts how many times a
      demo moved, and a column for a file one person imports by hand is more
      machinery than the problem deserves. Re-importing after a move may need
      the old entry deleted first, which is a sentence beside the button rather
      than a schema change.
    */
    sequence: 0,
  })

  return { filename: icsFilename(lead.dealershipName), ics }
}
