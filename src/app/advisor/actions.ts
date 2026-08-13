'use server'

import { revalidatePath } from 'next/cache'
import { and, eq, sql } from 'drizzle-orm'
import { getDb, schema } from '@/db/client'
import { nextRoNumber } from '@/lib/advisor/load'

export interface ActionState {
  ok?: boolean
  error?: string
  repairOrderId?: string
}

function num(value: FormDataEntryValue | null, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
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
  const appointmentId = String(formData.get('appointmentId') ?? '')
  const mileage = num(formData.get('mileage'))
  const concerns = String(formData.get('concerns') ?? '').trim()
  const opCodeIds = formData.getAll('opCodeId').map(String).filter(Boolean)

  if (!appointmentId) return { error: 'Missing appointment.' }
  if (mileage <= 0) return { error: 'Enter the odometer reading — coverage decisions depend on it.' }

  const db = getDb()

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

  const storeId = appointment.storeId
  const roNumber = await nextRoNumber(storeId)
  const now = new Date()

  const [ro] = await db.insert(schema.repairOrders).values({
    storeId,
    appointmentId,
    customerId: appointment.customerId,
    vehicleId: appointment.vehicleId,
    advisorId: appointment.advisorId,
    roNumber,
    status: 'OPEN',
    mileageIn: mileage,
    openedAt: now,
  }).returning({ id: schema.repairOrders.id })
  if (!ro) return { error: 'Could not open the repair order.' }

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
    storeId, vehicleId: appointment.vehicleId, mileage, recordedAt: now, source: 'WRITE_UP',
  })

  await db.update(schema.vehicles)
    .set({ currentMileage: mileage, mileageAsOf: now, updatedAt: now })
    .where(eq(schema.vehicles.id, appointment.vehicleId))

  revalidatePath('/advisor')
  return { ok: true, repairOrderId: ro.id }
}

/** Adds a technician recommendation to an open RO, ready for the sell call. */
export async function addRecommendation(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const repairOrderId = String(formData.get('repairOrderId') ?? '')
  const opCodeId = String(formData.get('opCodeId') ?? '')
  if (!repairOrderId || !opCodeId) return { error: 'Pick an operation.' }

  const db = getDb()
  const [ro] = await db.select().from(schema.repairOrders)
    .where(eq(schema.repairOrders.id, repairOrderId)).limit(1)
  if (!ro) return { error: 'Repair order not found.' }

  const [op] = await db.select().from(schema.opCodes)
    .where(eq(schema.opCodes.id, opCodeId)).limit(1)
  if (!op) return { error: 'Operation not found.' }

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

  revalidatePath(`/advisor/ro/${repairOrderId}`)
  return { ok: true }
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
  const lineId = String(formData.get('lineId') ?? '')
  const decision = String(formData.get('decision') ?? '')
  const reason = String(formData.get('reason') ?? '').trim()
  const customerAmount = num(formData.get('customerAmount'), -1)
  const payType = String(formData.get('payType') ?? 'CUSTOMER_PAY')

  if (!lineId || !decision) return { error: 'Missing line or decision.' }

  const db = getDb()
  const [line] = await db.select().from(schema.roLines)
    .where(eq(schema.roLines.id, lineId)).limit(1)
  if (!line) return { error: 'Line not found.' }

  const [ro] = await db.select().from(schema.repairOrders)
    .where(eq(schema.repairOrders.id, line.repairOrderId)).limit(1)
  if (!ro) return { error: 'Repair order not found.' }

  const now = new Date()

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
  } else {
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
  }

  revalidatePath(`/advisor/ro/${ro.id}`)
  return { ok: true }
}

/** Closes the RO and rolls the totals up onto the customer. */
export async function closeRepairOrder(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const repairOrderId = String(formData.get('repairOrderId') ?? '')
  if (!repairOrderId) return { error: 'Missing repair order.' }

  const db = getDb()
  const [ro] = await db.select().from(schema.repairOrders)
    .where(eq(schema.repairOrders.id, repairOrderId)).limit(1)
  if (!ro) return { error: 'Repair order not found.' }

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

  const now = new Date()
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

  revalidatePath('/advisor')
  revalidatePath(`/advisor/ro/${repairOrderId}`)
  return { ok: true }
}
