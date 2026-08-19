import { differenceInCalendarDays } from 'date-fns'
import { CHURN_AFTER_DAYS, GRACE_DAYS, type LifecycleStatus } from './lifecycle'

/**
 * What a tenant may do today.
 *
 * ---------------------------------------------------------------------------
 * THE RULE THIS FILE EXISTS TO ENFORCE
 * ---------------------------------------------------------------------------
 * **A billing problem must never break the drive.**
 *
 * An advisor is standing in front of a customer at nine in the morning with
 * eight cars behind them. Whatever is happening between our invoicing and
 * their accounts payable, that conversation has to work. A dealership that
 * cannot present a menu because a card expired does not experience a billing
 * problem; they experience a broken product, and they are right to.
 *
 * So the ladder below never touches the drive. Every rung takes away
 * administrative surface — inviting staff, exporting data, changing the DMS
 * connection — and the two rungs that would genuinely stop work are reachable
 * only by a human decision, never by a job.
 *
 * ---------------------------------------------------------------------------
 * AND THE DELIBERATE INVERSION OF DENY-BY-DEFAULT
 * ---------------------------------------------------------------------------
 * Everywhere else in this codebase, missing configuration refuses. The cron
 * endpoint with no secret turns away every request; a menu item with no op
 * code shows "price to be confirmed" rather than a guess.
 *
 * This file inverts that, and it is the only place that does. An unknown or
 * contradictory billing state resolves to FULL access. The asymmetry is the
 * reason: a cron endpoint that falls open lets a stranger run a job, while
 * access that falls closed locks a paying dealership out of their own morning
 * over a bug in our bookkeeping. Fail open for the drive, fail loud to us —
 * `needsAttention` is how it gets loud.
 *
 * Pure and I/O-free. Nothing here reads a database or a clock it was not given.
 */

export type AccessLevel = 'FULL' | 'GRACE' | 'RESTRICTED' | 'SUSPENDED'

/**
 * Things a tenant can lose, and the drive is not among them.
 *
 * Named for what the user is trying to do rather than for a route, so a guard
 * reads as `requireAccess('INVITE_STAFF')` and survives the page being moved.
 */
export type GuardedAction =
  | 'INVITE_STAFF'
  | 'MANAGE_STAFF'
  | 'EXPORT_DATA'
  | 'MANAGE_INTEGRATIONS'
  | 'ADD_STORE'

/** Who a banner is for. Advisors are deliberately never told about money. */
export type BannerAudience = 'MANAGERS' | 'EVERYONE'

export interface AccessBanner {
  audience: BannerAudience
  tone: 'INFO' | 'WARNING' | 'CRITICAL'
  message: string
}

export interface AccessDecision {
  level: AccessLevel
  /** Empty at FULL. */
  blockedActions: GuardedAction[]
  banner: AccessBanner | null
  /** True when the drive still works end to end. False only at SUSPENDED. */
  canWork: boolean
  /**
   * Something is wrong with our own records and a human should look.
   *
   * Separate from the level on purpose: this never restricts anybody. It is
   * the "fail loud to us" half of the rule above, and it surfaces on the
   * platform console rather than to the dealership.
   */
  needsAttention: string | null
}

/** Everything an administrator can lose. The drive is not in this list. */
const ADMIN_ACTIONS: GuardedAction[] = [
  'INVITE_STAFF', 'MANAGE_STAFF', 'EXPORT_DATA', 'MANAGE_INTEGRATIONS', 'ADD_STORE',
]

function full(needsAttention: string | null = null): AccessDecision {
  return { level: 'FULL', blockedActions: [], banner: null, canWork: true, needsAttention }
}

export interface AccessInput {
  status: LifecycleStatus | null | undefined
  statusChangedAt: Date | null | undefined
  trialEndsAt?: Date | null
  asOf: Date
}

/**
 * Resolve what this tenant may do.
 *
 * Called once per request off the session, so it must stay cheap and must
 * never throw — a page that cannot render because the access engine tripped
 * over a null is exactly the outage this design is meant to prevent.
 */
export function resolveAccess(input: AccessInput): AccessDecision {
  const { status, statusChangedAt, asOf } = input

  /*
    No status at all.

    Reachable for an organization created before billing existed, or by a race
    between provisioning and the first lifecycle write. Full access, and a note
    for us — see the header.
  */
  if (!status) {
    return full('Organization has no lifecycle status. Access granted by default; investigate.')
  }

  const daysInStatus = statusChangedAt
    ? Math.max(0, differenceInCalendarDays(asOf, statusChangedAt))
    : 0

  switch (status) {
    case 'ACTIVE':
    case 'COMPED':
      return full()

    case 'TRIAL': {
      const daysLeft = input.trialEndsAt
        ? differenceInCalendarDays(input.trialEndsAt, asOf)
        : null

      // A trial is not a degraded state. It is the product, working, for
      // somebody deciding whether to buy it — the worst possible moment to
      // show them less than they are evaluating.
      if (daysLeft !== null && daysLeft <= 7) {
        return {
          ...full(),
          banner: {
            audience: 'MANAGERS',
            tone: daysLeft <= 3 ? 'WARNING' : 'INFO',
            message: daysLeft <= 0
              ? 'Your trial ends today.'
              : `Your trial ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`,
          },
        }
      }
      return full()
    }

    case 'PAST_DUE': {
      /*
        Everything still works, and only managers are told.

        An advisor learning about a failed card while a customer watches them
        read it is a worse outcome than the failed card. The people who can
        actually fix it are the ones who see it.
      */
      const daysLeft = Math.max(0, GRACE_DAYS - daysInStatus)
      return {
        level: 'GRACE',
        blockedActions: [],
        canWork: true,
        needsAttention: null,
        banner: {
          audience: 'MANAGERS',
          tone: daysLeft <= 3 ? 'WARNING' : 'INFO',
          message:
            `A payment did not go through. Everything keeps working for ${daysLeft} more day` +
            `${daysLeft === 1 ? '' : 's'}; update the card to avoid interruption.`,
        },
      }
    }

    case 'RESTRICTED':
      /*
        The drive is untouched. What goes is the administrative surface — and
        ADD_STORE in particular, because a group that is not paying for the
        rooftops it has should not be quietly adding more.

        ADD_STORE is declared and enforced nowhere, on purpose: adding a rooftop
        is platform-admin-only today, so there is no tenant-side call site to
        guard. The reasoning is written out at `createStore` in
        src/lib/invites/provision.ts, which is where the guard will go if that
        ever changes.
      */
      return {
        level: 'RESTRICTED',
        blockedActions: [...ADMIN_ACTIONS],
        canWork: true,
        needsAttention: null,
        banner: {
          audience: 'MANAGERS',
          tone: 'CRITICAL',
          message:
            'Billing needs attention. The drive and customer menus are unaffected, but ' +
            'inviting staff, exporting data and integration changes are paused until this is resolved.',
        },
      }

    case 'SUSPENDED':
      return {
        level: 'SUSPENDED',
        blockedActions: [...ADMIN_ACTIONS],
        canWork: false,
        needsAttention: null,
        banner: {
          audience: 'EVERYONE',
          tone: 'CRITICAL',
          message: 'This account is suspended. Records are readable; new work cannot be saved. Contact DealerTech.',
        },
      }

    case 'EXPIRED':
      return {
        level: 'SUSPENDED',
        blockedActions: [...ADMIN_ACTIONS],
        canWork: false,
        needsAttention: null,
        banner: {
          audience: 'EVERYONE',
          tone: 'CRITICAL',
          message: 'Your trial has ended. Your data is safe and waiting — add a payment method to pick up where you left off.',
        },
      }

    case 'CANCELED': {
      /*
        Finished paying, still working — and the wording matters here.

        This banner used to say access continued "until the end of the paid
        period", which was wrong in both directions. A tenant does not reach
        CANCELED when somebody clicks cancel; scheduling a cancellation leaves
        them ACTIVE, and Stripe only fires the event that lands them here once
        the paid period has *already* ended. So the sentence described a
        deadline that had passed, and named a paid period that a comp ended by
        an administrator never had at all.

        What is actually true of both is this: billing has stopped, and they
        keep everything for the thirty days before CHURNED. Counting them down
        is the same courtesy PAST_DUE gets, and it is the number that decides
        whether somebody picks up the phone.

        They keep working throughout. Taking the product away on the day the
        money stops would be the last impression the product ever leaves.
      */
      const daysLeft = Math.max(0, CHURN_AFTER_DAYS - daysInStatus)
      return {
        level: 'GRACE',
        blockedActions: ['ADD_STORE'],
        canWork: true,
        needsAttention: null,
        banner: {
          audience: 'MANAGERS',
          tone: 'WARNING',
          message:
            'Your subscription has ended. Everything keeps working for '
            + `${daysLeft} more day${daysLeft === 1 ? '' : 's'}, and your records stay yours to `
            + 'export after that. Talk to us if you would like to carry on.',
        },
      }
    }

    case 'CHURNED':
      /*
        Their data is theirs.

        Export survives churn deliberately. A dealership that leaves and cannot
        get their own service history out is one that tells everybody, and they
        would be right to — so EXPORT_DATA is the one thing not blocked here.
      */
      return {
        level: 'SUSPENDED',
        blockedActions: ADMIN_ACTIONS.filter((a) => a !== 'EXPORT_DATA'),
        canWork: false,
        needsAttention: null,
        banner: {
          audience: 'EVERYONE',
          tone: 'CRITICAL',
          message: 'This account is closed. You can still export your data.',
        },
      }

    default: {
      /*
        A status the engine does not recognise.

        Exhaustive above, so this is unreachable today and will not be the day
        somebody adds a value to the enum and not to this file. It resolves to
        full access with a loud note, because a dealership must not lose their
        morning to our incomplete deployment.
      */
      const unknown: never = status
      return full(`Unrecognised lifecycle status "${String(unknown)}". Access granted by default; investigate.`)
    }
  }
}

/** Is this action allowed right now? The shape a guard wants. */
export function permits(decision: AccessDecision, action: GuardedAction): boolean {
  return !decision.blockedActions.includes(action)
}

/**
 * The sentence to refuse with. The other shape a guard wants.
 *
 * ---------------------------------------------------------------------------
 * THREE STATUSES SHARE ONE LEVEL, AND THIS IS WHERE THAT BIT
 * ---------------------------------------------------------------------------
 * `AccessLevel` is a rung on the ladder, not a lifecycle status. SUSPENDED,
 * EXPIRED and CHURNED all resolve to `level: 'SUSPENDED'` because they take the
 * same things away — and the guard that used to live in session.ts switched on
 * that level and hard-coded one sentence for all three. So a dealership whose
 * *free trial had run out* clicked "invite" and read "This account is
 * suspended. Contact DealerTech to restore access.": a sentence about a
 * relationship gone wrong, said to somebody who had not started one yet, and
 * flatly contradicting the banner two inches above it on the same page.
 *
 * The fix is to stop writing the wording down twice. Every restricting branch
 * above already composes one true sentence for its status, reviewed as
 * customer-facing copy; deriving the refusal from it means the banner and the
 * refusal cannot disagree, and a status added later gets its wording once.
 *
 * Only the SUSPENDED family is taken from the banner. At RESTRICTED the banner
 * is a statement of where the account stands and a refusal is an answer to a
 * button somebody just pressed, so that one keeps its own sentence and points
 * at the notice rather than reciting it.
 *
 * The `??` is unreachable today — every branch that restricts anything sets a
 * banner — and is vague on purpose rather than wrong.
 */
export function refusalMessage(decision: AccessDecision): string {
  if (decision.level === 'SUSPENDED') {
    return decision.banner?.message
      ?? 'This account cannot save changes at the moment. Contact DealerTech.'
  }
  return 'Billing needs attention before this can be changed. Everything else keeps working — see the notice at the top of the page.'
}
