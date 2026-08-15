'use server'

import { revalidatePath } from 'next/cache'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { schema } from '@/db/client'
import { withCurrentUserScope } from '@/db/scoped'
import { nextRoNumberScoped } from '@/lib/advisor/load'
import { requireUser } from '@/lib/auth/session'
import { soldComponentGroups } from '@/lib/reconcile/sold-work'
import { checkOdometer, overrideSummary, validateOverride } from '@/lib/odometer/check'

export interface ActionState {
  ok?: boolean
  error?: string
  repairOrderId?: string
  /**
   * The odometer went backwards and nothing has been written yet.
   *
   * Returned instead of an error string because the client has to render a
   * real decision — the numbers, the likely cause, and the reasons on offer —
   * and a sentence in a red box is not that.
   */
  odometer?: {
    entered: number
    previous: number
    shortfall: number
    severity: 'MINOR' | 'MAJOR'
    headline: string
    likelyCause: string | null
  }
}

function num(value: FormDataEntryValue | null, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/**
 * A failure with a message meant for the advisor.
 *
 * Inside a transaction the only way to roll back is to throw, but not every
 * throw should reach a person: a constraint violation or a dropped connection
 * is ours to fix and reads as gibberish at the podium. This marks the ones
 * that were written for them, so everything else can be logged and replaced
 * with a sentence that says what to do next.
 */
class AdvisorError extends Error {}

/**
 * Turn whatever came out of a transaction into something the form can render.
 *
 * A rollback is invisible to the caller — the write simply did not happen — so
 * the only thing left to get right is what the advisor is told about it.
 */
function failed(error: unknown, fallback: string): ActionState {
  if (error instanceof AdvisorError) return { error: error.message }
  console.error('[advisor] transaction rolled back:', error)
  return { error: fallback }
}

/**
 * Write-up: turn an appointment into an open repair order.
 *
 * Records the odometer as its own reading too — that series is what makes wear
 * prediction and mileage projection work, so losing it here would quietly
 * degrade the prep sheet for every future visit.
 */
export async function openRepairOrder(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // A server action is a POST endpoint whether or not a page ever
  // rendered, so the guard belongs here and not only in the middleware.
  const user = await requireUser()
  const appointmentId = String(formData.get('appointmentId') ?? '')
  const mileage = num(formData.get('mileage'))
  const concerns = String(formData.get('concerns') ?? '').trim()
  const opCodeIds = formData.getAll('opCodeId').map(String).filter(Boolean)

  if (!appointmentId) return { error: 'Missing appointment.' }
  if (mileage <= 0) return { error: 'Enter the odometer reading — coverage decisions depend on it.' }

  /**
   * ---------------------------------------------------------------------------
   * ONE SCOPE FOR THE WHOLE ACTION
   * ---------------------------------------------------------------------------
   * `withCurrentUserScope` opens a transaction and becomes the `authenticated`
   * role inside it, so this single wrapper is both boundaries at once: the
   * atomicity boundary these writes needed, and the tenant boundary they never
   * had. There is no separate `db.transaction` inside — nesting one would ask
   * the pool for a second connection while holding its only one.
   *
   * The reads are in here too, and that is the substantive change. This looks
   * an appointment up by id and then trusts its `storeId` for everything that
   * follows. On the privileged connection an id belonging to another
   * dealership would have been found, and every write after it would have been
   * aimed at that dealership's data with its own storeId attached. Now the
   * lookup simply returns nothing.
   */
  let result: ActionState
  try {
    result = await withCurrentUserScope(async (db) => {
      const [appointment] = await db.select().from(schema.appointments)
        .where(eq(schema.appointments.id, appointmentId)).limit(1)
      if (!appointment) return { error: 'Appointment not found.' }
      if (!appointment.customerId || !appointment.vehicleId) {
        return { error: 'Appointment has no customer or vehicle attached.' }
      }

      const existing = await db.select({ id: schema.repairOrders.id })
        .from(schema.repairOrders)
        .where(eq(schema.repairOrders.appointmentId, appointmentId))
        .limit(1)
      if (existing[0]) {
        // Already written up — send the advisor to the RO rather than duplicating it.
        return { ok: true, repairOrderId: existing[0].id }
      }

      /**
       * An odometer that went backwards stops here.
       *
       * Checked on the server rather than only in the form: this is a POST endpoint
       * whether or not a page rendered it, and the client's copy of "the last
       * reading" is a prop it was handed. The authority is the reading series.
       *
       * Compared against the newest actual reading, never against the projection
       * the form is prefilled with — that estimate is routinely above the real
       * odometer, and comparing to it would fire this on half the drive.
       */
      const [lastReadingRow] = await db.select({
        mileage: schema.mileageReadings.mileage,
        recordedAt: schema.mileageReadings.recordedAt,
        source: schema.mileageReadings.source,
      })
        .from(schema.mileageReadings)
        .where(eq(schema.mileageReadings.vehicleId, appointment.vehicleId))
        .orderBy(desc(schema.mileageReadings.recordedAt), desc(schema.mileageReadings.mileage))
        .limit(1)

      const odometer = checkOdometer(mileage, lastReadingRow ?? null)
      let override: { reasonCode: string; note: string; summary: string } | null = null

      if (odometer.status === 'BELOW_LAST_READING') {
        const submitted = String(formData.get('odometerOverrideReason') ?? '')
        const verdict = validateOverride(
          submitted
            ? { reasonCode: submitted, note: String(formData.get('odometerOverrideNote') ?? '') }
            : null,
        )

        if (!verdict.ok) {
          // Nothing has been written. The client re-submits with a reason, or the
          // advisor goes back and corrects the number — which is the likelier fix
          // and the one the prompt leads with.
          return {
            error: verdict.error,
            odometer: {
              entered: odometer.entered,
              previous: odometer.last.mileage,
              shortfall: odometer.shortfall,
              severity: odometer.severity,
              headline: odometer.headline,
              likelyCause: odometer.likelyCause?.message ?? null,
            },
          }
        }

        override = {
          reasonCode: verdict.reasonCode,
          note: verdict.note,
          summary: overrideSummary(verdict.reasonCode, verdict.note, mileage, odometer.last.mileage),
        }
      }

      const storeId = appointment.storeId
      const now = new Date()
      /*
        Pulled out of `appointment` before the transaction opens. Both were checked
        for null above, but TypeScript drops that narrowing at the edge of a
        callback — it cannot know the closure runs immediately.
      */
      const { customerId, vehicleId } = appointment

      /**
       * ---------------------------------------------------------------------------
       * WHY EVERY WRITE BELOW IS ONE ACT
       * ---------------------------------------------------------------------------
       * A repair order without its lines is a ticket the technician cannot work;
       * without the appointment moving to ARRIVED it stays on the drive as though
       * the customer never came; without the mileage reading the wear prediction
       * for every future visit quietly degrades, and that loss is silent and
       * permanent. These five are only meaningful together.
       *
       * The reads above are inside the same transaction rather than before it, but
       * nothing above writes — the odometer branch returns a decision for the
       * advisor to make, and a scope that commits nothing costs nothing.
       */
      /*
        Serialise RO numbering for this store.

        The number comes from `max(ro_number) + 1`, which two advisors writing
        up at the same moment both read before either has written — and the
        second insert silently reuses the first's number. A transaction alone
        does not prevent that; nothing conflicts, both are perfectly valid
        inserts. This lock is per-store and released on commit, so two rooftops
        never wait on each other.
      */
      await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${storeId}))`)
      const roNumber = await nextRoNumberScoped(db, storeId)

      const [ro] = await db.insert(schema.repairOrders).values({
        storeId,
        appointmentId,
        customerId,
        vehicleId,
        advisorId: appointment.advisorId,
        roNumber,
        status: 'OPEN',
        mileageIn: mileage,
        openedAt: now,
      }).returning({ id: schema.repairOrders.id })
      if (!ro) throw new AdvisorError('Could not open the repair order.')

      // Selected menu items become approved lines — the customer authorised these
      // at the podium. Anything the tech finds later comes in as RECOMMENDED.
      if (opCodeIds.length > 0) {
        const opCodes = await db.select().from(schema.opCodes)
          .where(and(eq(schema.opCodes.storeId, storeId), eq(schema.opCodes.isActive, true)))
        const byId = new Map(opCodes.map((o) => [o.id, o]))

        const values = opCodeIds
          .map((id, index) => {
            const op = byId.get(id)
            if (!op) return null
            return {
              storeId,
              repairOrderId: ro.id,
              opCodeId: op.id,
              lineNumber: index + 1,
              description: op.description,
              componentGroupKey: op.componentGroupKey,
              payType: 'CUSTOMER_PAY' as const,
              status: 'APPROVED' as const,
              laborHours: op.laborHours ?? '0',
              laborAmount: op.laborAmount ?? '0',
              partsAmount: op.partsAmount ?? '0',
              customerAmount: String(Number(op.laborAmount ?? 0) + Number(op.partsAmount ?? 0)),
              complaint: concerns || null,
              approvedAt: now,
              approvedBy: 'Customer at write-up',
            }
          })
          .filter((v): v is NonNullable<typeof v> => v !== null)

        if (values.length > 0) await db.insert(schema.roLines).values(values)
      }

      await db.update(schema.appointments)
        .set({ status: 'ARRIVED', arrivedAt: now, customerConcerns: concerns || appointment.customerConcerns, updatedAt: now })
        .where(eq(schema.appointments.id, appointmentId))

      await db.insert(schema.mileageReadings).values({
        storeId, vehicleId, mileage, recordedAt: now, source: 'WRITE_UP',
        // Only populated on an accepted rollback. This row is the audit trail.
        previousMileage: override ? (lastReadingRow?.mileage ?? null) : null,
        overrideReason: override?.reasonCode ?? null,
        overrideNote: override?.summary ?? null,
        overrideByUserId: override ? user.id : null,
        overrideAt: override ? now : null,
      })

      /**
       * The vehicle record follows the reading, including downwards.
       *
       * Tempting to keep the higher number "just in case", but that would leave the
       * vehicle claiming an odometer nobody can see on the cluster, and every
       * coverage decision from here keys off it. If a cluster was replaced, the low
       * number is the truth. The confirmation above is what makes it safe to trust:
       * this only runs once somebody said so on the record.
       *
       * In the same transaction as the reading that justifies it, so the vehicle
       * can never end up carrying an odometer with no record of where it came
       * from — which on an accepted rollback is the audit trail itself.
       */
      await db.update(schema.vehicles)
        .set({ currentMileage: mileage, mileageAsOf: now, updatedAt: now })
        .where(eq(schema.vehicles.id, vehicleId))

      return { ok: true, repairOrderId: ro.id }
    })
  } catch (error) {
    return failed(error, 'Could not open the repair order. Nothing was saved — try again.')
  }

  // After the commit. Revalidating a write that then rolled back would leave
  // the drive showing a repair order that does not exist.
  if (result.ok) revalidatePath('/advisor')
  return result
}

/** Adds a technician recommendation to an open RO, ready for the sell call. */
export async function addRecommendation(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // A server action is a POST endpoint whether or not a page ever
  // rendered, so the guard belongs here and not only in the middleware.
  await requireUser()
  const repairOrderId = String(formData.get('repairOrderId') ?? '')
  const opCodeId = String(formData.get('opCodeId') ?? '')
  if (!repairOrderId || !opCodeId) return { error: 'Pick an operation.' }

  /*
    One insert, but the number on it is read first.

    `max(line_number) + 1` is a read-then-write, and a technician adding a
    find while the advisor adds another reads the same maximum and writes the
    same line number. Locking the parent repair order for the length of the
    transaction makes the pair atomic against each other; the lock is released
    on commit, and it is per-RO, so the rest of the drive is unaffected.

    The RO lookup is inside the scope with it: it is what supplies `storeId`
    for the new line, so reading it through a connection that could see another
    dealership's repair orders was the whole exposure.
  */
  let result: ActionState
  try {
    result = await withCurrentUserScope(async (db) => {
      const [ro] = await db.select().from(schema.repairOrders)
        .where(eq(schema.repairOrders.id, repairOrderId)).limit(1)
      if (!ro) return { error: 'Repair order not found.' }

      const [op] = await db.select().from(schema.opCodes)
        .where(eq(schema.opCodes.id, opCodeId)).limit(1)
      if (!op) return { error: 'Operation not found.' }

      await db.execute(sql`SELECT 1 FROM repair_orders WHERE id = ${repairOrderId} FOR UPDATE`)

      const maxRows = await db
        .select({ maxLine: sql<number>`coalesce(max(${schema.roLines.lineNumber}), 0)::int` })
        .from(schema.roLines)
        .where(eq(schema.roLines.repairOrderId, repairOrderId))
      const maxLine = maxRows[0]?.maxLine ?? 0

      await db.insert(schema.roLines).values({
        storeId: ro.storeId,
        repairOrderId,
        opCodeId: op.id,
        lineNumber: maxLine + 1,
        description: op.description,
        componentGroupKey: op.componentGroupKey,
        payType: 'CUSTOMER_PAY',
        status: 'RECOMMENDED',
        laborHours: op.laborHours ?? '0',
        laborAmount: op.laborAmount ?? '0',
        partsAmount: op.partsAmount ?? '0',
        customerAmount: String(Number(op.laborAmount ?? 0) + Number(op.partsAmount ?? 0)),
      })

      return { ok: true }
    })
  } catch (error) {
    return failed(error, 'Could not add that recommendation. Nothing was saved — try again.')
  }

  if (result.ok) revalidatePath(`/advisor/ro/${repairOrderId}`)
  return result
}

/**
 * The sell call.
 *
 * A decline is not a dead end — it becomes a `declined_services` record, which
 * is what the BDC cadence engine chases and what the next prep sheet
 * resurfaces. Recording it properly here is the whole reason the follow-up
 * loop has anything to work with.
 */
export async function recordLineDecision(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // A server action is a POST endpoint whether or not a page ever
  // rendered, so the guard belongs here and not only in the middleware.
  await requireUser()
  const lineId = String(formData.get('lineId') ?? '')
  const decision = String(formData.get('decision') ?? '')
  const reason = String(formData.get('reason') ?? '').trim()
  const customerAmount = num(formData.get('customerAmount'), -1)
  const payType = String(formData.get('payType') ?? 'CUSTOMER_PAY')

  if (!lineId || !decision) return { error: 'Missing line or decision.' }

  const now = new Date()

  /*
    The decline is the pair that matters.

    Marking the line DECLINED and creating the `declined_services` record are
    one decision written to two tables. If the second fails, the line reads as
    declined and nothing ever chases it — the job goes quiet, which is the
    single failure this product exists to prevent. It would also be invisible:
    the RO looks exactly right, and the absence only shows up as a follow-up
    list that is quietly shorter than it should be.

    The approval is a single write and does not need this, but it goes through
    the same path so there is one shape to read rather than two.

    Both lookups sit inside the scope. A line id is the only thing this action
    is given, and everything written afterwards — the store, the customer, the
    vehicle — is copied off whatever that id resolved to.
  */
  let result: ActionState
  let roId = ''
  try {
    result = await withCurrentUserScope(async (db) => {
      const [line] = await db.select().from(schema.roLines)
        .where(eq(schema.roLines.id, lineId)).limit(1)
      if (!line) return { error: 'Line not found.' }

      const [ro] = await db.select().from(schema.repairOrders)
        .where(eq(schema.repairOrders.id, line.repairOrderId)).limit(1)
      if (!ro) return { error: 'Repair order not found.' }
      roId = ro.id

      if (decision === 'APPROVE') {
        await db.update(schema.roLines).set({
          status: 'APPROVED',
          // Pay type is decided here, from the coverage answer the advisor saw.
          payType: payType === 'WARRANTY' ? 'WARRANTY' : payType === 'INTERNAL' ? 'INTERNAL' : 'CUSTOMER_PAY',
          customerAmount: customerAmount >= 0
            ? customerAmount.toFixed(2)
            : String(Number(line.laborAmount) + Number(line.partsAmount)),
          approvedAt: now,
          approvedBy: 'Customer — sell call',
          updatedAt: now,
        }).where(eq(schema.roLines.id, lineId))
        return { ok: true }
      }

      await db.update(schema.roLines).set({
        status: 'DECLINED', updatedAt: now,
      }).where(eq(schema.roLines.id, lineId))

      await db.insert(schema.declinedServices).values({
        storeId: ro.storeId,
        repairOrderId: ro.id,
        roLineId: line.id,
        customerId: ro.customerId,
        vehicleId: ro.vehicleId,
        description: line.description,
        componentGroupKey: line.componentGroupKey,
        quotedAmount: String(Number(line.laborAmount) + Number(line.partsAmount)),
        declinedAt: now,
        declineReason: reason || null,
        mileageAtDecline: ro.mileageIn,
      })

      return { ok: true }
    })
  } catch (error) {
    return failed(error, 'Could not record that decision. Nothing was saved — try again.')
  }

  if (result.ok && roId) revalidatePath(`/advisor/ro/${roId}`)
  return result
}

/** Closes the RO and rolls the totals up onto the customer. */
export async function closeRepairOrder(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // A server action is a POST endpoint whether or not a page ever
  // rendered, so the guard belongs here and not only in the middleware.
  await requireUser()
  const repairOrderId = String(formData.get('repairOrderId') ?? '')
  if (!repairOrderId) return { error: 'Missing repair order.' }

  const now = new Date()
  let customerId = ''

  let result: ActionState
  try {
    result = await withCurrentUserScope(async (db) => {
      const [ro] = await db.select().from(schema.repairOrders)
        .where(eq(schema.repairOrders.id, repairOrderId)).limit(1)
      if (!ro) return { error: 'Repair order not found.' }
      customerId = ro.customerId

      const lines = await db.select().from(schema.roLines)
        .where(eq(schema.roLines.repairOrderId, repairOrderId))
      const billable = lines.filter((l) => l.status === 'APPROVED' || l.status === 'COMPLETE')

      const totals = billable.reduce(
        (acc, l) => {
      const amount = Number(l.laborAmount) + Number(l.partsAmount)
      if (l.payType === 'WARRANTY') acc.warranty += amount
      else if (l.payType === 'INTERNAL') acc.internal += amount
      else acc.customerPay += Number(l.customerAmount)
      acc.hours += Number(l.laborHours)
      acc.labor += Number(l.laborAmount)
      acc.parts += Number(l.partsAmount)
      return acc
    },
    { customerPay: 0, warranty: 0, internal: 0, hours: 0, labor: 0, parts: 0 },
  )

      /**
       * ---------------------------------------------------------------------------
       * THE WHOLE CLOSE IS ONE ACT
   * ---------------------------------------------------------------------------
   * Six writes, and every pair of them has a way of being wrong on its own.
   * Totals rolled onto the repair order while its lines stay APPROVED is a
   * closed ticket the shop still shows as work outstanding. The customer
   * aggregate recomputed from `status = 'CLOSED'` before the row is actually
   * closed counts a visit that has not happened. Worst of the set: the
   * reconciliation settles declined work and retires the BDC's chase, so a
   * failure between those two leaves a customer being called about a job they
   * paid for on the way out — the exact call this product promises to stop.
   *
   * The aggregate at the end reads the repair order this transaction just
   * wrote, which is another reason it belongs inside: outside, it would either
   * read the old row or race the commit.
   */
      await db.update(schema.repairOrders).set({
        status: 'CLOSED',
        closedAt: now,
        customerPayTotal: totals.customerPay.toFixed(2),
        warrantyTotal: totals.warranty.toFixed(2),
        internalTotal: totals.internal.toFixed(2),
        laborGross: (totals.labor * 0.72).toFixed(2),
        partsGross: (totals.parts * 0.4).toFixed(2),
        hoursSold: totals.hours.toFixed(2),
        updatedAt: now,
      }).where(eq(schema.repairOrders.id, repairOrderId))

      await db.update(schema.roLines)
        .set({ status: 'COMPLETE', completedAt: now, updatedAt: now })
        .where(and(eq(schema.roLines.repairOrderId, repairOrderId), eq(schema.roLines.status, 'APPROVED')))

      if (ro.appointmentId) {
        await db.update(schema.appointments)
          .set({ status: 'DELIVERED', updatedAt: now })
          .where(eq(schema.appointments.id, ro.appointmentId))
      }

      /**
       * Settle what this visit actually did.
       *
       * Scoped to this RO's vehicle, not the customer. A household with a truck and
       * a car declines the same jobs on both, and selling a coolant flush on the
       * Santa Fe must not quietly write off the one still owed on the Bronco.
       */
      // Passed the full line set, not `billable` — which states count as performed
      // is the pure function's rule to own, and a line declined on this very RO
      // must not be read as settling anything.
      const soldGroups = soldComponentGroups(lines)
      if (soldGroups.length > 0) {
        await db.update(schema.declinedServices)
          .set({ resolvedAt: now, resolvedByRoId: repairOrderId })
          .where(and(
            eq(schema.declinedServices.vehicleId, ro.vehicleId),
            isNull(schema.declinedServices.resolvedAt),
            inArray(schema.declinedServices.componentGroupKey, soldGroups),
          ))

        /*
          Retire the chase, but record why.

          SOLD_ELSEWHERE would be a lie — they bought it here. There is no outcome
          for "the thing happened before anyone worked the task", so the outcome is
          left null and the note carries the RO number. A BDC manager reviewing a
          rep's completed list can see at a glance that this one closed itself.
        */
        await db.update(schema.cadenceTasks)
          .set({
            status: 'COMPLETED',
            completedAt: now,
            outcomeNotes: `Work performed on RO ${ro.roNumber}.`,
            updatedAt: now,
          })
          .where(and(
            eq(schema.cadenceTasks.vehicleId, ro.vehicleId),
            eq(schema.cadenceTasks.status, 'PENDING'),
            inArray(schema.cadenceTasks.componentGroupKey, soldGroups),
          ))
      }

      // Keep the customer aggregates true — the goodwill and loyalty logic reads them.
      await db.execute(sql`
        UPDATE customers c SET
          visit_count    = agg.visits,
          lifetime_spend = agg.spend,
          first_visit_at = agg.first_at,
          last_visit_at  = agg.last_at
        FROM (
          SELECT customer_id, count(*) AS visits, coalesce(sum(customer_pay_total),0) AS spend,
                 min(opened_at) AS first_at, max(opened_at) AS last_at
          FROM repair_orders WHERE customer_id = ${ro.customerId} AND status = 'CLOSED'
          GROUP BY customer_id
        ) agg
        WHERE c.id = agg.customer_id
      `)

      return { ok: true }
    })
  } catch (error) {
    return failed(error, 'Could not close the repair order. Nothing was saved — try again.')
  }

  if (!result.ok) return result

  revalidatePath('/advisor')
  revalidatePath(`/advisor/ro/${repairOrderId}`)
  // The reconciliation above changes both of these, and a stale follow-up list
  // showing work that was just sold is the bug this whole block exists to fix.
  revalidatePath('/follow-up')
  revalidatePath(`/customers/${customerId}`)
  return result
}
