import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, sql } from 'drizzle-orm'
import { schema } from '@/db/client'
import { withCurrentUserScope, type ScopedDb } from '@/db/scoped'
import { evaluateCoverage, type Contract, type CoverageDetermination, type PrepaidEntitlement } from '@/lib/coverage'
import { computeWarrantySnapshot, type WarrantySnapshot } from '@/lib/warranty'

/**
 * The advisor's day.
 *
 * An advisor writes 12–18 repair orders before 10am and then lives in a
 * status board for the rest of it. These loaders back that board and the two
 * transactional screens either side of it — write-up and the sell call.
 */

function num(value: string | null | undefined, fallback = 0): number {
  if (value === null || value === undefined) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function startOfDay(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

export interface WorkspaceAppointment {
  id: string
  scheduledAt: Date
  status: string
  transportType: string
  concerns: string | null
  customerId: string | null
  customerName: string
  vehicleId: string | null
  vehicleLabel: string | null
  /** Set once the appointment has been written up. */
  repairOrderId: string | null
}

export interface WorkspaceRepairOrder {
  id: string
  roNumber: string
  status: string
  openedAt: Date
  customerName: string
  vehicleLabel: string | null
  mileageIn: number | null
  customerPayTotal: number
  lineCount: number
  /** Lines a customer has not yet said yes or no to — the sell-call queue. */
  pendingLineCount: number
  pendingValue: number
  ageDays: number
}

export interface AdvisorWorkspace {
  storeName: string
  appointments: WorkspaceAppointment[]
  repairOrders: WorkspaceRepairOrder[]
  totals: {
    awaitingWriteUp: number
    open: number
    awaitingApproval: number
    approvalValue: number
    readyForDelivery: number
    /** Open more than two days — where CSI goes to die. */
    aged: number
  }
}

export async function loadAdvisorWorkspace(
  storeId: string,
  day: Date,
): Promise<AdvisorWorkspace> {
  return withCurrentUserScope((db) => loadAdvisorWorkspaceScoped(db, storeId, day))
}

async function loadAdvisorWorkspaceScoped(db: ScopedDb, 
  storeId: string,
  day: Date,
): Promise<AdvisorWorkspace> {
  const from = startOfDay(day)
  const to = new Date(from)
  to.setDate(to.getDate() + 1)

  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1)

  const [appointmentRows, roRows] = await Promise.all([
    db.select().from(schema.appointments).where(and(
      eq(schema.appointments.storeId, storeId),
      gte(schema.appointments.scheduledAt, from),
      lt(schema.appointments.scheduledAt, to),
    )).orderBy(asc(schema.appointments.scheduledAt)),
    // Anything not finished is still the advisor's problem.
    db.select().from(schema.repairOrders).where(and(
      eq(schema.repairOrders.storeId, storeId),
      ne(schema.repairOrders.status, 'CLOSED'),
      ne(schema.repairOrders.status, 'VOID'),
    )).orderBy(desc(schema.repairOrders.openedAt)),
  ])

  const customerIds = [
    ...new Set([
      ...appointmentRows.map((a) => a.customerId),
      ...roRows.map((r) => r.customerId),
    ].filter((v): v is string => Boolean(v))),
  ]
  const vehicleIds = [
    ...new Set([
      ...appointmentRows.map((a) => a.vehicleId),
      ...roRows.map((r) => r.vehicleId),
    ].filter((v): v is string => Boolean(v))),
  ]

  const [customers, vehicles, lines] = await Promise.all([
    customerIds.length
      ? db.select().from(schema.customers).where(inArray(schema.customers.id, customerIds))
      : Promise.resolve([]),
    vehicleIds.length
      ? db.select().from(schema.vehicles).where(inArray(schema.vehicles.id, vehicleIds))
      : Promise.resolve([]),
    roRows.length
      ? db.select().from(schema.roLines).where(inArray(schema.roLines.repairOrderId, roRows.map((r) => r.id)))
      : Promise.resolve([]),
  ])

  const customerById = new Map(customers.map((c) => [c.id, c]))
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]))
  const name = (id: string | null) => {
    if (!id) return 'Unknown'
    const c = customerById.get(id)
    if (!c) return 'Unknown'
    return [c.firstName, c.lastName].filter(Boolean).join(' ') || c.companyName || 'Unknown'
  }
  const label = (id: string | null) => {
    if (!id) return null
    const v = vehicleById.get(id)
    return v ? `${v.modelYear} ${v.make} ${v.model ?? ''}`.trim() : null
  }

  const roByAppointment = new Map<string, string>()
  for (const ro of roRows) {
    if (ro.appointmentId) roByAppointment.set(ro.appointmentId, ro.id)
  }

  const linesByRo = new Map<string, typeof lines>()
  for (const line of lines) {
    linesByRo.set(line.repairOrderId, [...(linesByRo.get(line.repairOrderId) ?? []), line])
  }

  const repairOrders: WorkspaceRepairOrder[] = roRows.map((r) => {
    const roLines = linesByRo.get(r.id) ?? []
    const pending = roLines.filter(
      (l) => l.status === 'RECOMMENDED' || l.status === 'PENDING_APPROVAL',
    )
    return {
      id: r.id,
      roNumber: r.roNumber,
      status: r.status,
      openedAt: r.openedAt,
      customerName: name(r.customerId),
      vehicleLabel: label(r.vehicleId),
      mileageIn: r.mileageIn,
      customerPayTotal: num(r.customerPayTotal),
      lineCount: roLines.length,
      pendingLineCount: pending.length,
      pendingValue: pending.reduce((s, l) => s + num(l.laborAmount) + num(l.partsAmount), 0),
      ageDays: Math.floor((day.getTime() - r.openedAt.getTime()) / 86_400_000),
    }
  })

  const appointments: WorkspaceAppointment[] = appointmentRows.map((a) => ({
    id: a.id,
    scheduledAt: a.scheduledAt,
    status: a.status,
    transportType: a.transportType,
    concerns: a.customerConcerns,
    customerId: a.customerId,
    customerName: name(a.customerId),
    vehicleId: a.vehicleId,
    vehicleLabel: label(a.vehicleId),
    repairOrderId: roByAppointment.get(a.id) ?? null,
  }))

  return {
    storeName: store?.name ?? 'Store',
    appointments,
    repairOrders,
    totals: {
      awaitingWriteUp: appointments.filter(
        (a) => !a.repairOrderId && a.status !== 'CANCELLED' && a.status !== 'NO_SHOW',
      ).length,
      open: repairOrders.length,
      awaitingApproval: repairOrders.filter((r) => r.pendingLineCount > 0).length,
      approvalValue: repairOrders.reduce((s, r) => s + r.pendingValue, 0),
      readyForDelivery: repairOrders.filter((r) => r.status === 'COMPLETE').length,
      aged: repairOrders.filter((r) => r.ageDays >= 2).length,
    },
  }
}

// ===========================================================================

export interface RepairOrderLine {
  id: string
  lineNumber: number
  description: string
  componentGroupKey: string | null
  payType: string
  status: string
  laborAmount: number
  partsAmount: number
  customerAmount: number
  total: number
  /** Live coverage answer for this line, recomputed on every load. */
  coverage: CoverageDetermination | null
}

export interface RepairOrderDetail {
  id: string
  roNumber: string
  status: string
  openedAt: Date
  mileageIn: number | null
  customerId: string
  customerName: string
  customerPhone: string | null
  visitCount: number
  lifetimeSpend: number
  vehicleId: string
  vehicleLabel: string
  vin: string
  currentMileage: number | null
  warranty: WarrantySnapshot
  lines: RepairOrderLine[]
  totals: {
    approved: number
    pending: number
    declined: number
    customerOwes: number
    covered: number
  }
  /** The store menu, for adding a tech recommendation during the sell call. */
  opCodes: { id: string; code: string; description: string; componentGroupKey: string | null; laborAmount: number; partsAmount: number }[]
}

export async function loadRepairOrder(
  storeId: string,
  repairOrderId: string,
  asOf: Date = new Date(),
): Promise<RepairOrderDetail | null> {
  return withCurrentUserScope((db) => loadRepairOrderScoped(db, storeId, repairOrderId, asOf))
}

async function loadRepairOrderScoped(db: ScopedDb, 
  storeId: string,
  repairOrderId: string,
  asOf: Date = new Date(),
): Promise<RepairOrderDetail | null> {

  const [ro] = await db.select().from(schema.repairOrders).where(and(
    eq(schema.repairOrders.storeId, storeId),
    eq(schema.repairOrders.id, repairOrderId),
  )).limit(1)
  if (!ro) return null

  const [customerRows, vehicleRows, lineRows, contractRows, entitlementRows, recallRows, opCodeRows] =
    await Promise.all([
      db.select().from(schema.customers).where(eq(schema.customers.id, ro.customerId)).limit(1),
      db.select().from(schema.vehicles).where(eq(schema.vehicles.id, ro.vehicleId)).limit(1),
      db.select().from(schema.roLines)
        .where(eq(schema.roLines.repairOrderId, ro.id))
        .orderBy(asc(schema.roLines.lineNumber)),
      db.select().from(schema.contracts).where(and(
        eq(schema.contracts.vehicleId, ro.vehicleId),
        eq(schema.contracts.status, 'ACTIVE'),
      )),
      db.select().from(schema.prepaidEntitlements)
        .where(eq(schema.prepaidEntitlements.vehicleId, ro.vehicleId)),
      db.select().from(schema.vehicleRecalls).where(and(
        eq(schema.vehicleRecalls.vehicleId, ro.vehicleId),
        isNull(schema.vehicleRecalls.completedAt),
      )),
      db.select().from(schema.opCodes).where(and(
        eq(schema.opCodes.storeId, storeId),
        eq(schema.opCodes.isActive, true),
      )).orderBy(asc(schema.opCodes.code)),
    ])

  const customer = customerRows[0]
  const vehicle = vehicleRows[0]
  if (!customer || !vehicle) return null

  const [ownership] = await db.select().from(schema.customerVehicles).where(and(
    eq(schema.customerVehicles.vehicleId, vehicle.id),
    eq(schema.customerVehicles.isCurrent, true),
  )).limit(1)

  const mileage = ro.mileageIn ?? vehicle.currentMileage ?? 0

  const contracts: Contract[] = contractRows.map((c) => ({
    id: c.id, productType: c.productType, adminCompany: c.adminCompany,
    contractNumber: c.contractNumber ?? undefined,
    purchaseDate: new Date(c.purchaseDate), termMonths: c.termMonths, termMiles: c.termMiles,
    /*
      The odometer at sale, which this mapping used to drop.

      `contractExpirationMiles` reads it: a contract with a mileage term and a
      known sale mileage expires at sale + term, and one without is treated as
      an absolute limit. Leaving it undefined therefore silently converted
      "36,000 miles of coverage from 48,000" into "expires at 36,000" — a
      contract that has already run out before the car arrived. The prep sheet
      never had this bug because the DMS adapter carries the column; only this
      path did, so the same vehicle could read covered on one screen and
      expired on the other.

      Nearly nothing wrote `purchase_mileage` before now, which is why it went
      unnoticed. Extraction fills it in, so the gap is reachable.
    */
    purchaseMileage: c.purchaseMileage ?? undefined,
    expirationDate: c.expirationDate ? new Date(c.expirationDate) : undefined,
    expirationMiles: c.expirationMiles ?? undefined,
    deductibleAmount: num(c.deductibleAmount), deductibleType: c.deductibleType,
    coverageTier: c.coverageTier ?? undefined, tierType: c.tierType,
    coveredComponentGroups: [], excludedComponentGroups: [],
    requiresPriorAuthorization: c.requiresPriorAuthorization,
    claimPhone: c.claimPhone ?? undefined,
    status: 'ACTIVE', source: c.source,
    minimumTreadDepth32nds: c.minimumTreadDepth32nds ?? undefined,
    perTireLimit: c.perTireLimit ? num(c.perTireLimit) : undefined,
    verifiedAt: c.verifiedAt ?? undefined,
  }))

  const prepaidEntitlements: PrepaidEntitlement[] = entitlementRows.map((e) => ({
    contractId: e.contractId, componentGroupKey: e.componentGroupKey,
    totalAllowed: e.totalAllowed, used: e.used,
    expiresOn: e.expiresOn ? new Date(e.expiresOn) : undefined,
  }))

  const openRecalls = recallRows.map((r) => ({
    campaignNumber: r.campaignNumber,
    componentGroupKeys: r.componentGroupKeys ? (JSON.parse(r.componentGroupKeys) as string[]) : [],
    description: r.summary ?? '',
    isCandidate: r.isCandidate,
  }))

  const warranty = computeWarrantySnapshot({
    make: vehicle.make, modelYear: vehicle.modelYear,
    inServiceDate: vehicle.inServiceDate ? new Date(vehicle.inServiceDate) : new Date(vehicle.modelYear, 0, 1),
    currentMileage: mileage, asOf,
    isOriginalOwner: ownership?.isOriginalOwner ?? false,
    isHybridOrEv: vehicle.isHybridOrEv, state: 'TX',
  })

  const lines: RepairOrderLine[] = lineRows.map((l) => {
    const laborAmount = num(l.laborAmount)
    const partsAmount = num(l.partsAmount)
    const coverage = evaluateCoverage({
      vehicle: {
        vin: vehicle.vin, make: vehicle.make, model: vehicle.model ?? undefined,
        modelYear: vehicle.modelYear,
        inServiceDate: vehicle.inServiceDate ? new Date(vehicle.inServiceDate) : new Date(vehicle.modelYear, 0, 1),
        currentMileage: mileage,
        isHybridOrEv: vehicle.isHybridOrEv,
        isOriginalOwner: ownership?.isOriginalOwner ?? false,
      },
      operation: {
        description: l.description,
        componentGroupKey: l.componentGroupKey ?? undefined,
        laborAmount, partsAmount,
      },
      contracts, prepaidEntitlements, openRecalls,
      store: { laborRate: 185, state: 'TX' },
      history: { visitCount: customer.visitCount, lifetimeSpend: num(customer.lifetimeSpend) },
      asOf,
    })

    return {
      id: l.id, lineNumber: l.lineNumber, description: l.description,
      componentGroupKey: l.componentGroupKey, payType: l.payType, status: l.status,
      laborAmount, partsAmount, customerAmount: num(l.customerAmount),
      total: laborAmount + partsAmount,
      coverage,
    }
  })

  const approved = lines.filter((l) => l.status === 'APPROVED' || l.status === 'COMPLETE')
  const pending = lines.filter((l) => l.status === 'RECOMMENDED' || l.status === 'PENDING_APPROVAL')
  const declined = lines.filter((l) => l.status === 'DECLINED')

  return {
    id: ro.id, roNumber: ro.roNumber, status: ro.status, openedAt: ro.openedAt,
    mileageIn: ro.mileageIn,
    customerId: customer.id,
    customerName: [customer.firstName, customer.lastName].filter(Boolean).join(' ') || customer.companyName || 'Unknown',
    customerPhone: customer.mobilePhone,
    visitCount: customer.visitCount,
    lifetimeSpend: num(customer.lifetimeSpend),
    vehicleId: vehicle.id,
    vehicleLabel: `${vehicle.modelYear} ${vehicle.make} ${vehicle.model ?? ''}`.trim(),
    vin: vehicle.vin,
    currentMileage: vehicle.currentMileage,
    warranty,
    lines,
    totals: {
      approved: approved.reduce((s, l) => s + l.total, 0),
      pending: pending.reduce((s, l) => s + l.total, 0),
      declined: declined.reduce((s, l) => s + l.total, 0),
      customerOwes: approved.reduce((s, l) => s + (l.coverage?.customerOutOfPocket ?? l.total), 0),
      covered: approved.reduce((s, l) => s + (l.coverage?.coveredAmount ?? 0), 0),
    },
    opCodes: opCodeRows.map((o) => ({
      id: o.id, code: o.code, description: o.description,
      componentGroupKey: o.componentGroupKey,
      laborAmount: num(o.laborAmount), partsAmount: num(o.partsAmount),
    })),
  }
}

/** Next RO number for the store. Real stores get this from the DMS. */
export async function nextRoNumber(storeId: string): Promise<string> {
  return withCurrentUserScope((db) => nextRoNumberScoped(db, storeId))
}

/**
 * The same, on a transaction the caller already opened.
 *
 * Exported because the write-up has to allocate this number inside the same
 * transaction as the repair order it belongs to, and the wrapper above cannot
 * be used for that: it opens a transaction of its own, and the connection pool
 * is `max: 1` wherever the database is reached through a pooler. Asking it for
 * a second connection while holding the first is not a slow query, it is a
 * deadlock that never resolves.
 */
export async function nextRoNumberScoped(db: ScopedDb, storeId: string): Promise<string> {
  const [row] = await db
    .select({ max: sql<string | null>`max(${schema.repairOrders.roNumber})` })
    .from(schema.repairOrders)
    .where(eq(schema.repairOrders.storeId, storeId))
  const current = Number(row?.max ?? '48000')
  return String((Number.isFinite(current) ? current : 48000) + 1)
}
