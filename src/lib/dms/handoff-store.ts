import 'server-only'
import { and, desc, eq, sql } from 'drizzle-orm'
import { getDb, schema } from '@/db/client'
import { idempotencyKey, type HandOffReceipt } from './handoff-record'
import type { DmsPushResult, HandOffPayload } from './types'

/**
 * Recording pushes, so a hand-off survives a page reload.
 *
 * Every push writes a row whether it succeeded or not. A failed push that
 * leaves no trace is worse than one that leaves a red row: the advisor moves
 * on believing it went, and nobody finds out until the customer does.
 */

function toReceipt(row: typeof schema.dmsHandoffs.$inferSelect): HandOffReceipt {
  return {
    id: row.id,
    status: row.status as HandOffReceipt['status'],
    vendor: row.vendor,
    persisted: row.writesPersisted,
    externalRef: row.externalRef,
    message: row.message,
    acceptedCount: row.acceptedCount,
    attempts: row.attempts,
    sentAt: row.sentAt,
    createdAt: row.createdAt,
  }
}

/**
 * A previous successful push of exactly this content, if there is one.
 *
 * Only SENT counts. A previous failure must not stop a retry — that is the
 * whole reason retry exists.
 */
export async function existingSuccess(
  storeId: string,
  payload: HandOffPayload,
): Promise<HandOffReceipt | null> {
  const [row] = await getDb()
    .select()
    .from(schema.dmsHandoffs)
    .where(
      and(
        eq(schema.dmsHandoffs.storeId, storeId),
        eq(schema.dmsHandoffs.idempotencyKey, idempotencyKey(payload)),
        eq(schema.dmsHandoffs.status, 'SENT'),
      ),
    )
    .limit(1)

  return row ? toReceipt(row) : null
}

/**
 * Write the outcome of a push.
 *
 * Upserts on the idempotency key so a retry updates the existing row and bumps
 * the attempt count, rather than filling the table with one row per press of a
 * button that is not working.
 */
export async function recordHandOff(input: {
  storeId: string
  appointmentId: string | null
  advisorId: string
  payload: HandOffPayload
  vendor: string
  persisted: boolean
  result: DmsPushResult
}): Promise<HandOffReceipt> {
  const now = new Date()
  const key = idempotencyKey(input.payload)
  const status = input.result.ok ? 'SENT' : 'FAILED'

  const [row] = await getDb()
    .insert(schema.dmsHandoffs)
    .values({
      storeId: input.storeId,
      appointmentId: input.appointmentId,
      advisorId: input.advisorId,
      idempotencyKey: key,
      payload: input.payload,
      status,
      vendor: input.vendor,
      writesPersisted: input.persisted,
      externalRef: input.result.externalRef,
      message: input.result.message,
      acceptedCount: input.payload.accepted.length,
      attempts: 1,
      lastAttemptAt: now,
      sentAt: input.result.ok ? now : null,
    })
    .onConflictDoUpdate({
      target: [schema.dmsHandoffs.storeId, schema.dmsHandoffs.idempotencyKey],
      set: {
        status,
        vendor: input.vendor,
        writesPersisted: input.persisted,
        externalRef: input.result.externalRef,
        message: input.result.message,
        payload: input.payload,
        attempts: sql`${schema.dmsHandoffs.attempts} + 1`,
        lastAttemptAt: now,
        sentAt: input.result.ok ? now : null,
      },
    })
    .returning()

  return toReceipt(row!)
}

/**
 * Every push for a visit, newest first.
 *
 * Plural because a second hand-off is legitimate — work added after teardown,
 * a customer changing their mind. The advisor should see the history rather
 * than only the latest.
 */
export async function handoffsForAppointment(
  storeId: string,
  appointmentId: string,
): Promise<HandOffReceipt[]> {
  const rows = await getDb()
    .select()
    .from(schema.dmsHandoffs)
    .where(
      and(
        eq(schema.dmsHandoffs.storeId, storeId),
        eq(schema.dmsHandoffs.appointmentId, appointmentId),
      ),
    )
    .orderBy(desc(schema.dmsHandoffs.createdAt))

  return rows.map(toReceipt)
}
