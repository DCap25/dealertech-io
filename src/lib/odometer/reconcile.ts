/**
 * When the source system's odometer disagrees with its own history.
 *
 * ---------------------------------------------------------------------------
 * A DIFFERENT PROBLEM FROM THE WRITE-UP WARNING
 * ---------------------------------------------------------------------------
 * At the podium there is an advisor looking at the cluster, so a backwards
 * odometer can be questioned and explained. On an import there is nobody: a
 * bundle arrives, the engine consumes it, and whatever it says about mileage
 * becomes the basis for every warranty and contract decision on that sheet.
 *
 * The useful thing is that the bundle usually contradicts itself. A vehicle
 * record saying 50,000 miles arrives alongside an inspection taken last month
 * at 92,000 and a repair order closed at 88,000. Nothing external is needed to
 * know the vehicle record is wrong — the same payload proves it.
 *
 * ---------------------------------------------------------------------------
 * WHY THE HIGHER NUMBER WINS
 * ---------------------------------------------------------------------------
 * Not because it is certainly right. A genuinely replaced instrument cluster
 * makes the low number the true one, and this will get that case wrong.
 *
 * It is chosen because the two errors are not equal. Understating mileage makes
 * expired warranty look live, so a customer is told "that is covered" and finds
 * out at delivery that it is not — an argument about money, at the worst
 * possible moment, that the dealership caused. Overstating it makes live
 * coverage look expired, which is a quote the advisor or the customer questions
 * before anyone has committed to anything. The first failure is the one worth
 * engineering against.
 *
 * The correction is never silent. It reaches the prep sheet as an alert, so the
 * one case this gets wrong is visible to the person who can fix it.
 *
 * Pure and I/O-free.
 */

export interface MileageObservation {
  mileage: number
  /** Where it came from, in words fit to show an advisor. */
  source: string
  recordedAt: Date | null
}

export interface OdometerCorrection {
  /** What the vehicle record claimed. */
  reported: number
  /** What the engine will use instead. */
  used: number
  /** The observation that outranked it. */
  evidence: MileageObservation
  /** Advisor-facing, and specific enough to act on. */
  message: string
}

export interface OdometerReconciliation {
  mileage: number
  correction: OdometerCorrection | null
}

function newest(observations: MileageObservation[]): MileageObservation | null {
  let best: MileageObservation | null = null
  for (const o of observations) {
    if (!Number.isFinite(o.mileage) || o.mileage <= 0) continue
    if (!best || o.mileage > best.mileage) best = o
  }
  return best
}

/**
 * The odometer to build this sheet on.
 *
 * `reported` is the source system's vehicle record. `history` is every other
 * mileage in the same payload — inspections, closed repair orders, the odometer
 * noted when work was declined.
 */
export function reconcileOdometer(
  reported: number | null,
  history: MileageObservation[],
): OdometerReconciliation {
  const highest = newest(history)
  const base = reported ?? 0

  if (!highest || highest.mileage <= base) {
    return { mileage: base, correction: null }
  }

  const when = highest.recordedAt
    ? ` on ${highest.recordedAt.toLocaleDateString('en-US')}`
    : ''

  return {
    mileage: highest.mileage,
    correction: {
      reported: base,
      used: highest.mileage,
      evidence: highest,
      message:
        `Odometer on file reads ${base.toLocaleString()}, but ${highest.source} recorded ` +
        `${highest.mileage.toLocaleString()}${when}. Working from the higher figure — ` +
        `confirm the actual reading before quoting anything as covered.`,
    },
  }
}
