import { differenceInCalendarDays } from 'date-fns'

/**
 * How far a rooftop is from the product actually working for them.
 *
 * ---------------------------------------------------------------------------
 * OBSERVED, NOT TICKED
 * ---------------------------------------------------------------------------
 * Almost every step here is derived from live data rather than from a stored
 * flag. A checklist of things somebody once ticked is a checklist that lies:
 * a store deletes their op codes and the box stays green, and the first anyone
 * knows is a customer being quoted an estimate the DMS will not honour.
 *
 * Deriving costs a few counts on one page and cannot drift. It is also the
 * honest answer to "is this set up?" — the question is about the state of the
 * dealership, not about whether a manager once visited a screen.
 *
 * ---------------------------------------------------------------------------
 * EXCEPT WHERE A DEFAULT IS INDISTINGUISHABLE FROM A DECISION
 * ---------------------------------------------------------------------------
 * Two steps cannot be observed, and they are exactly the two where the default
 * is legally conservative rather than merely unset.
 *
 * `reauth_threshold_percent` and `reauth_threshold_amount` default to zero and
 * zero, meaning any price increase requires asking the customer again. That is
 * the safe reading of a law that varies by state, and it is also what the
 * column looks like if nobody has ever thought about it. Quiet hours default
 * to the TCPA safe harbour for the same reason.
 *
 * A store that has considered those and kept the defaults is finished; a store
 * that has never seen them is not, and the database cannot tell them apart. So
 * those two are acknowledged — the one place a stored row carries information
 * nothing else does.
 *
 * Pure and I/O-free. The counts come from ./load.
 */

export type StepKey =
  | 'LABOR_RATE'
  | 'TAX_RATES'
  | 'REAUTH_THRESHOLDS'
  | 'QUIET_HOURS'
  | 'PRICE_BOOK'
  | 'TEAM_INVITED'
  | 'HISTORY_IMPORTED'
  | 'FIRST_MENU_PRESENTED'

/**
 * How much the product is wrong without it.
 *
 * Not a priority ordering for its own sake — each says what specifically stops
 * working, because "recommended" with no reason attached is advice nobody acts
 * on.
 */
export type StepWeight = 'ESSENTIAL' | 'RECOMMENDED'

/** Observed from data, or acknowledged by a person. See the header. */
export type StepEvidence = 'DERIVED' | 'ACKNOWLEDGED' | 'MEASURED'

export interface StepDef {
  key: StepKey
  label: string
  /** What does not work until this is done. Shown, not summarised. */
  consequence: string
  weight: StepWeight
  evidence: StepEvidence
  href: string
}

/**
 * What the checklist needs to know, gathered once.
 *
 * Deliberately primitives rather than rows: the decision is pure, so it can be
 * tested against a store that does not exist.
 */
export interface StoreSignals {
  storeCreatedAt: Date
  laborRate: number
  partsTaxRate: number
  laborTaxRate: number
  /** Active roles at this rooftop, including the person who signed up. */
  staffCount: number
  pendingInvites: number
  opCodeCount: number
  /** Declines on file, however they arrived — imported or earned. */
  declineCount: number
  importCount: number
  presentationCount: number
  firstPresentationAt: Date | null
  /** Step keys with an `onboarding_steps` row marked DONE or SKIPPED. */
  acknowledged: Set<string>
}

export const STEPS: StepDef[] = [
  {
    key: 'LABOR_RATE',
    label: 'Set your door rate',
    consequence:
      'Every estimate on every prep sheet is priced from it. At zero, the engine has nothing to quote from.',
    weight: 'ESSENTIAL',
    evidence: 'DERIVED',
    href: '/manager',
  },
  {
    key: 'PRICE_BOOK',
    label: 'Bring in your op codes',
    consequence:
      'Without them every price is our estimate rather than yours, and the customer menu shows “price to be confirmed” instead of a number — deliberately, because we will not quote what your DMS will not charge.',
    weight: 'ESSENTIAL',
    evidence: 'DERIVED',
    href: '/manager',
  },
  {
    key: 'HISTORY_IMPORTED',
    label: 'Import your declined work',
    consequence:
      'Prep sheets are built from what a vehicle has already been through. Until this is done, most lines read “no record on file” and the first morning is worth very little.',
    weight: 'ESSENTIAL',
    evidence: 'DERIVED',
    href: '/import',
  },
  {
    key: 'TAX_RATES',
    label: 'Set your tax rates',
    consequence:
      'Totals shown to a customer are short by the tax until these are right.',
    weight: 'RECOMMENDED',
    evidence: 'DERIVED',
    href: '/manager',
  },
  {
    key: 'TEAM_INVITED',
    label: 'Invite your advisors',
    consequence:
      'One account is a demo. The scorecard, the follow-up list and RO ownership all key off who wrote the visit.',
    weight: 'RECOMMENDED',
    evidence: 'DERIVED',
    href: '/team',
  },
  {
    key: 'REAUTH_THRESHOLDS',
    label: 'Confirm your re-authorisation thresholds',
    consequence:
      'They default to zero and zero, so any price increase asks the customer again. That is the safe reading of a law that varies by state — confirm it is the one your dealership wants.',
    weight: 'RECOMMENDED',
    evidence: 'ACKNOWLEDGED',
    href: '/manager',
  },
  {
    key: 'QUIET_HOURS',
    label: 'Confirm your quiet hours',
    consequence:
      'They default to the 8am–9pm TCPA safe harbour. Confirm it matches how your store contacts customers.',
    weight: 'RECOMMENDED',
    evidence: 'ACKNOWLEDGED',
    href: '/manager',
  },
  {
    key: 'FIRST_MENU_PRESENTED',
    label: 'Present your first menu',
    consequence:
      'The moment the product does its job. Nothing to configure — it happens the first time an advisor turns the screen around.',
    weight: 'RECOMMENDED',
    evidence: 'MEASURED',
    href: '/drive',
  },
]

export interface StepState extends StepDef {
  done: boolean
  /** Shown beside a completed step, so "done" is legible rather than asserted. */
  detail: string | null
}

function isDone(step: StepDef, s: StoreSignals): { done: boolean; detail: string | null } {
  switch (step.key) {
    case 'LABOR_RATE':
      return s.laborRate > 0
        ? { done: true, detail: `$${s.laborRate.toFixed(0)}/hr` }
        : { done: false, detail: null }

    case 'TAX_RATES':
      /*
        Either rate being set counts, and both at zero does not.

        A genuinely tax-free jurisdiction exists — Oregon has no sales tax —
        so this is the one derived step that can be wrong about a legitimate
        store. It is RECOMMENDED rather than ESSENTIAL for that reason, and
        the acknowledgement path covers a store that wants it gone.
      */
      return s.partsTaxRate > 0 || s.laborTaxRate > 0
        ? { done: true, detail: `parts ${(s.partsTaxRate * 100).toFixed(2)}%` }
        : { done: false, detail: null }

    case 'PRICE_BOOK':
      return s.opCodeCount > 0
        ? { done: true, detail: `${s.opCodeCount.toLocaleString()} op codes` }
        : { done: false, detail: null }

    case 'TEAM_INVITED':
      // More than the founder, or an invitation out. Either means somebody
      // has thought about the roster.
      return s.staffCount > 1 || s.pendingInvites > 0
        ? { done: true, detail: `${s.staffCount} staff${s.pendingInvites > 0 ? `, ${s.pendingInvites} invited` : ''}` }
        : { done: false, detail: null }

    case 'HISTORY_IMPORTED':
      /*
        Declines on file, not "an import ran".

        A store already using the product earns declines the ordinary way, and
        telling them to import history they are actively generating would be
        nonsense. The count is what matters; how it got there does not.
      */
      return s.declineCount > 0
        ? {
            done: true,
            detail: `${s.declineCount.toLocaleString()} declines on file${s.importCount > 0 ? ` · ${s.importCount} import(s)` : ''}`,
          }
        : { done: false, detail: null }

    case 'FIRST_MENU_PRESENTED':
      return s.presentationCount > 0
        ? { done: true, detail: `${s.presentationCount.toLocaleString()} presented` }
        : { done: false, detail: null }

    case 'REAUTH_THRESHOLDS':
    case 'QUIET_HOURS':
      return s.acknowledged.has(step.key)
        ? { done: true, detail: 'confirmed' }
        : { done: false, detail: null }
  }
}

export interface OnboardingProgress {
  steps: StepState[]
  doneCount: number
  totalCount: number
  /** Essential steps still outstanding. What a nag should name. */
  outstandingEssential: StepState[]
  /** True once every essential step is done, whatever else is left. */
  readyForTheDrive: boolean
  /**
   * Days from signing up to the first menu in front of a customer.
   *
   * The activation metric, and the only number here worth watching over time.
   * A tenant that never presents a menu is a churn certainty regardless of
   * what their invoice says, which is why the platform console shows this
   * next to their billing status rather than on a separate screen.
   */
  daysToFirstMenu: number | null
}

export function progress(signals: StoreSignals): OnboardingProgress {
  const steps: StepState[] = STEPS.map((step) => ({
    ...step,
    ...isDone(step, signals),
  }))

  const outstandingEssential = steps.filter((s) => !s.done && s.weight === 'ESSENTIAL')

  return {
    steps,
    doneCount: steps.filter((s) => s.done).length,
    totalCount: steps.length,
    outstandingEssential,
    readyForTheDrive: outstandingEssential.length === 0,
    daysToFirstMenu: signals.firstPresentationAt
      ? Math.max(0, differenceInCalendarDays(signals.firstPresentationAt, signals.storeCreatedAt))
      : null,
  }
}

/** The keys a person can confirm. Anything else is observed and cannot be ticked. */
export const ACKNOWLEDGEABLE: StepKey[] = STEPS
  .filter((s) => s.evidence === 'ACKNOWLEDGED')
  .map((s) => s.key)

export function isAcknowledgeable(key: string): key is StepKey {
  return (ACKNOWLEDGEABLE as string[]).includes(key)
}
