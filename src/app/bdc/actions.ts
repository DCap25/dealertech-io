'use server'

import { revalidatePath } from 'next/cache'
import { addDays } from 'date-fns'
import { eq } from 'drizzle-orm'
import { schema } from '@/db/client'
import { withCurrentUserScope } from '@/db/scoped'
import { requireUser } from '@/lib/auth/session'

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
  // A server action is a POST endpoint whether or not a page ever
  // rendered, so the guard belongs here and not only in the middleware.
  await requireUser()
  const taskId = String(formData.get('taskId') ?? '')
  const outcome = String(formData.get('outcome') ?? '') as Outcome
  const notes = String(formData.get('notes') ?? '').trim()

  if (!taskId || !outcome) return { error: 'Missing task or outcome.' }

  const now = new Date()
  const retryable = outcome === 'NO_ANSWER' || outcome === 'LEFT_VOICEMAIL'

  /**
   * ---------------------------------------------------------------------------
   * ONE CALL, UP TO FIVE ROWS
   * ---------------------------------------------------------------------------
   * The pair that makes this worth a transaction is DO_NOT_CONTACT: the
   * customer flag and the `consent_events` row are a suppression and the record
   * of why it exists. Landing the flag without the record leaves a customer
   * silently unreachable with nothing saying who asked or when — which is the
   * half you need when somebody later asks whether the request was honoured.
   * Landing the record without the flag is worse: it says the request was taken
   * while the rules go on surfacing them.
   *
   * The call log matters for a duller reason. BDC performance is measured in
   * calls made against appointments set, so a task that moves without its log
   * makes a rep look like they did less work than they did.
   */
  let result: OutcomeState
  try {
    result = await withCurrentUserScope(async (db) => {
      /*
        The task lookup is inside the scope with the writes. Everything below
        copies storeId, customerId and vehicleId off this row, so reading it
        through a connection that could see another dealership's tasks was the
        exposure — not the writes that followed it.
      */
      const [task] = await db
        .select()
        .from(schema.cadenceTasks)
        .where(eq(schema.cadenceTasks.id, taskId))
        .limit(1)
      if (!task) return { error: 'Task not found.' }

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

      return { ok: true }
    })
  } catch (error) {
    console.error('[bdc] logOutcome rolled back:', error)
    return { error: 'Could not save that outcome. Nothing was recorded — try again.' }
  }

  if (result.ok) revalidatePath('/bdc')
  return result
}

/** Pushes a task out without recording a contact attempt. */
export async function snoozeTask(_previous: OutcomeState, formData: FormData): Promise<OutcomeState> {
  // A server action is a POST endpoint whether or not a page ever
  // rendered, so the guard belongs here and not only in the middleware.
  await requireUser()
  const taskId = String(formData.get('taskId') ?? '')
  const days = Number(formData.get('days') ?? 7)
  if (!taskId) return { error: 'Missing task.' }

  /*
    A single write, and scoped anyway — the id is the only thing this action is
    given, and unscoped it would push out any task in any dealership. Under the
    policy a task belonging to somebody else simply matches no row.
  */
  await withCurrentUserScope((db) => db
    .update(schema.cadenceTasks)
    .set({ dueAt: addDays(new Date(), Number.isFinite(days) ? days : 7), updatedAt: new Date() })
    .where(eq(schema.cadenceTasks.id, taskId)))

  revalidatePath('/bdc')
  return { ok: true }
}
