import { createHash } from 'node:crypto'
import type { HandOffLine, HandOffPayload } from './types'

/**
 * Making a push to the DMS something you can answer questions about.
 *
 * The adapter contract has been able to push a hand-off for a while. What it
 * could not do is tell you afterwards whether it worked. The result lived in
 * React state, so reloading the page lost it, and "did this reach the DMS?"
 * had no answer — which is exactly the question an advisor asks when a
 * customer rings about work that never got done.
 *
 * Pure. Hashing and formatting only; the writing lives in ./handoff-store.
 */

/**
 * Where a decision came from.
 *
 * Now that a customer can tap Yes on a tablet in their own hands, "who
 * approved this" has two possible answers and they are not the same thing. On
 * a disputed line, "the customer selected it on Lane 3 at 8:12" is a different
 * conversation from "the advisor recorded it".
 */
export type DecisionSource = 'ADVISOR' | 'CUSTOMER'

export type HandOffStatus = 'SENT' | 'FAILED'

/**
 * Identifies a push by what is in it, not by when it happened.
 *
 * A double-tap, a retry after a timeout, or a page reload followed by another
 * push must not create a second repair order. Two pushes carrying identical
 * content produce the same key and the second returns the first one's result.
 *
 * A push whose content has genuinely changed — the advisor added a line, the
 * customer changed their mind — hashes differently and is a real second
 * hand-off, because it is.
 */
export function idempotencyKey(payload: HandOffPayload): string {
  const signature = (line: HandOffLine) =>
    [
      line.title,
      line.componentGroupKey ?? '',
      line.recommendedPayType,
      line.estimatedAmount.toFixed(2),
      line.customerOutOfPocket.toFixed(2),
    ].join('|')

  // Sorted so the order lines happen to be in never changes the identity of
  // the push — the advisor reordering the menu is not a different hand-off.
  const body = [
    payload.appointmentId ?? '',
    payload.customerId,
    payload.vehicleId,
    String(payload.mileage ?? ''),
    'ACCEPTED',
    ...payload.accepted.map(signature).sort(),
    'DECLINED',
    ...payload.declined.map(signature).sort(),
  ].join('\n')

  return createHash('sha256').update(body).digest('hex')
}

/**
 * A line describing where each approval came from, appended to the note.
 *
 * The note is the part that survives without our UI — it lands in a DMS
 * comment field and is what somebody reads two months later. If the customer
 * chose it themselves, that belongs in the durable record rather than in a
 * table only we can query.
 */
export function provenanceNote(
  sources: Record<string, DecisionSource>,
  acceptedIds: string[],
  deviceName?: string | null,
): string | null {
  const byCustomer = acceptedIds.filter((id) => sources[id] === 'CUSTOMER')
  if (byCustomer.length === 0) return null

  const where = deviceName ? ` on ${deviceName}` : ''
  return byCustomer.length === acceptedIds.length
    ? `All approvals selected by the customer${where}.`
    : `${byCustomer.length} of ${acceptedIds.length} approvals selected by the customer${where}; the rest recorded by the advisor.`
}

/** Appends provenance to a built note without the caller reformatting it. */
export function withProvenance(note: string, provenance: string | null): string {
  return provenance ? `${note}\n\n${provenance}` : note
}

/**
 * What the advisor sees about a push that already happened.
 *
 * Deliberately carries the vendor and whether the write was persisted, so the
 * UI never has to infer either. A mock that logged to a file and a real DMS
 * that created an RO both return ok — only the adapter knows the difference,
 * and the advisor deserves to.
 */
export interface HandOffReceipt {
  id: string
  status: HandOffStatus
  vendor: string
  persisted: boolean
  externalRef: string | null
  message: string
  acceptedCount: number
  attempts: number
  sentAt: Date | null
  createdAt: Date
}

/** One line an advisor can read at a glance. */
export function describeReceipt(receipt: HandOffReceipt): string {
  if (receipt.status === 'FAILED') {
    return receipt.attempts > 1
      ? `Not sent after ${receipt.attempts} attempts.`
      : 'Not sent.'
  }
  const ref = receipt.externalRef ? ` · ${receipt.externalRef}` : ''
  const when = receipt.sentAt
    ? receipt.sentAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : ''
  return receipt.persisted
    ? `Sent to ${receipt.vendor} at ${when}${ref}`
    : `Recorded against ${receipt.vendor} at ${when}${ref} — not a real DMS write`
}
