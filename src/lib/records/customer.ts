import { and, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm'
import { getDb, schema } from '@/db/client'
import { displayDetail } from '@/lib/cadence/run'

/**
 * The customer record — the spine of the CRM.
 *
 * Everything else links back here: appointments, repair orders, contracts,
 * declined work, follow-up tasks and consent. Loading it is one batched pass
 * rather than a query per panel.
 */

function num(value: string | null | undefined, fallback = 0): number {
  if (value === null || value === undefined) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export interface CustomerSearchResult {
  id: string
  name: string
  mobilePhone: string | null
  email: string | null
  city: string | null
  visitCount: number
  lifetimeSpend: number
  lastVisitAt: Date | null
  doNotCall: boolean
  vehicleCount: number
  vehicleSummary: string | null
  openDeclineValue: number
}

/**
 * Search by name, phone, email or VIN.
 *
 * VIN matters: an advisor at the podium is holding a key tag, not a name.
 */
export async function searchCustomers(
  storeId: string,
  query: string,
  limit = 50,
): Promise<CustomerSearchResult[]> {
  const db = getDb()
  const term = query.trim()

  // Digits-only comparison so "(512) 555-1234" finds "5125551234".
  const digits = term.replace(/\D/g, '')
  const like = `%${term}%`

  const matched = term
    ? await db
        .select({ id: schema.customers.id })
        .from(schema.customers)
        .leftJoin(
          schema.customerVehicles,
          eq(schema.customerVehicles.customerId, schema.customers.id),
        )
        .leftJoin(schema.vehicles, eq(schema.vehicles.id, schema.customerVehicles.vehicleId))
        .where(
          and(
            eq(schema.customers.storeId, storeId),
            or(
              ilike(schema.customers.firstName, like),
              ilike(schema.customers.lastName, like),
              ilike(schema.customers.companyName, like),
              ilike(schema.customers.email, like),
              ilike(schema.vehicles.vin, like),
              ilike(schema.vehicles.licensePlate, like),
              digits.length >= 4
                ? sql`regexp_replace(coalesce(${schema.customers.mobilePhone}, ''), '\\D', '', 'g') LIKE ${'%' + digits + '%'}`
                : undefined,
              // Match "First Last" typed as one string.
              sql`lower(coalesce(${schema.customers.firstName}, '') || ' ' || coalesce(${schema.customers.lastName}, '')) LIKE ${like.toLowerCase()}`,
            ),
          ),
        )
        .groupBy(schema.customers.id)
        .limit(limit)
    : []

  const ids = term ? matched.map((m) => m.id) : []

  const rows = await db
    .select()
    .from(schema.customers)
    .where(
      term
        ? and(eq(schema.customers.storeId, storeId), inArray(schema.customers.id, ids.length ? ids : ['00000000-0000-0000-0000-000000000000']))
        : eq(schema.customers.storeId, storeId),
    )
    .orderBy(desc(schema.customers.lastVisitAt))
    .limit(limit)

  if (rows.length === 0) return []
  const customerIds = rows.map((r) => r.id)

  const [ownership, vehicleRows, declineRows] = await Promise.all([
    db.select().from(schema.customerVehicles).where(and(
      inArray(schema.customerVehicles.customerId, customerIds),
      eq(schema.customerVehicles.isCurrent, true),
    )),
    db.select().from(schema.vehicles).where(eq(schema.vehicles.storeId, storeId)),
    db.select().from(schema.declinedServices).where(and(
      inArray(schema.declinedServices.customerId, customerIds),
      isNull(schema.declinedServices.resolvedAt),
    )),
  ])

  const vehicleById = new Map(vehicleRows.map((v) => [v.id, v]))
  const vehiclesByCustomer = new Map<string, typeof vehicleRows>()
  for (const link of ownership) {
    const vehicle = vehicleById.get(link.vehicleId)
    if (!vehicle) continue
    vehiclesByCustomer.set(link.customerId, [...(vehiclesByCustomer.get(link.customerId) ?? []), vehicle])
  }

  const declineValueByCustomer = new Map<string, number>()
  for (const d of declineRows) {
    declineValueByCustomer.set(
      d.customerId,
      (declineValueByCustomer.get(d.customerId) ?? 0) + num(d.quotedAmount),
    )
  }

  return rows.map((c) => {
    const owned = vehiclesByCustomer.get(c.id) ?? []
    return {
      id: c.id,
      name: [c.firstName, c.lastName].filter(Boolean).join(' ') || c.companyName || 'Unknown',
      mobilePhone: c.mobilePhone,
      email: c.email,
      city: c.city,
      visitCount: c.visitCount,
      lifetimeSpend: num(c.lifetimeSpend),
      lastVisitAt: c.lastVisitAt,
      doNotCall: c.doNotCall,
      vehicleCount: owned.length,
      vehicleSummary: owned[0]
        ? `${owned[0].modelYear} ${owned[0].make} ${owned[0].model ?? ''}`.trim() +
          (owned.length > 1 ? ` +${owned.length - 1}` : '')
        : null,
      openDeclineValue: declineValueByCustomer.get(c.id) ?? 0,
    }
  })
}

export interface ConsentStatus {
  scope: string
  granted: boolean
  at: Date | null
  source: string | null
}

export interface CustomerRecord {
  id: string
  name: string
  firstName: string | null
  lastName: string | null
  companyName: string | null
  email: string | null
  mobilePhone: string | null
  homePhone: string | null
  address: string | null
  preferredChannel: string
  doNotCall: boolean
  visitCount: number
  lifetimeSpend: number
  firstVisitAt: Date | null
  lastVisitAt: Date | null
  lastCsiScore: number | null

  consent: ConsentStatus[]
  vehicles: {
    id: string
    label: string
    vin: string
    currentMileage: number | null
    isOriginalOwner: boolean
    soldByStore: boolean
    contractCount: number
  }[]
  repairOrders: {
    id: string
    roNumber: string
    openedAt: Date
    closedAt: Date | null
    mileageIn: number | null
    customerPayTotal: number
    vehicleLabel: string | null
    lineCount: number
  }[]
  openDeclines: {
    id: string
    description: string
    quotedAmount: number
    declinedAt: Date
    declineReason: string | null
    vehicleLabel: string | null
  }[]
  openTasks: {
    id: string
    title: string
    detail: string
    trigger: string
    dueAt: Date
    estimatedValue: number
  }[]
  notes: { id: string; body: string; isPinned: boolean; createdAt: Date }[]
  appointments: {
    id: string
    scheduledAt: Date
    status: string
    concerns: string | null
    vehicleLabel: string | null
  }[]
}

export async function loadCustomerRecord(
  storeId: string,
  customerId: string,
): Promise<CustomerRecord | null> {
  const db = getDb()

  const [customer] = await db
    .select()
    .from(schema.customers)
    .where(and(eq(schema.customers.storeId, storeId), eq(schema.customers.id, customerId)))
    .limit(1)
  if (!customer) return null

  const [ownership, roRows, declineRows, taskRows, noteRows, appointmentRows, consentRows] =
    await Promise.all([
      db.select().from(schema.customerVehicles).where(and(
        eq(schema.customerVehicles.customerId, customerId),
        eq(schema.customerVehicles.isCurrent, true),
      )),
      db.select().from(schema.repairOrders)
        .where(eq(schema.repairOrders.customerId, customerId))
        .orderBy(desc(schema.repairOrders.openedAt))
        .limit(50),
      db.select().from(schema.declinedServices).where(and(
        eq(schema.declinedServices.customerId, customerId),
        isNull(schema.declinedServices.resolvedAt),
      )).orderBy(desc(schema.declinedServices.declinedAt)),
      db.select().from(schema.cadenceTasks).where(and(
        eq(schema.cadenceTasks.customerId, customerId),
        inArray(schema.cadenceTasks.status, ['PENDING', 'IN_PROGRESS']),
      )).orderBy(schema.cadenceTasks.dueAt),
      db.select().from(schema.customerNotes)
        .where(eq(schema.customerNotes.customerId, customerId))
        .orderBy(desc(schema.customerNotes.isPinned), desc(schema.customerNotes.createdAt)),
      db.select().from(schema.appointments)
        .where(eq(schema.appointments.customerId, customerId))
        .orderBy(desc(schema.appointments.scheduledAt))
        .limit(20),
      db.select().from(schema.consentEvents)
        .where(eq(schema.consentEvents.customerId, customerId))
        .orderBy(desc(schema.consentEvents.occurredAt)),
    ])

  const vehicleIds = ownership.map((o) => o.vehicleId)
  const [vehicleRows, contractRows, lineCounts] = await Promise.all([
    vehicleIds.length
      ? db.select().from(schema.vehicles).where(inArray(schema.vehicles.id, vehicleIds))
      : Promise.resolve([]),
    vehicleIds.length
      ? db.select().from(schema.contracts).where(and(
          inArray(schema.contracts.vehicleId, vehicleIds),
          eq(schema.contracts.status, 'ACTIVE'),
        ))
      : Promise.resolve([]),
    roRows.length
      ? db.select({
          repairOrderId: schema.roLines.repairOrderId,
          count: sql<number>`count(*)::int`.as('count'),
        }).from(schema.roLines)
          .where(inArray(schema.roLines.repairOrderId, roRows.map((r) => r.id)))
          .groupBy(schema.roLines.repairOrderId)
      : Promise.resolve([]),
  ])

  const vehicleById = new Map(vehicleRows.map((v) => [v.id, v]))
  const label = (id: string | null) => {
    if (!id) return null
    const v = vehicleById.get(id)
    return v ? `${v.modelYear} ${v.make} ${v.model ?? ''}`.trim() : null
  }
  const contractCountByVehicle = new Map<string, number>()
  for (const c of contractRows) {
    contractCountByVehicle.set(c.vehicleId, (contractCountByVehicle.get(c.vehicleId) ?? 0) + 1)
  }
  const lineCountByRo = new Map(lineCounts.map((l) => [l.repairOrderId, l.count]))

  /**
   * Latest event per scope wins. The denormalised booleans on `customers` are
   * only a cache — the event log is what a regulator or plaintiff's counsel
   * would actually be shown.
   */
  const consentByScope = new Map<string, ConsentStatus>()
  for (const event of consentRows) {
    if (consentByScope.has(event.scope)) continue // rows are newest-first
    consentByScope.set(event.scope, {
      scope: event.scope,
      granted: event.eventType === 'GRANTED' || event.eventType === 'IMPORTED',
      at: event.occurredAt,
      source: event.source,
    })
  }
  // Fall back to the cached flags for scopes with no recorded event.
  const fallback: [string, boolean][] = [
    ['SMS_TRANSACTIONAL', customer.smsConsent],
    ['SMS_MARKETING', customer.smsMarketingConsent],
    ['EMAIL_TRANSACTIONAL', customer.emailConsent],
    ['EMAIL_MARKETING', customer.emailMarketingConsent],
    ['VOICE', !customer.doNotCall],
  ]
  for (const [scope, granted] of fallback) {
    if (!consentByScope.has(scope)) {
      consentByScope.set(scope, { scope, granted, at: null, source: null })
    }
  }

  const ownershipById = new Map(ownership.map((o) => [o.vehicleId, o]))

  return {
    id: customer.id,
    name: [customer.firstName, customer.lastName].filter(Boolean).join(' ') || customer.companyName || 'Unknown',
    firstName: customer.firstName,
    lastName: customer.lastName,
    companyName: customer.companyName,
    email: customer.email,
    mobilePhone: customer.mobilePhone,
    homePhone: customer.homePhone,
    address: [customer.addressLine1, customer.city, customer.state, customer.postalCode]
      .filter(Boolean).join(', ') || null,
    preferredChannel: customer.preferredChannel,
    doNotCall: customer.doNotCall,
    visitCount: customer.visitCount,
    lifetimeSpend: num(customer.lifetimeSpend),
    firstVisitAt: customer.firstVisitAt,
    lastVisitAt: customer.lastVisitAt,
    lastCsiScore: customer.lastCsiScore,

    consent: [...consentByScope.values()].sort((a, b) => a.scope.localeCompare(b.scope)),

    vehicles: vehicleRows.map((v) => ({
      id: v.id,
      label: `${v.modelYear} ${v.make} ${v.model ?? ''}`.trim(),
      vin: v.vin,
      currentMileage: v.currentMileage,
      isOriginalOwner: ownershipById.get(v.id)?.isOriginalOwner ?? false,
      soldByStore: ownershipById.get(v.id)?.soldByStore ?? false,
      contractCount: contractCountByVehicle.get(v.id) ?? 0,
    })),

    repairOrders: roRows.map((r) => ({
      id: r.id,
      roNumber: r.roNumber,
      openedAt: r.openedAt,
      closedAt: r.closedAt,
      mileageIn: r.mileageIn,
      customerPayTotal: num(r.customerPayTotal),
      vehicleLabel: label(r.vehicleId),
      lineCount: lineCountByRo.get(r.id) ?? 0,
    })),

    openDeclines: declineRows.map((d) => ({
      id: d.id,
      description: d.description,
      quotedAmount: num(d.quotedAmount),
      declinedAt: d.declinedAt,
      declineReason: d.declineReason,
      vehicleLabel: label(d.vehicleId),
    })),

    openTasks: taskRows.map((t) => ({
      id: t.id,
      title: t.title,
      detail: displayDetail(t.detail),
      trigger: t.trigger,
      dueAt: t.dueAt,
      estimatedValue: num(t.estimatedValue),
    })),

    notes: noteRows.map((n) => ({
      id: n.id, body: n.body, isPinned: n.isPinned, createdAt: n.createdAt,
    })),

    appointments: appointmentRows.map((a) => ({
      id: a.id,
      scheduledAt: a.scheduledAt,
      status: a.status,
      concerns: a.customerConcerns,
      vehicleLabel: label(a.vehicleId),
    })),
  }
}
