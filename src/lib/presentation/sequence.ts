// Not `server-only`, for the same reason `link-store.ts` is not: it is imported
// from that file, which the customer-facing page reaches. It still cannot leave
// the server — it imports the privileged database client.
import { eq, sql } from 'drizzle-orm'
import { getDb, schema } from '@/db/client'

/**
 * Which conversation on the visit a new presentation is.
 *
 * Lives here rather than in either store because both channels write the same
 * column and neither owns it: a link is created in `presentation/link-store.ts`
 * and a tablet menu is pushed from `pairing/store.ts`, and for as long as those
 * were two implementations only one of them counted (F10) — every tablet
 * session took the schema default and claimed to be the visit's first
 * conversation. Two implementations of one rule is the drift migration 0018 was
 * written to prevent, so there is one.
 */

/**
 * The number after the highest already used. Null means none used yet.
 *
 * Separated from the query because it is the whole rule and the query cannot be
 * exercised without a database: a visit whose first menu is being sent is
 * conversation 1, not conversation 0.
 */
export function sequenceAfter(highest: number | null | undefined): number {
  return (highest ?? 0) + 1
}

/**
 * Counted from what is already on the visit rather than assumed.
 *
 * A busy day produces three — a menu at write-up, another after the technician
 * has been under the car, a third at delivery — and a visit where the tablet
 * was never used should still call its first link "1". Counted across every
 * channel, because "which conversation this was" is a fact about the visit and
 * not about the device it happened on.
 *
 * No appointment means no visit to be the second conversation on, so it is
 * always 1: a menu sent against nothing has no history to count.
 *
 * Two menus sent for one visit at the same instant will both read this maximum
 * and both write the same number. Nothing complains — the visit index is not
 * unique — so the exposure is a visit with two presentations claiming to be the
 * same conversation, which the readers survive because they break the tie on
 * `startedAt`. Fixing it properly means a unique index and a retry, or letting
 * the database compute the number in the insert; neither is worth doing before
 * a real store has produced the collision, and both are schema changes.
 */
export async function nextPresentationSequence(appointmentId: string | null): Promise<number> {
  if (!appointmentId) return 1

  const [row] = await getDb()
    .select({ highest: sql<number | null>`max(${schema.presentationSessions.sequence})::int` })
    .from(schema.presentationSessions)
    .where(eq(schema.presentationSessions.appointmentId, appointmentId))

  return sequenceAfter(row?.highest)
}
