import 'server-only'
import { and, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm'
import { getDb, schema } from '@/db/client'
import type { OpportunityOutcome, OutcomeRecord, SoldLineRecord } from './types'

/**
 * Scorecard data access.
 *
 * Two sources, deliberately not merged into one:
 *
 *  - `prep_sheet_outcomes` carries process. It is the only record of what was
 *    never raised, which is the whole point of a capture rate.
 *  - Sold RO lines carry result. That money is real whether or not a prep
 *    sheet was ever worked.
 *
 * Keeping them apart means a thin week of prep-sheet data can't quietly
 * deflate the revenue an advisor genuinely produced.
 */

function num(value: string | null | undefined, fallback = 0): number {
  if (value === null || value === undefined) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** A line the customer approved. Everything else is a recommendation. */
const SOLD_LINE_STATUSES = new Set(['APPROVED', 'IN_PROGRESS', 'COMPLETE'])

export interface AdvisorIdentity {
  id: string
  name: string
}

/**
 * The advisor whose scorecard we show. Stands in for a session until auth lands.
 *
 * Picks the busiest advisor rather than an arbitrary first row: an arbitrary
 * pick lands on whoever the seed happened to insert first, and shows a
 * scorecard belonging to someone other than the person who worked the drive.
 */
export async function getDefaultAdvisor(storeId: string): Promise<AdvisorIdentity | null> {
  const db = getDb()
  // Role is per-store — a person can advise at one rooftop and manage another.
  const rows = await db
    .select({
      id: schema.users.id,
      name: schema.users.fullName,
      roCount: sql<number>`count(${schema.repairOrders.id})`,
    })
    .from(schema.userStoreRoles)
    .innerJoin(schema.users, eq(schema.users.id, schema.userStoreRoles.userId))
    .leftJoin(schema.repairOrders, eq(schema.repairOrders.advisorId, schema.users.id))
    .where(
      and(
        eq(schema.userStoreRoles.storeId, storeId),
        eq(schema.userStoreRoles.role, 'ADVISOR'),
        eq(schema.userStoreRoles.isActive, true),
      ),
    )
    .groupBy(schema.users.id, schema.users.fullName)
    .orderBy(sql`count(${schema.repairOrders.id}) desc`)
    .limit(1)

  const row = rows[0]
  return row ? { id: row.id, name: row.name ?? 'Advisor' } : null
}

export async function loadOutcomes(
  storeId: string,
  advisorId: string,
  since: Date,
): Promise<OutcomeRecord[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(schema.prepSheetOutcomes)
    .where(
      and(
        eq(schema.prepSheetOutcomes.storeId, storeId),
        eq(schema.prepSheetOutcomes.advisorId, advisorId),
        gte(schema.prepSheetOutcomes.decidedAt, since),
      ),
    )

  return rows.map((r) => ({
    appointmentId: r.appointmentId ?? r.id,
    opportunityKey: r.opportunityKey,
    opportunityType: r.opportunityType,
    title: r.title,
    urgency: r.urgency,
    likelyPayer: r.likelyPayer,
    estimatedAmount: num(r.estimatedAmount),
    customerOutOfPocket: num(r.customerOutOfPocket),
    outcome: r.outcome as OpportunityOutcome,
    decidedAt: r.decidedAt,
  }))
}

/**
 * Sold lines on repair orders this advisor closed.
 *
 * Only closed ROs count: an open ticket can still lose lines, and a scorecard
 * that counts work before it is sold teaches advisors to distrust it.
 */
export async function loadSoldLines(
  storeId: string,
  advisorId: string,
  since: Date,
): Promise<SoldLineRecord[]> {
  const db = getDb()

  const ros = await db
    .select({ id: schema.repairOrders.id, closedAt: schema.repairOrders.closedAt })
    .from(schema.repairOrders)
    .where(
      and(
        eq(schema.repairOrders.storeId, storeId),
        eq(schema.repairOrders.advisorId, advisorId),
        isNotNull(schema.repairOrders.closedAt),
        gte(schema.repairOrders.closedAt, since),
      ),
    )
  if (ros.length === 0) return []

  const closedAtById = new Map(ros.map((r) => [r.id, r.closedAt!]))

  const lines = await db
    .select({
      repairOrderId: schema.roLines.repairOrderId,
      laborAmount: schema.roLines.laborAmount,
      partsAmount: schema.roLines.partsAmount,
      customerAmount: schema.roLines.customerAmount,
      payType: schema.roLines.payType,
      status: schema.roLines.status,
    })
    .from(schema.roLines)
    .where(inArray(schema.roLines.repairOrderId, [...closedAtById.keys()]))

  return lines
    // RECOMMENDED, PENDING_APPROVAL and DECLINED lines are not sold work;
    // counting them would inflate every revenue figure on the page.
    .filter((l) => SOLD_LINE_STATUSES.has(l.status))
    .map((l) => ({
      repairOrderId: l.repairOrderId,
      closedAt: closedAtById.get(l.repairOrderId)!,
      amount: num(l.laborAmount) + num(l.partsAmount),
      customerAmount: num(l.customerAmount),
      payType: l.payType,
    }))
}
