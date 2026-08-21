import type { OnboardingProgress, StepKey } from '@/lib/onboarding/steps'

/**
 * The road from "signed" to "advisors working", seen from the console.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT A SECOND CHECKLIST
 * ---------------------------------------------------------------------------
 * The dealership already has one — `src/lib/onboarding/steps.ts`, derived from
 * live data rather than ticked, which is the property worth keeping. Writing a
 * separate platform-side list would mean two implementations of "is their
 * price book in", and the day they disagree is the day a support call starts
 * with the console being wrong.
 *
 * So four of the six rows below are that engine's own verdicts, re-labelled
 * for the person reading them: a founder chasing an onboarding, not a manager
 * setting their own store up. The other two are facts the dealership's
 * checklist has no reason to carry:
 *
 *   * Whether the administrator we invited ever accepted. This is the first
 *     thing that goes wrong and it was invisible — the invitation link is
 *     shown once at provisioning and then gone, so a tenant nobody ever signed
 *     into looked exactly like a healthy one with an empty price book.
 *   * Whether anything is booked. A store with staff, op codes and history and
 *     no appointment has not started using the product, and every other row
 *     can be green while that is true.
 *
 * ---------------------------------------------------------------------------
 * EVERY UNFINISHED ROW CARRIES THE THING THAT FINISHES IT
 * ---------------------------------------------------------------------------
 * A checklist that only reports is a checklist somebody reads once. Each row
 * that is not done names either the screen that does it or the action on this
 * page that does — which is why `pointer` distinguishes the two rather than
 * being a URL for both.
 *
 * Pure and I/O-free. The facts are gathered in ./load.
 */

export interface AdminInvite {
  email: string
  acceptedAt: Date | null
  revokedAt: Date | null
  expiresAt: Date
}

export interface GoLiveFacts {
  /** The dealership's own derived progress, from `loadProgressForPlatform`. */
  progress: OnboardingProgress
  /**
   * The newest administrator invitation at this rooftop, if one was ever sent.
   *
   * Null for a store provisioned before invitations existed, or one whose
   * administrator was created directly by self-serve signup — in which case
   * there is nobody to chase and the row says so.
   */
  adminInvite: AdminInvite | null
  /** Somebody is booked in. Counted, never read. */
  appointmentCount: number
  /**
   * Follow-up rules on this rooftop.
   *
   * Zero is the one row here that is DealerTech's own fault rather than the
   * dealership's: provisioning creates the defaults now, and every tenant
   * stood up before it has none — which means an empty follow-up worklist for
   * ever, reported to them as "nothing to work".
   */
  cadenceRuleCount: number
  /** One instant for the whole page, so two rows cannot disagree about expiry. */
  asOf: Date
}

/** What to do about a row that is not done. */
export type GoLivePointer =
  | { kind: 'LINK'; label: string; href: string }
  /** The invitation cannot be recovered — only its hash is stored. Re-issue. */
  | { kind: 'REINVITE'; email: string }
  /**
   * Fixed from a terminal, not from this page.
   *
   * One row needs it: backfilling the cadence rules a pre-2026-08-20 tenant
   * never got. A button would be the obvious thing and is the wrong one —
   * writing eight rows into somebody else's dealership deserves a person who
   * has read what the script does and passed `--apply`, not a click on a
   * console page that also has a suspend button on it.
   */
  | { kind: 'SCRIPT'; label: string; command: string }
  | { kind: 'WAIT'; label: string }

export interface GoLiveItem {
  key: string
  label: string
  done: boolean
  /** Shown beside a finished row so "done" is legible rather than asserted. */
  detail: string | null
  pointer: GoLivePointer | null
}

/** The four rows the dealership's own engine already decides. */
const FROM_ONBOARDING: { key: StepKey; label: string }[] = [
  { key: 'PRICE_BOOK', label: 'Price book synced' },
  { key: 'HISTORY_IMPORTED', label: 'History imported' },
  { key: 'TEAM_INVITED', label: 'Advisors invited' },
  { key: 'FIRST_MENU_PRESENTED', label: 'First menu presented' },
]

export function goLiveChecklist(facts: GoLiveFacts): GoLiveItem[] {
  const { adminInvite, progress, asOf } = facts

  /*
    The two rows DealerTech owns come first: did the administrator get in, and
    did we give them a follow-up programme. Everything after them is the
    dealership's own work, and reading the list top to bottom follows who is
    responsible rather than what order a screen happens to be in.
  */
  const items: GoLiveItem[] = [adminInviteRow(adminInvite, asOf), cadenceRow(facts)]

  for (const row of FROM_ONBOARDING) {
    const step = progress.steps.find((s) => s.key === row.key)
    if (!step) continue
    items.push({
      key: row.key,
      label: row.label,
      done: step.done,
      detail: step.detail,
      /*
        The dealership's own screen, not a console one. Everything after the
        invitation is theirs to do, and the useful thing a founder can carry
        into a phone call is which page to talk them to.
      */
      pointer: step.done ? null : { kind: 'LINK', label: step.href, href: step.href },
    })

    // First appointment sits between the setup work and the first menu: it is
    // the last thing that happens before the product does its job.
    if (row.key === 'TEAM_INVITED') items.push(appointmentRow(facts))
  }

  return items
}

function adminInviteRow(invite: AdminInvite | null, asOf: Date): GoLiveItem {
  if (!invite) {
    return {
      key: 'ADMIN_INVITE',
      label: 'Administrator has an account',
      // No invitation was ever sent, which is the ordinary state for a
      // self-serve signup: the person who paid created their own account.
      done: true,
      detail: 'signed up directly',
      pointer: null,
    }
  }

  if (invite.acceptedAt) {
    return {
      key: 'ADMIN_INVITE',
      label: 'Administrator accepted their invitation',
      done: true,
      detail: `${invite.email} · ${invite.acceptedAt.toISOString().slice(0, 10)}`,
      pointer: null,
    }
  }

  /*
    Not accepted. The link cannot be shown again — only its SHA-256 is stored,
    which is the whole design of `createInvitation` — so the pointer is a fresh
    invitation rather than a copy of the old one. An expired or withdrawn link
    is the same conversation as a pending one that has gone unanswered for a
    week, so both land here.
  */
  const expired = invite.expiresAt.getTime() < asOf.getTime()
  const state = invite.revokedAt ? 'withdrawn' : expired ? 'expired' : 'sent, not accepted'

  return {
    key: 'ADMIN_INVITE',
    label: 'Administrator accepted their invitation',
    done: false,
    detail: `${invite.email} · ${state}`,
    pointer: { kind: 'REINVITE', email: invite.email },
  }
}

/**
 * Did this rooftop ever get a follow-up programme?
 *
 * The row exists because its absence is invisible from every other direction.
 * `generateTasks` produces nothing without rules, so the dealership's own
 * follow-up screen says "nothing to work" — which reads as the product having
 * looked and found nothing, not as nobody having set it up. Provisioning
 * creates the defaults now (`createStoreOn`); every tenant older than that has
 * an empty worklist and no way to discover it.
 */
function cadenceRow(facts: GoLiveFacts): GoLiveItem {
  const done = facts.cadenceRuleCount > 0
  return {
    key: 'CADENCE_RULES',
    label: 'Follow-up rules present',
    done,
    detail: done ? `${facts.cadenceRuleCount} rule(s)` : 'none — their worklist will stay empty',
    pointer: done ? null : {
      kind: 'SCRIPT',
      label: 'provisioned before the defaults existed — backfill it',
      command: 'npx tsx --env-file=.env.local scripts/backfill-cadence-rules.ts --apply',
    },
  }
}

function appointmentRow(facts: GoLiveFacts): GoLiveItem {
  const done = facts.appointmentCount > 0
  return {
    key: 'FIRST_APPOINTMENT',
    label: 'First appointment booked',
    done,
    detail: done ? `${facts.appointmentCount.toLocaleString()} booked` : null,
    /*
      Nothing DealerTech can do about this one, and saying so is the point.
      A pointer to a screen would imply somebody here can book it; the honest
      answer is that this is the row you ring them about.
    */
    pointer: done ? null : { kind: 'WAIT', label: 'nothing booked yet — worth a call' },
  }
}

/** True once every row is done. The one number worth a badge. */
export function isLive(items: GoLiveItem[]): boolean {
  return items.every((i) => i.done)
}
