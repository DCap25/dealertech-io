import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { getDb, schema } from '../client'
import { chance, int, isoDate, makeVin, pick, reseed, rnd, sample, daysAgo, daysFrom } from './random'

/**
 * Seeds one realistic dealership.
 *
 * Shaped on purpose so the prep sheet has something to say about every
 * customer: open declines, PPM about to expire, warranty about to lapse,
 * tread wearing toward the sell threshold, a first-owner Hyundai, a CARB-state
 * EV. Random data would leave most branches untested.
 */

const NOW = new Date('2026-08-12T14:00:00Z')

const FIRST_NAMES = [
  'James', 'Maria', 'Robert', 'Linda', 'Michael', 'Patricia', 'David', 'Jennifer',
  'William', 'Elizabeth', 'Richard', 'Barbara', 'Joseph', 'Susan', 'Thomas', 'Jessica',
  'Carlos', 'Ashley', 'Daniel', 'Karen', 'Anthony', 'Nancy', 'Mark', 'Lisa',
  'Steven', 'Betty', 'Andrew', 'Sandra', 'Kevin', 'Ana',
]
const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
  'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson',
  'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson',
  'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson',
]

/** Mostly the franchise brand, with the trade-ins a real drive actually sees. */
const FLEET = [
  { make: 'FORD', models: ['F-150', 'Explorer', 'Escape', 'Edge', 'Bronco'], wmi: '1FT', weight: 10 },
  { make: 'TOYOTA', models: ['Camry', 'RAV4', 'Highlander', 'Tacoma'], wmi: '4T1', weight: 4 },
  { make: 'HONDA', models: ['Accord', 'CR-V', 'Civic', 'Pilot'], wmi: '1HG', weight: 3 },
  { make: 'HYUNDAI', models: ['Elantra', 'Tucson', 'Santa Fe'], wmi: '5NP', weight: 3 },
  { make: 'CHEVROLET', models: ['Silverado', 'Equinox', 'Malibu'], wmi: '1GC', weight: 3 },
  { make: 'TESLA', models: ['Model 3', 'Model Y'], wmi: '5YJ', weight: 2 },
  { make: 'NISSAN', models: ['Altima', 'Rogue', 'Frontier'], wmi: '1N4', weight: 2 },
]

const OP_CODES = [
  { code: 'LOF', description: 'Lube, Oil & Filter', group: 'OIL_CHANGE', hours: 0.5, labor: 39, parts: 45, maint: true },
  { code: 'ROT', description: 'Tire Rotation', group: 'TIRE_ROTATION', hours: 0.4, labor: 29, parts: 0, maint: true },
  { code: 'MPI', description: 'Multi-Point Inspection', group: 'MULTI_POINT_INSPECTION', hours: 0.3, labor: 0, parts: 0, maint: true },
  { code: 'ALIGN', description: 'Four Wheel Alignment', group: 'WHEEL_ALIGNMENT', hours: 1.0, labor: 149, parts: 0, maint: true },
  { code: 'BRK-FR', description: 'Front Brake Pads & Rotors', group: 'BRAKE_PADS_SHOES', hours: 1.8, labor: 333, parts: 285, maint: false },
  { code: 'BRK-RR', description: 'Rear Brake Pads & Rotors', group: 'BRAKE_PADS_SHOES', hours: 1.6, labor: 296, parts: 245, maint: false },
  { code: 'TIRE4', description: 'Replace Four Tires', group: 'TIRES', hours: 1.2, labor: 222, parts: 880, maint: false },
  { code: 'BATT', description: 'Replace Battery', group: 'BATTERY_12V', hours: 0.5, labor: 92, parts: 215, maint: false },
  { code: 'CAB-FLT', description: 'Cabin Air Filter', group: 'CABIN_AIR_FILTER', hours: 0.3, labor: 55, parts: 42, maint: true },
  { code: 'ENG-FLT', description: 'Engine Air Filter', group: 'ENGINE_AIR_FILTER', hours: 0.2, labor: 37, parts: 38, maint: true },
  { code: 'TRANS-SVC', description: 'Transmission Fluid Service', group: 'TRANS_FLUID_SERVICE', hours: 1.2, labor: 222, parts: 145, maint: true },
  { code: 'COOL-FL', description: 'Coolant Flush', group: 'COOLANT_SERVICE', hours: 1.0, labor: 185, parts: 65, maint: true },
  { code: 'BRK-FLU', description: 'Brake Fluid Exchange', group: 'BRAKE_FLUID_SERVICE', hours: 0.8, labor: 148, parts: 35, maint: true },
  { code: 'PLUGS', description: 'Spark Plug Replacement', group: 'SPARK_PLUGS', hours: 2.0, labor: 370, parts: 165, maint: true },
  { code: 'AC-DIAG', description: 'A/C Performance Diagnosis', group: 'AC_COMPRESSOR', hours: 1.0, labor: 185, parts: 0, maint: false },
  { code: 'DIAG', description: 'Diagnostic Scan', group: 'DIAGNOSTIC_SCAN', hours: 1.0, labor: 185, parts: 0, maint: false },
  { code: 'WIPER', description: 'Wiper Blade Replacement', group: 'WIPER_BLADES', hours: 0.2, labor: 18, parts: 44, maint: true },
  { code: 'ALT', description: 'Replace Alternator', group: 'ALTERNATOR', hours: 2.2, labor: 407, parts: 465, maint: false },
]

const CONCERNS = [
  'Customer states check engine light is on',
  'Customer states grinding noise when braking',
  'Customer requests oil change and tire rotation',
  'Customer states A/C not blowing cold',
  'Customer states vibration at highway speed',
  'Customer states battery light on intermittently',
  'Customer requests state inspection',
  'Customer states noise from front end over bumps',
  'Customer requests 30,000 mile service',
  'Customer states low tire pressure warning',
]

function weightedFleetPick() {
  const pool = FLEET.flatMap((f) => Array<typeof f>(f.weight).fill(f))
  return pick(pool)
}

export async function seed(connectionString?: string) {
  reseed()
  const db = getDb(connectionString ?? process.env.DATABASE_URL ?? 'postgres://postgres:dealertech@localhost:54329/dealertech_test')

  // ------------------------------------------------------------- wipe
  // Child-first so foreign keys never block the delete.
  for (const table of [
    schema.prepaidRedemptions, schema.prepaidEntitlements, schema.contractCoverageItems,
    schema.contracts, schema.vehicleRecalls, schema.coverageDeterminations,
    schema.inspectionApprovals, schema.inspectionItems, schema.inspections,
    schema.declinedServices, schema.roLines, schema.repairOrders,
    schema.cadenceTasks, schema.cadenceRules, schema.campaignTargets, schema.campaigns,
    schema.callLogs, schema.customerNotes, schema.messages, schema.conversations,
    schema.messageTemplates, schema.consentEvents,
    schema.appointments, schema.mileageReadings, schema.customerVehicles,
    schema.vehicles, schema.customers, schema.opCodes,
    schema.externalRefs, schema.syncRuns, schema.importBatches, schema.dmsConnections,
    schema.auditLog, schema.userStoreRoles, schema.users, schema.stores, schema.organizations,
  ]) {
    await db.delete(table)
  }

  // -------------------------------------------------------- org & store
  const orgId = randomUUID()
  const storeId = randomUUID()
  await db.insert(schema.organizations).values({ id: orgId, name: 'Lone Star Auto Group', slug: 'lone-star' })
  await db.insert(schema.stores).values({
    id: storeId, organizationId: orgId, name: 'Lone Star Ford', slug: 'lone-star-ford',
    franchiseMake: 'FORD', city: 'Austin', state: 'TX', postalCode: '78701',
    phone: '512-555-0142', timezone: 'America/Chicago',
    laborRate: '185.00', warrantyLaborRate: '142.00',
    partsTaxRate: '0.08250', laborTaxRate: '0.00000',
  })

  // ------------------------------------------------------------- users
  const staff = [
    { name: 'Dana Whitfield', role: 'ADVISOR' as const, email: 'dana@lonestarford.test' },
    { name: 'Marcus Reyes', role: 'ADVISOR' as const, email: 'marcus@lonestarford.test' },
    { name: 'Priya Nair', role: 'BDC' as const, email: 'priya@lonestarford.test' },
    { name: 'Tom Kowalski', role: 'TECHNICIAN' as const, email: 'tom@lonestarford.test' },
    { name: 'Alicia Brooks', role: 'TECHNICIAN' as const, email: 'alicia@lonestarford.test' },
    { name: 'Ray Delgado', role: 'SERVICE_MANAGER' as const, email: 'ray@lonestarford.test' },
  ].map((s) => ({ ...s, id: randomUUID() }))

  await db.insert(schema.users).values(
    staff.map((s) => ({ id: s.id, email: s.email, fullName: s.name })),
  )
  await db.insert(schema.userStoreRoles).values(
    staff.map((s) => ({ userId: s.id, storeId, role: s.role })),
  )
  const advisors = staff.filter((s) => s.role === 'ADVISOR')
  const techs = staff.filter((s) => s.role === 'TECHNICIAN')

  // ---------------------------------------------------------- op codes
  const opCodeRows = OP_CODES.map((o) => ({
    id: randomUUID(), storeId, code: o.code, description: o.description,
    componentGroupKey: o.group, laborHours: String(o.hours),
    laborAmount: String(o.labor), partsAmount: String(o.parts), isMaintenance: o.maint,
  }))
  await db.insert(schema.opCodes).values(opCodeRows)
  const opByCode = new Map(opCodeRows.map((o) => [o.code, o]))

  // -------------------------------------------------- customers & vehicles
  const customerCount = 32
  const customers: { id: string; name: string }[] = []
  const vehicles: {
    id: string; customerId: string; make: string; model: string; modelYear: number
    mileage: number; inService: Date; isOriginalOwner: boolean; isEv: boolean
  }[] = []

  for (let i = 0; i < customerCount; i++) {
    const id = randomUUID()
    const first = pick(FIRST_NAMES)
    const last = pick(LAST_NAMES)
    customers.push({ id, name: `${first} ${last}` })

    const mobilePhone = `512555${String(1000 + i).padStart(4, '0')}`
    const email = `${first.toLowerCase()}.${last.toLowerCase()}${i}@example.test`
    // Realistic mix — plenty of stores have never captured written consent.
    const consent = {
      sms: chance(0.75),
      smsMarketing: chance(0.45),
      email: chance(0.85),
      emailMarketing: chance(0.5),
      doNotCall: chance(0.05),
    }

    await db.insert(schema.customers).values({
      id, storeId, firstName: first, lastName: last,
      email, mobilePhone,
      city: 'Austin', state: 'TX',
      preferredChannel: chance(0.7) ? 'SMS' : 'EMAIL',
      smsConsent: consent.sms, smsMarketingConsent: consent.smsMarketing,
      emailConsent: consent.email, emailMarketingConsent: consent.emailMarketing,
      doNotCall: consent.doNotCall,
    })

    /**
     * Consent as an append-only event, not just a flag.
     *
     * Some customers deliberately get NO event — a store that imported records
     * from a DMS genuinely cannot prove consent for them, and the UI should say
     * so rather than implying a defence that does not exist.
     */
    if (chance(0.7)) {
      const capturedAt = daysAgo(int(60, 900), NOW)
      const source = pick(['WRITE_UP', 'ONLINE_FORM', 'DMS_IMPORT'])
      const events: (typeof schema.consentEvents.$inferInsert)[] = []

      if (consent.sms) {
        events.push({
          storeId, customerId: id, eventType: source === 'DMS_IMPORT' ? 'IMPORTED' : 'GRANTED',
          scope: 'SMS_TRANSACTIONAL', channelAddress: mobilePhone, source,
          disclosureText: 'Customer agreed to receive service status texts about their repair order.',
          occurredAt: capturedAt,
        })
      }
      if (consent.smsMarketing) {
        events.push({
          storeId, customerId: id, eventType: 'GRANTED', scope: 'SMS_MARKETING',
          channelAddress: mobilePhone, source,
          disclosureText: 'Customer agreed to receive service reminders and promotional offers by text. Message and data rates may apply. Reply STOP to opt out.',
          occurredAt: capturedAt,
        })
      }
      if (consent.email) {
        events.push({
          storeId, customerId: id, eventType: 'GRANTED', scope: 'EMAIL_TRANSACTIONAL',
          channelAddress: email, source,
          disclosureText: 'Customer agreed to receive service documents and status updates by email.',
          occurredAt: capturedAt,
        })
      }
      if (consent.doNotCall) {
        events.push({
          storeId, customerId: id, eventType: 'REVOKED', scope: 'VOICE',
          channelAddress: mobilePhone, source: 'INBOUND_REQUEST',
          disclosureText: 'Customer asked to be removed from all outbound calling.',
          occurredAt: daysAgo(int(1, 200), NOW),
        })
      }
      if (events.length > 0) await db.insert(schema.consentEvents).values(events)
    }

    // Most customers have one vehicle; some households have two.
    const vehicleCount = chance(0.25) ? 2 : 1
    for (let v = 0; v < vehicleCount; v++) {
      const spec = weightedFleetPick()
      const modelYear = int(2015, 2025)
      const ageYears = 2026 - modelYear
      const inService = daysAgo(ageYears * 365 + int(0, 300), NOW)
      const mileage = Math.max(1200, Math.round(ageYears * int(8000, 17000) + int(-2000, 4000)))
      const vehicleId = randomUUID()
      const isEv = spec.make === 'TESLA'

      vehicles.push({
        id: vehicleId, customerId: id, make: spec.make, model: pick(spec.models),
        modelYear, mileage, inService, isOriginalOwner: chance(0.6), isEv,
      })

      const veh = vehicles[vehicles.length - 1]!
      await db.insert(schema.vehicles).values({
        id: vehicleId, storeId, vin: makeVin(spec.wmi, modelYear), vinValid: true,
        make: spec.make, model: veh.model, modelYear,
        fuelType: isEv ? 'Electric' : 'Gasoline', isHybridOrEv: isEv,
        inServiceDate: isoDate(inService),
        currentMileage: mileage, mileageAsOf: NOW,
        avgMilesPerDay: (mileage / Math.max(1, ageYears * 365)).toFixed(2),
        licensePlate: `${pick(['ABC', 'BCD', 'CDE', 'DEF'])}${int(1000, 9999)}`,
        licenseState: 'TX',
      })
      await db.insert(schema.customerVehicles).values({
        storeId, customerId: id, vehicleId,
        isOriginalOwner: veh.isOriginalOwner, soldByStore: chance(0.55),
      })
    }
  }

  // -------------------------------------------- service history & declines
  let roCounter = 48200
  const openDeclines: { customerId: string; vehicleId: string }[] = []

  for (const veh of vehicles) {
    const visits = int(1, 4)
    let mileageAtVisit = Math.round(veh.mileage * 0.45)
    // Tread wears down visit over visit — two points give a slope, and a slope
    // gives a predicted sell date.
    let tread = int(9, 11)

    for (let v = 0; v < visits; v++) {
      const daysBack = (visits - v) * int(140, 220)
      const visitDate = daysAgo(daysBack, NOW)
      if (visitDate > NOW) continue
      mileageAtVisit += int(4000, 9000)
      tread = Math.max(2, tread - int(1, 2))

      const roId = randomUUID()
      const advisor = pick(advisors)
      await db.insert(schema.repairOrders).values({
        id: roId, storeId, customerId: veh.customerId, vehicleId: veh.id,
        advisorId: advisor.id, roNumber: String(roCounter++),
        status: 'CLOSED', mileageIn: mileageAtVisit, mileageOut: mileageAtVisit + int(1, 8),
        openedAt: visitDate, closedAt: visitDate,
      })

      await db.insert(schema.mileageReadings).values({
        storeId, vehicleId: veh.id, mileage: mileageAtVisit, recordedAt: visitDate, source: 'RO',
      })

      // Sold lines.
      const sold = sample(['LOF', 'ROT', 'MPI', 'CAB-FLT', 'ENG-FLT', 'ALIGN'], int(2, 4))
      let lineNo = 1
      let cpTotal = 0
      for (const code of sold) {
        const op = opByCode.get(code)
        if (!op) continue
        const amount = Number(op.laborAmount) + Number(op.partsAmount)
        cpTotal += amount
        await db.insert(schema.roLines).values({
          id: randomUUID(), storeId, repairOrderId: roId, opCodeId: op.id,
          technicianId: pick(techs).id, lineNumber: lineNo++, description: op.description,
          componentGroupKey: op.componentGroupKey, payType: 'CUSTOMER_PAY', status: 'COMPLETE',
          laborHours: op.laborHours, laborAmount: op.laborAmount, partsAmount: op.partsAmount,
          customerAmount: String(amount), completedAt: visitDate,
        })
      }
      await db.update(schema.repairOrders).set({
        customerPayTotal: cpTotal.toFixed(2),
        laborGross: (cpTotal * 0.72).toFixed(2),
        partsGross: (cpTotal * 0.4).toFixed(2),
        hoursSold: (sold.length * 0.6).toFixed(2),
      }).where(eq(schema.repairOrders.id, roId))

      // Inspection with real measurements.
      const inspectionId = randomUUID()
      await db.insert(schema.inspections).values({
        id: inspectionId, storeId, repairOrderId: roId, vehicleId: veh.id,
        technicianId: pick(techs).id, mileage: mileageAtVisit,
        startedAt: visitDate, completedAt: visitDate,
        shareToken: randomUUID().replace(/-/g, ''),
      })
      for (const pos of ['LF', 'RF', 'LR', 'RR'] as const) {
        const value = Math.max(2, tread + (pos.startsWith('L') ? 0 : -1) + int(-1, 1))
        await db.insert(schema.inspectionItems).values({
          storeId, inspectionId, itemKey: `tire_tread_${pos.toLowerCase()}`,
          label: `Tire Tread ${pos}`, componentGroupKey: 'TIRES',
          status: value <= 3 ? 'RED' : value <= 5 ? 'YELLOW' : 'GREEN',
          measurementValue: String(value), measurementUnit: 'THIRTY_SECONDS', wheelPosition: pos,
        })
      }
      const padMm = Math.max(2, 11 - v * int(2, 3))
      await db.insert(schema.inspectionItems).values({
        storeId, inspectionId, itemKey: 'brake_pad_front', label: 'Front Brake Pads',
        componentGroupKey: 'BRAKE_PADS_SHOES',
        status: padMm <= 3 ? 'RED' : padMm <= 5 ? 'YELLOW' : 'GREEN',
        measurementValue: String(padMm), measurementUnit: 'MILLIMETERS',
      })

      // Declined work on the most recent visit stays open.
      const isLastVisit = v === visits - 1
      if (chance(0.55)) {
        const code = pick(['BRK-FR', 'TIRE4', 'ALIGN', 'TRANS-SVC', 'BATT', 'PLUGS', 'COOL-FL'])
        const op = opByCode.get(code)
        if (op) {
          const amount = Number(op.laborAmount) + Number(op.partsAmount)
          await db.insert(schema.declinedServices).values({
            storeId, repairOrderId: roId, customerId: veh.customerId, vehicleId: veh.id,
            description: op.description, componentGroupKey: op.componentGroupKey,
            quotedAmount: amount.toFixed(2), declinedAt: visitDate,
            mileageAtDecline: mileageAtVisit,
            declineReason: pick(['Not today', 'Will think about it', 'Doing it elsewhere', 'Cost']),
            // Older declines are mostly resolved; the newest stay open to work.
            resolvedAt: isLastVisit ? null : chance(0.6) ? visitDate : null,
          })
          if (isLastVisit) openDeclines.push({ customerId: veh.customerId, vehicleId: veh.id })
        }
      }
    }

    await db.insert(schema.mileageReadings).values({
      storeId, vehicleId: veh.id, mileage: veh.mileage, recordedAt: NOW, source: 'CURRENT',
    })
  }

  // ------------------------------------------------- roll up customer totals
  // Without this the prep sheet shows every customer as a stranger with zero
  // visits and zero spend, which silently disables the goodwill and loyalty
  // logic that keys off exactly those numbers.
  await db.execute(sql`
    UPDATE customers c SET
      visit_count    = agg.visits,
      lifetime_spend = agg.spend,
      first_visit_at = agg.first_at,
      last_visit_at  = agg.last_at
    FROM (
      SELECT customer_id,
             count(*)                              AS visits,
             coalesce(sum(customer_pay_total), 0)  AS spend,
             min(opened_at)                        AS first_at,
             max(opened_at)                        AS last_at
      FROM repair_orders
      GROUP BY customer_id
    ) agg
    WHERE c.id = agg.customer_id
  `)

  // ---------------------------------------------------------- contracts
  const contracted = sample(vehicles, Math.round(vehicles.length * 0.45))
  for (const veh of contracted) {
    const kind = rnd()
    if (kind < 0.45) {
      const admin = pick(['Zurich', 'JM&A', 'Ally', 'Fidelity', 'Endurance'])
      const exclusionary = chance(0.6)
      await db.insert(schema.contracts).values({
        storeId, vehicleId: veh.id, customerId: veh.customerId, productType: 'VSC',
        adminCompany: admin, contractNumber: `${admin.slice(0, 3).toUpperCase()}-${int(10000, 99999)}`,
        coverageTier: exclusionary ? 'Platinum' : 'Powertrain Select',
        tierType: exclusionary ? 'EXCLUSIONARY' : 'INCLUSIONARY',
        purchaseDate: isoDate(veh.inService), purchaseMileage: 12,
        termMonths: pick([60, 72, 84, 96]), termMiles: pick([75000, 100000, 125000]),
        deductibleAmount: pick(['0', '100', '200']), deductibleType: 'PER_VISIT',
        requiresPriorAuthorization: true, status: 'ACTIVE', source: 'MANUAL',
      })
    } else if (kind < 0.8) {
      const contractId = randomUUID()
      await db.insert(schema.contracts).values({
        id: contractId, storeId, vehicleId: veh.id, customerId: veh.customerId,
        productType: 'PPM', adminCompany: 'Ford Protect',
        purchaseDate: isoDate(veh.inService), termMonths: 36, termMiles: 36000,
        deductibleAmount: '0', deductibleType: 'NONE', status: 'ACTIVE', source: 'MANUAL',
      })
      // Some expire soon with visits unused — the use-it-or-lose-it prompt.
      const expiring = chance(0.4)
      await db.insert(schema.prepaidEntitlements).values([
        {
          storeId, contractId, vehicleId: veh.id, componentGroupKey: 'OIL_CHANGE',
          label: 'Prepaid Oil Change', totalAllowed: 5, used: int(1, 4),
          expiresOn: isoDate(expiring ? daysFrom(int(15, 75), NOW) : daysFrom(int(200, 600), NOW)),
        },
        {
          storeId, contractId, vehicleId: veh.id, componentGroupKey: 'TIRE_ROTATION',
          label: 'Prepaid Tire Rotation', totalAllowed: 5, used: int(1, 4),
          expiresOn: isoDate(expiring ? daysFrom(int(15, 75), NOW) : daysFrom(int(200, 600), NOW)),
        },
      ])
    } else {
      await db.insert(schema.contracts).values({
        storeId, vehicleId: veh.id, customerId: veh.customerId, productType: 'TIRE_WHEEL',
        adminCompany: 'Safeguard', purchaseDate: isoDate(veh.inService),
        termMonths: 84, deductibleAmount: '0', deductibleType: 'NONE',
        minimumTreadDepth32nds: 3, perTireLimit: '400', status: 'ACTIVE', source: 'MANUAL',
      })
    }
  }

  // ------------------------------------------------------- appointments
  // Today's drive, plus the next few days so the prep sheet has a horizon.
  const bookable = sample(vehicles, 34)
  let idx = 0
  for (const veh of bookable) {
    const dayOffset = idx < 14 ? 0 : idx < 24 ? 1 : int(2, 5)
    const hour = 7 + Math.floor((idx % 14) / 2)
    const minute = (idx % 2) * 30
    const when = daysFrom(dayOffset, NOW)
    when.setUTCHours(hour + 5, minute, 0, 0) // store is US Central

    await db.insert(schema.appointments).values({
      storeId, customerId: veh.customerId, vehicleId: veh.id,
      advisorId: pick(advisors).id, scheduledAt: when,
      promisedAt: new Date(when.getTime() + int(2, 6) * 3600_000),
      estimatedMinutes: pick([60, 90, 120, 180]),
      status: dayOffset === 0 && hour < 12 ? pick(['ARRIVED', 'IN_SERVICE', 'SCHEDULED']) : 'SCHEDULED',
      source: pick(['PHONE', 'ONLINE', 'BDC', 'ADVISOR']),
      transportType: pick(['WAITER', 'DROP_OFF', 'LOANER', 'SHUTTLE']),
      customerConcerns: pick(CONCERNS),
      projectedMileage: veh.mileage + int(50, 400),
    })
    idx++
  }

  // ------------------------------------------------------- cadence rules
  await db.insert(schema.cadenceRules).values([
    { storeId, name: 'Thank you / quality check', trigger: 'POST_VISIT_THANK_YOU', offsetDays: 2, assignToRole: 'BDC', talkTrack: 'Thank them, confirm the concern is resolved, catch a detractor before the OEM survey lands.' },
    { storeId, name: 'CSI pre-emption', trigger: 'CSI_PRE_EMPTION', offsetDays: 4, assignToRole: 'ADVISOR', talkTrack: 'Ask directly whether anything fell short. Fix it before the manufacturer asks.' },
    { storeId, name: 'Declined service re-offer', trigger: 'DECLINED_SERVICE_FOLLOW_UP', offsetDays: 10, assignToRole: 'BDC', cooldownDays: 45, talkTrack: 'Reference the exact item declined and re-quote at today prices. Lead with safety, not discount.' },
    { storeId, name: 'Second declined re-offer', trigger: 'DECLINED_SERVICE_FOLLOW_UP', offsetDays: 40, assignToRole: 'BDC', cooldownDays: 45 },
    { storeId, name: 'Maintenance due by mileage', trigger: 'MAINTENANCE_DUE_MILEAGE', offsetMiles: 500, assignToRole: 'BDC', talkTrack: 'Projected to hit the interval within two weeks. Offer two appointment times, not an open question.' },
    { storeId, name: 'Prepaid plan expiring', trigger: 'PPM_EXPIRING', offsetDays: -45, assignToRole: 'BDC', talkTrack: 'They already paid for these visits. Use it or lose it — book before expiry.' },
    { storeId, name: 'Factory warranty expiring', trigger: 'WARRANTY_EXPIRING', offsetDays: -90, assignToRole: 'ADVISOR', talkTrack: 'Coverage is about to end. Present a service contract while the vehicle still qualifies.' },
    { storeId, name: 'Dormant customer recovery', trigger: 'DORMANT_CUSTOMER', offsetDays: 400, assignToRole: 'BDC', cooldownDays: 120, talkTrack: 'Over a year since the last visit. Lead with a complimentary inspection, not a discount.' },
  ])

  const counts = {
    customers: customers.length,
    vehicles: vehicles.length,
    repairOrders: roCounter - 48200,
    openDeclines: openDeclines.length,
    contracts: contracted.length,
    appointments: bookable.length,
  }
  return { storeId, counts }
}

seed()
  .then(({ counts }) => {
    console.log('Seeded Lone Star Ford:')
    for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(14)} ${v}`)
    process.exit(0)
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
