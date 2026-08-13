'use server'

import { revalidatePath } from 'next/cache'
import { addDays } from 'date-fns'
import { eq } from 'drizzle-orm'
import { getDb, schema } from '@/db/client'

export type Outcome =
  | 'APPOINTMENT_SET'
  | 'CALLBACK_REQUESTED'
  | 'NOT_INTERESTED'
  | 'NO_ANSWER'
  | 'LEFT_VOICEMAIL'
  | 'WRONG_NUMBER'
  | 'DO_NOT_CONTACT'

export interface OutcomeState {
  ok?: boolean
  error?: string
}

/**
 * Closes the loop on a call.
 *
 * Outcomes are not merely bookkeeping — three of them change future behaviour:
 * DO_NOT_CONTACT sets the customer flag so no rule can ever surface them again,
 * NO_ANSWER and LEFT_VOICEMAIL leave the task open and push it out a couple of
 * days so the rep tries again rather than losing the lead.
 */
export async function logOutcome(
  _previous: OutcomeState,
  formData: FormData,
): Promise<OutcomeState> {
  const taskId = String(formData.get('taskId') ?? '')
  const outcome = String(formData.get('outcome') ?? '') as Outcome
  const notes = String(formData.get('notes') ?? '').trim()

  if (!taskId || !outcome) return { error: 'Missing task or outcome.' }

  const db = getDb()

  const [task] = await db
    .select()
    .from(schema.cadenceTasks)
    .where(eq(schema.cadenceTasks.id, taskId))
    .limit(1)
  if (!task) return { error: 'Task not found.' }

  const now = new Date()
  const retryable = outcome === 'NO_ANSWER' || outcome === 'LEFT_VOICEMAIL'

  await db
    .update(schema.cadenceTasks)
    .set(
      retryable
        ? {
            // Still open — try again in two days rather than dropping the lead.
            status: 'PENDING',
            dueAt: addDays(now, 2),
            outcome,
            outcomeNotes: notes || null,
            updatedAt: now,
          }
        : {
            status: 'COMPLETED',
            completedAt: now,
            outcome,
            outcomeNotes: notes || null,
            updatedAt: now,
          },
    )
    .where(eq(schema.cadenceTasks.id, taskId))

  // Log the attempt regardless of outcome — BDC performance is measured on
  // calls made against appointments set, and an unlogged call is an untracked
  // one.
  await db.insert(schema.callLogs).values({
    storeId: task.storeId,
    customerId: task.customerId,
    vehicleId: task.vehicleId,
    cadenceTaskId: task.id,
    direction: 'OUTBOUND',
    outcome:
      outcome === 'NO_ANSWER' ? 'NO_ANSWER'
      : outcome === 'LEFT_VOICEMAIL' ? 'VOICEMAIL'
      : outcome === 'WRONG_NUMBER' ? 'WRONG_NUMBER'
      : 'CONNECTED',
    phoneNumber: '',
    startedAt: now,
    notes: notes || null,
  })

  if (outcome === 'DO_NOT_CONTACT') {
    // Honour it globally and immediately. The worklist also filters on this,
    // so any already-generated task for them disappears on the next render.
    await db
      .update(schema.customers)
      .set({ doNotCall: true, updatedAt: now })
      .where(eq(schema.customers.id, task.customerId))

    await db.insert(schema.consentEvents).values({
      storeId: task.storeId,
      customerId: task.customerId,
      eventType: 'REVOKED',
      scope: 'VOICE',
      channelAddress: '',
      source: 'BDC_CALL',
      disclosureText: 'Customer asked not to be contacted during an outbound service call.',
    })
  }

  if (notes) {
    await db.insert(schema.customerNotes).values({
      storeId: task.storeId,
      customerId: task.customerId,
      vehicleId: task.vehicleId,
      body: `[${outcome.replace(/_/g, ' ').toLowerCase()}] ${notes}`,
    })
  }

  revalidatePath('/bdc')
  return { ok: true }
}

/** Pushes a task out without recording a contact attempt. */
export async function snoozeTask(_previous: OutcomeState, formData: FormData): Promise<OutcomeState> {
  const taskId = String(formData.get('taskId') ?? '')
  const days = Number(formData.get('days') ?? 7)
  if (!taskId) return { error: 'Missing task.' }

  const db = getDb()
  await db
    .update(schema.cadenceTasks)
    .set({ dueAt: addDays(new Date(), Number.isFinite(days) ? days : 7), updatedAt: new Date() })
    .where(eq(schema.cadenceTasks.id, taskId))

  revalidatePath('/bdc')
  return { ok: true }
}
