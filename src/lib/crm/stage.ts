/**
 * Where a lead stands, computed from what actually happened.
 *
 * ---------------------------------------------------------------------------
 * DERIVATION, NOT DECLARATION
 * ---------------------------------------------------------------------------
 * The obvious pipeline is a `stage` column and a board that drags cards
 * between its values, and it would be wrong here for the reason
 * `recordLeadOutcome` already gave about inventing a vocabulary too early: a
 * stored stage is a second opinion about facts that are already recorded
 * elsewhere, and the two drift the first time somebody forgets to move a card.
 *
 * So there is no stage column (migration 0035 says so at length). Every stage
 * below is proved by something that happened, and this function reports the
 * furthest one. Nobody drags a card backwards because the facts do not move
 * backwards.
 *
 * ---------------------------------------------------------------------------
 * THE TWO PLACES A HUMAN STILL HAS TO SAY SOMETHING
 * ---------------------------------------------------------------------------
 * `walkthroughDoneAt` — no fact observes whether a call took place, and a
 * booking whose time has passed is not evidence anybody dialled in. And
 * `lostAt` — a deal that ended is a decision, never an absence of activity.
 * Both are recorded deliberately, which is why LOST requires a reason.
 *
 * Pure and I/O-free. The facts are gathered in `src/lib/platform/load.ts`.
 */

/**
 * The road, in order. The index is the ordering — the furthest fact wins, so
 * inserting a stage in the middle is a deliberate edit to this array and
 * nothing else.
 */
export const LEAD_STAGES = [
  'NEW',
  'CONTACTED',
  'CODE_SENT',
  'TOURED',
  'WALKTHROUGH_BOOKED',
  'WALKTHROUGH_DONE',
  'PROVISIONED',
  'LIVE',
] as const

export type LeadProgressStage = (typeof LEAD_STAGES)[number]

/**
 * LOST is not on the road, it is off it.
 *
 * Kept out of `LEAD_STAGES` on purpose: it has no position in the ordering
 * because it is not further along than anything, it is terminal. A lead lost
 * after a walkthrough and one lost before the first call are equally lost.
 */
export type LeadStage = LeadProgressStage | 'LOST'

/** Every tab the pipeline shows, in the order it shows them. */
export const ALL_LEAD_STAGES: readonly LeadStage[] = [...LEAD_STAGES, 'LOST']

/** Short enough for a chip, and what the chip means in plain words. */
export const STAGE_LABEL: Record<LeadStage, string> = {
  NEW: 'new',
  CONTACTED: 'contacted',
  CODE_SENT: 'code sent',
  TOURED: 'toured',
  WALKTHROUGH_BOOKED: 'walkthrough booked',
  WALKTHROUGH_DONE: 'walkthrough done',
  PROVISIONED: 'provisioned',
  LIVE: 'live',
  LOST: 'lost',
}

/**
 * Everything the stage is computed from.
 *
 * Primitives and dates rather than rows, so the decision can be tested against
 * a lead that does not exist — the same shape `StoreSignals` takes for
 * onboarding.
 */
export interface LeadFacts {
  /** Somebody rang them and said so. */
  contacted: boolean
  contactedAt: Date | null
  /** Tour codes issued to this lead, live or not. */
  codesIssued: number
  /** Codes with at least one redemption. Somebody walked the product. */
  codesRedeemed: number
  /** Newest issue, for the "issued 3d ago, never used" nudge. */
  lastCodeIssuedAt: Date | null
  /** The soonest a live, unused code stops working. Null when none is live. */
  liveCodeExpiresAt: Date | null
  walkthroughAt: Date | null
  walkthroughDoneAt: Date | null
  /** The organisation this lead became, once provisioning has run. */
  provisionedOrgId: string | null
  /** That organisation's first presented menu — the moment it is really live. */
  firstMenuAt: Date | null
  lostAt: Date | null
  lostReason: string | null
  /** The newest note, call or system entry, whichever it was. */
  lastActivityAt: Date | null
}

export interface DerivedStage {
  stage: LeadStage
  /**
   * The fact that proves it, in words.
   *
   * Rendered next to the chip, because a stage nobody can trace back to an
   * event is exactly the unfalsifiable board this design exists to avoid.
   */
  because: string
}

function day(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * The stage, and the fact behind it.
 *
 * `asOf` is a parameter rather than a clock read here for the reason every
 * console page hoists its own: a list whose rows each read the wall clock can
 * show two leads on opposite sides of the same boundary.
 */
export function deriveStage(facts: LeadFacts, asOf: Date): DerivedStage {
  /*
    LOST beats everything, including LIVE.

    Deliberately not "unless they are already a customer": a dealership that
    signed, went live and then walked is the single most important row on the
    page, and burying it under a green LIVE chip is how a churn goes unnoticed
    for a month. The reason is right there in the sentence.
  */
  if (facts.lostAt) {
    return {
      stage: 'LOST',
      because: facts.lostReason
        ? `lost ${day(facts.lostAt)} — ${facts.lostReason}`
        : `lost ${day(facts.lostAt)}`,
    }
  }

  // Furthest first, so the first match is the answer and the ordering lives in
  // one place rather than in a chain of comparisons.
  if (facts.firstMenuAt) {
    return { stage: 'LIVE', because: `first menu presented ${day(facts.firstMenuAt)}` }
  }
  if (facts.provisionedOrgId) {
    return { stage: 'PROVISIONED', because: 'dealership created and administrator invited' }
  }
  if (facts.walkthroughDoneAt) {
    return { stage: 'WALKTHROUGH_DONE', because: `walkthrough held ${day(facts.walkthroughDoneAt)}` }
  }
  if (facts.walkthroughAt) {
    /*
      A booking in the past is still a booking.

      The scope note put "future" beside this row, and taken literally it would
      mean a lead silently sliding back to TOURED the moment its appointment
      time passes — a card moving backwards on its own, which is the one thing
      derivation is here to prevent. The clock changes the sentence, not the
      stage: past reads as a prompt to mark it done.
    */
    return {
      stage: 'WALKTHROUGH_BOOKED',
      because: facts.walkthroughAt.getTime() > asOf.getTime()
        ? `booked for ${day(facts.walkthroughAt)}`
        : `was booked for ${day(facts.walkthroughAt)} — mark it done`,
    }
  }
  if (facts.codesRedeemed > 0) {
    return {
      stage: 'TOURED',
      because: `${facts.codesRedeemed} tour code${facts.codesRedeemed === 1 ? '' : 's'} redeemed`,
    }
  }
  if (facts.codesIssued > 0) {
    return {
      stage: 'CODE_SENT',
      because: facts.lastCodeIssuedAt
        ? `tour code issued ${day(facts.lastCodeIssuedAt)}, never used`
        : 'tour code issued, never used',
    }
  }
  if (facts.contacted) {
    return {
      stage: 'CONTACTED',
      because: facts.contactedAt ? `rung ${day(facts.contactedAt)}` : 'marked contacted',
    }
  }
  return { stage: 'NEW', because: 'nobody has rung them' }
}

/** Where a stage sits on the road. LOST is off it and sorts last. */
export function stageOrder(stage: LeadStage): number {
  const i = (LEAD_STAGES as readonly string[]).indexOf(stage)
  return i === -1 ? LEAD_STAGES.length : i
}

const DAY_MS = 86_400_000

/**
 * How close to expiry an unused tour code has to be before it is a phone call.
 *
 * Three days out of seven. Earlier is noise on a code issued this morning;
 * later is a warning that first appears on the day it stops mattering.
 */
export const CODE_EXPIRY_WARNING_DAYS = 3

/**
 * A code they can still use, running out, that nobody has opened.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS ASKS THE DERIVATION RATHER THAN RE-STATING IT
 * ---------------------------------------------------------------------------
 * The morning read's tile links to the CODE_SENT tab, so the count and the tab
 * have to describe the same leads or the tile is a lie that costs somebody a
 * click to discover. This was originally a condition written inline in
 * `loadNeedsAttention` — three fields and no exclusions — which counted a lead
 * that had been marked lost, or provisioned, and sent whoever clicked to a tab
 * that does not contain it.
 *
 * Asking `deriveStage` is what makes the agreement structural instead of a
 * pair of conditions somebody has to keep in step. Every lead this returns
 * true for is on the CODE_SENT tab by construction; there is no third opinion
 * about lost, provisioned, toured or booked to drift.
 */
export function hasCodeExpiringUnused(facts: LeadFacts, asOf: Date): boolean {
  if (deriveStage(facts, asOf).stage !== 'CODE_SENT') return false
  if (!facts.liveCodeExpiresAt) return false

  const left = facts.liveCodeExpiresAt.getTime() - asOf.getTime()
  // Already expired is not "expiring" — it is a code that needs reissuing, and
  // `nextStep` says so. A tile counting dead codes never reaches zero.
  return left > 0 && left < CODE_EXPIRY_WARNING_DAYS * DAY_MS
}

/**
 * Nobody has done anything about this lead at all.
 *
 * The morning read's first tile counted `contacted = false` in SQL while the
 * tab it links to showed derived-stage NEW, so a lead nobody had rung but who
 * had been sent a tour code was on the tile and absent from the tab. One
 * derivation, one answer.
 */
export function isNewLead(facts: LeadFacts, asOf: Date): boolean {
  return deriveStage(facts, asOf).stage === 'NEW'
}

/**
 * The one sentence saying what to do about this lead, or nothing.
 *
 * Separate from `because`, which explains the chip. This is the nag: it only
 * ever speaks when there is something a person should actually do, because a
 * hint on every row is a hint nobody reads.
 */
export function nextStep(facts: LeadFacts, asOf: Date): string | null {
  if (facts.lostAt) return null

  const now = asOf.getTime()
  const daysSince = (d: Date) => Math.floor((now - d.getTime()) / DAY_MS)

  if (facts.firstMenuAt) return null

  if (facts.provisionedOrgId) {
    return 'Provisioned, no menu presented yet — check their setup.'
  }

  if (facts.walkthroughAt && !facts.walkthroughDoneAt) {
    return facts.walkthroughAt.getTime() > now
      ? null
      : `Walkthrough was ${day(facts.walkthroughAt)}. Mark it done, or rebook.`
  }

  if (facts.walkthroughDoneAt) {
    return 'Walkthrough held. Set their dealership up, or record the loss.'
  }

  if (facts.codesIssued > 0 && facts.codesRedeemed === 0) {
    /*
      The fact the tour-code panel already surfaces per code, said once for the
      lead. A code issued four days ago that nobody opened is a walkthrough
      quietly not happening, and it is invisible on a list of stage chips.
    */
    const issued = facts.lastCodeIssuedAt ? `${daysSince(facts.lastCodeIssuedAt)}d ago` : 'recently'

    /*
      No live code left, so do not nag about one nobody can use.

      `liveCodeExpiresAt` is null when every code on this lead has been
      withdrawn or has run out — and telling Dan that a code he pulled himself
      is "never used" reads as the console not having noticed. It also names
      the only move left, which is not "chase them" but "send another one".

      Withdrawn and expired are deliberately one sentence. They differ in how
      the code died and not at all in what happens next, and a second branch
      would need a fact the console does not carry to tell them apart.
    */
    if (!facts.liveCodeExpiresAt) {
      return `Code issued ${issued} is withdrawn or expired — issue another.`
    }

    return hasCodeExpiringUnused(facts, asOf)
      ? `Code issued ${issued}, never used, expires within three days.`
      : `Code issued ${issued}, never used.`
  }

  if (facts.codesRedeemed > 0) return 'They walked the tour. Book the walkthrough.'

  if (!facts.contacted) return 'Nobody has rung them.'

  const since = facts.lastActivityAt ?? facts.contactedAt
  if (since && daysSince(since) >= QUIET_DAYS) {
    return `Nothing has happened for ${daysSince(since)} days.`
  }

  return null
}

/**
 * How long a lead may sit before the morning read calls it quiet.
 *
 * Seven days: long enough that a call on Monday is not a nag by Friday, short
 * enough that a conversation cannot go a fortnight without anybody noticing.
 * Exported so the tile and the hint cannot disagree about the number.
 */
export const QUIET_DAYS = 7

/**
 * Has this lead gone quiet?
 *
 * Terminal and provisioned leads never have. Neither does one nobody has ever
 * rung and never wrote anything about: that is the "Leads not contacted" tile's
 * row, and a morning read where two counts mean the same lead is one where
 * clearing the first does not visibly shorten the second.
 */
export function hasGoneQuiet(facts: LeadFacts, asOf: Date): boolean {
  if (facts.lostAt || facts.provisionedOrgId || facts.firstMenuAt) return false
  // A walkthrough on the books is not silence, however long it has been.
  if (facts.walkthroughAt && facts.walkthroughAt.getTime() > asOf.getTime()) return false

  const since = facts.lastActivityAt ?? facts.contactedAt
  if (!since) return false
  return asOf.getTime() - since.getTime() >= QUIET_DAYS * DAY_MS
}
