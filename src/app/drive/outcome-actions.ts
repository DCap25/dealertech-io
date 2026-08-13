'use server'

import { and, eq, sql } from 'drizzle-orm'
import { getDb, schema } from '@/db/client'
import { getDefaultStore } from '@/lib/prep-sheet/load'
import type { OpportunityOutcome } from '@/lib/performance'

/**
 * Persist what the advisor did with each ranked opportunity.
 *
 * Fired once when a visit is finished rather than on every tap: an advisor
 * changes their mind mid-conversation, and a write per keystroke would both
 * slow the drive down and record decisions that were never really made.
 */

export interface OutcomePayload {
  opportunityKey: string
  opportunityType: string
  title: string
  urgency: string
  likelyPayer: string
  estimatedAmount: number
  customerOutOfPocket: number
  outcome: OpportunityOutcome
}

export interface RecordOutcomesResult {
  ok: boolean
  recorded?: number
  error?: string
}

const VALID_OUTCOMES = new Set<OpportunityOutcome>(['ACCEPTED', 'DECLINED', 'SKIPPED'])

export async function recordVisitOutcomes(
  appointmentId: string,
  payload: OutcomePayload[],
): Promise<RecordOutcomesResult> {
  if (!appointmentId || payload.length === 0) {
    return { ok: false, error: 'Nothing to record.' }
  }

  try {
    const store = await getDefaultStore()
    if (!store) return { ok: false, error: 'No store configured.' }

    const db = getDb()

    /**
     * The appointment is the authority for who the customer, vehicle and
     * advisor are — the client sends decisions, never identities.
     */
    const appointments = await db
      .select({
        id: schema.appointments.id,
        customerId: schema.appointments.customerId,
        vehicleId: schema.appointments.vehicleId,
        advisorId: schema.appointments.advisorId,
      })
      .from(schema.appointments)
      .where(
        and(
          eq(schema.appointments.id, appointmentId),
          eq(schema.appointments.storeId, store.id),
        ),
      )
      .limit(1)

    const appointment = appointments[0]
    if (!appointment) return { ok: false, error: 'Appointment not found.' }

    // An appointment without a customer or vehicle can't produce a prep sheet
    // in the first place, so this is a data problem rather than a user one.
    const { customerId, vehicleId } = appointment
    if (!customerId || !vehicleId) {
      return { ok: false, error: 'Appointment has no customer or vehicle on file.' }
    }

    const rows = payload
      .filter((p) => VALID_OUTCOMES.has(p.outcome) && p.opportunityKey)
      .map((p) => ({
        storeId: store.id,
        appointmentId: appointment.id,
        advisorId: appointment.advisorId,
        customerId,
        vehicleId,
        opportunityKey: p.opportunityKey,
        opportunityType: p.opportunityType,
        title: p.title,
        urgency: p.urgency,
        likelyPayer: p.likelyPayer as typeof schema.prepSheetOutcomes.$inferInsert.likelyPayer,
        estimatedAmount: String(Math.max(0, p.estimatedAmount)),
        customerOutOfPocket: String(Math.max(0, p.customerOutOfPocket)),
        outcome: p.outcome,
        decidedAt: new Date(),
      }))

    if (rows.length === 0) return { ok: false, error: 'Nothing valid to record.' }

    // Re-finishing a visit corrects the record rather than double-counting it.
    await db
      .insert(schema.prepSheetOutcomes)
      .values(rows)
      .onConflictDoUpdate({
        target: [
          schema.prepSheetOutcomes.appointmentId,
          schema.prepSheetOutcomes.opportunityKey,
        ],
        set: {
          outcome: sqlExcluded('outcome'),
          estimatedAmount: sqlExcluded('estimated_amount'),
          customerOutOfPocket: sqlExcluded('customer_out_of_pocket'),
          decidedAt: sqlExcluded('decided_at'),
        },
      })

    return { ok: true, recorded: rows.length }
  } catch (error) {
    // The advisor is mid-drive — never block finishing a visit on a write.
    const message = error instanceof Error ? error.message : 'Unknown error'
    return { ok: false, error: message }
  }
}

/** `excluded.<column>` — the row Postgres tried to insert. */
function sqlExcluded(column: string) {
  return sql.raw(`excluded.${column}`)
}
