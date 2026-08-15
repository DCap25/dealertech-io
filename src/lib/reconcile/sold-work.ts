/**
 * What a closed repair order settles.
 *
 * ---------------------------------------------------------------------------
 * THE PROBLEM THIS EXISTS FOR
 * ---------------------------------------------------------------------------
 * A customer declined a coolant flush in June. In August they came back and
 * bought it. The RO closed, the money was taken — and the coolant flush stayed
 * on their record as open declined work, with a follow-up task telling the BDC
 * to ring them and re-offer it.
 *
 * Calling a customer to sell them something they have already paid for is worse
 * than not calling at all. It says, in one phone call, that the shop does not
 * read its own records. Everything else the product claims about knowing the
 * customer dies with it.
 *
 * Pure and I/O-free. It decides what a close settles; the caller does the
 * writes.
 */

/** A line as the close path sees it. */
export interface ClosedLine {
  componentGroupKey: string | null
  /** RECOMMENDED / APPROVED / DECLINED / COMPLETE. */
  status: string
}

/**
 * Line states that mean the work actually happened.
 *
 * Pay type is deliberately not consulted. Warranty, internal and customer-pay
 * all mean the same thing here: the job is done, so nobody should be chased
 * about it. Who paid is a different question from whether it needs doing.
 */
const PERFORMED = new Set(['APPROVED', 'COMPLETE'])

/**
 * The component groups this visit actually settled.
 *
 * A line declined *on this same RO* settles nothing — that is a fresh decline,
 * not a resolution, and treating it as one would silently bury the largest
 * revenue pool in the shop.
 */
export function soldComponentGroups(lines: ClosedLine[]): string[] {
  const groups = new Set<string>()
  for (const line of lines) {
    if (!PERFORMED.has(line.status)) continue
    if (!line.componentGroupKey) continue
    groups.add(line.componentGroupKey)
  }
  return [...groups]
}
