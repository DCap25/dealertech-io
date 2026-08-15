/**
 * Does this odometer reading make sense?
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS WORTH A PROMPT
 * ---------------------------------------------------------------------------
 * An odometer cannot go backwards. When one appears to, exactly one of a small
 * set of things is true, and they are not equally likely:
 *
 *   1. It was just mis-keyed. By far the most common, and the cheapest to fix —
 *      which is why the prompt's first option is "go back and correct it"
 *      rather than a reason to accept it.
 *   2. The previous visit mis-keyed it, and this reading is the good one.
 *   3. The instrument cluster was replaced, so the odometer genuinely restarted.
 *   4. Something is wrong — wrong vehicle on the appointment, or a tampered
 *      odometer.
 *
 * Silently accepting the number serves none of those. It corrupts the reading
 * series the wear engine fits, it moves every mileage-based warranty and
 * contract decision, and in case 4 it puts a false odometer statement in the
 * dealership's own records — which federal odometer-disclosure law (49 U.S.C.
 * §32705) treats as the dealership's problem, not the customer's.
 *
 * So: warn, make the advisor say which of the above it is, and keep the record.
 *
 * Pure and I/O-free. The caller supplies the history and does the writes.
 */

export interface LastReading {
  mileage: number
  recordedAt: Date
  /** WRITE_UP, DMS_IMPORT, INSPECTION — where the number came from. */
  source: string
}

/**
 * A guess at what went wrong, when the shape of the number gives it away.
 *
 * Only ever a suggestion. The advisor is looking at the actual cluster and we
 * are not, so this never decides anything — it just saves them the arithmetic.
 */
export interface LikelyCause {
  kind: 'DROPPED_DIGIT' | 'TRIP_METER'
  message: string
}

export type OdometerCheck =
  | { status: 'OK' }
  | {
      status: 'BELOW_LAST_READING'
      /** Only changes the wording. Any decrease needs confirming. */
      severity: 'MINOR' | 'MAJOR'
      entered: number
      shortfall: number
      last: LastReading
      likelyCause: LikelyCause | null
      headline: string
    }

/**
 * Where the wording changes from "check that" to "this needs explaining".
 *
 * Five hundred miles. Below it, the everyday explanations are boring and
 * likely: the previous number was rounded, typed from memory, or read off a
 * projection rather than the cluster. Above it, none of those stretch far
 * enough and something specific happened.
 *
 * A judgement call, not a standard. It is deliberately only allowed to change
 * how loud the prompt is — never whether one appears — so getting it slightly
 * wrong costs tone, not correctness.
 */
const MAJOR_SHORTFALL = 500

/** Below this, a large odometer almost certainly means the trip meter was read. */
const TRIP_METER_CEILING = 1_000

function digits(n: number): string {
  return String(Math.trunc(Math.abs(n)))
}

/**
 * 91,710 typed as 9,171.
 *
 * Caught by shape rather than by magnitude: the entry is the previous reading
 * with its last digit missing. Specific enough to name out loud, which is what
 * makes it useful — "did you drop a digit?" is actionable where "that seems
 * low" is not.
 */
function droppedDigit(entered: number, last: number): boolean {
  const a = digits(entered)
  const b = digits(last)
  return b.length === a.length + 1 && b.startsWith(a)
}

function causeFor(entered: number, last: number): LikelyCause | null {
  if (droppedDigit(entered, last)) {
    return {
      kind: 'DROPPED_DIGIT',
      message:
        `${entered.toLocaleString()} is ${last.toLocaleString()} with the last digit missing. ` +
        `Worth a second look before you accept it.`,
    }
  }
  if (entered < TRIP_METER_CEILING && last >= TRIP_METER_CEILING) {
    return {
      kind: 'TRIP_METER',
      message:
        `${entered.toLocaleString()} on a vehicle last seen at ${last.toLocaleString()} is the ` +
        `range a trip meter reads. Check which display you are looking at.`,
    }
  }
  return null
}

/**
 * Compare a proposed reading against the last one actually recorded.
 *
 * `last` is the newest real *reading*, never a projection. The write-up field
 * is prefilled with a projected odometer so the advisor has something to
 * correct rather than an empty box, and comparing an entry against that
 * estimate would fire this warning on half the drive.
 */
export function checkOdometer(entered: number, last: LastReading | null): OdometerCheck {
  if (!last) return { status: 'OK' }
  if (!Number.isFinite(entered) || entered <= 0) return { status: 'OK' }
  if (entered >= last.mileage) return { status: 'OK' }

  const shortfall = last.mileage - entered

  return {
    status: 'BELOW_LAST_READING',
    severity: shortfall >= MAJOR_SHORTFALL ? 'MAJOR' : 'MINOR',
    entered,
    shortfall,
    last,
    likelyCause: causeFor(entered, last.mileage),
    headline:
      `${entered.toLocaleString()} is ${shortfall.toLocaleString()} miles below the last ` +
      `recorded reading of ${last.mileage.toLocaleString()}.`,
  }
}

/**
 * Reasons an advisor may record for accepting a lower reading.
 *
 * "I mis-typed it" is deliberately absent. That is not a reason to accept the
 * number, it is a reason to go back and change it, and the prompt offers that
 * as the way out instead. Every option here is a claim about the vehicle or
 * the record — something that stays true after the advisor walks away.
 */
export const OVERRIDE_REASONS = [
  {
    code: 'PRIOR_ENTRY_WRONG',
    label: 'The previous reading was recorded wrong',
    hint: 'Today’s number is correct and the old one was a mis-key.',
  },
  {
    code: 'CLUSTER_REPLACED',
    label: 'Instrument cluster has been replaced',
    hint: 'The odometer genuinely restarted. Note the paperwork if there is any.',
  },
  {
    code: 'OTHER',
    label: 'Something else',
    hint: 'Say what it is. This is the note anyone reviewing the file will read.',
  },
] as const

export type OverrideReasonCode = (typeof OVERRIDE_REASONS)[number]['code']

const REASON_CODES = new Set<string>(OVERRIDE_REASONS.map((r) => r.code))

export interface OverrideSubmission {
  reasonCode: string
  note: string
}

/**
 * Is this a confirmation we are willing to file?
 *
 * "Something else" with an empty box is not an explanation, and a record that
 * says only OTHER is worth less than no record at all — it looks like diligence
 * without carrying any. Everything else stands on its label.
 */
export function validateOverride(
  submission: OverrideSubmission | null,
): { ok: true; reasonCode: OverrideReasonCode; note: string } | { ok: false; error: string } {
  if (!submission || !submission.reasonCode) {
    return { ok: false, error: 'Confirm the lower odometer reading before opening the RO.' }
  }
  if (!REASON_CODES.has(submission.reasonCode)) {
    return { ok: false, error: 'Pick one of the listed reasons.' }
  }
  const note = submission.note.trim()
  if (submission.reasonCode === 'OTHER' && note.length < 4) {
    return { ok: false, error: 'Say what happened — "other" on its own is not a record.' }
  }
  return { ok: true, reasonCode: submission.reasonCode as OverrideReasonCode, note }
}

/**
 * Where a reading came from, in words.
 *
 * Returns null for anything unrecognised rather than de-slugging it. "Recorded
 * 8/12/2026 from current" is what happens when you lowercase a raw enum and
 * hope, and it reads as a bug to the advisor — better to say only the date.
 */
export function readingSourceLabel(source: string): string | null {
  switch (source.toUpperCase()) {
    case 'WRITE_UP': return 'a previous write-up'
    case 'RO': return 'a previous repair order'
    case 'INSPECTION': return 'a technician inspection'
    case 'DMS_IMPORT': return 'the DMS'
    case 'MANUAL': return 'a manual entry'
    // 'CURRENT' and anything else fall through on purpose. CURRENT is not a
    // source, it is the vehicle record's own odometer field, and naming it
    // would tell the advisor nothing they can act on.
    default: return null
  }
}

/** One line for the audit trail, assembled from the reason and the numbers. */
export function overrideSummary(
  reasonCode: OverrideReasonCode,
  note: string,
  entered: number,
  previous: number,
): string {
  const label = OVERRIDE_REASONS.find((r) => r.code === reasonCode)?.label ?? reasonCode
  const base = `Accepted ${entered.toLocaleString()} against a previous ${previous.toLocaleString()} — ${label}.`
  return note ? `${base} ${note}` : base
}
