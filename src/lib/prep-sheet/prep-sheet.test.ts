import { describe, it, expect } from 'vitest'
import { buildPrepSheet } from './build'
import { customerDetail } from './presentation'
import type { PriceBook } from './pricing'
import type {
  MaintenanceInterval, PrepSheet, PrepSheetInput, InspectionSnapshot,
} from './types'
import type { Contract, PrepaidEntitlement } from '@/lib/coverage'
import { buildMenu, defaultSelection } from '@/lib/menu/selection'

/**
 * Midday, not midnight. date-fns compares in LOCAL time, so a midnight-UTC
 * fixture falls on the previous day — and previous month — for anyone west of
 * Greenwich, making these assertions machine-dependent.
 */
const NOW = new Date('2026-08-12T12:00:00Z')

function baseInput(overrides: Partial<PrepSheetInput> = {}): PrepSheetInput {
  return {
    asOf: NOW,
    store: { state: 'TX', laborRate: 185 },
    customer: {
      id: 'c1', name: 'Maria Garcia', visitCount: 6, lifetimeSpend: 3800,
      lastVisitAt: new Date('2026-02-01T12:00:00Z'), preferredChannel: 'SMS', pinnedNotes: [],
    },
    vehicle: {
      id: 'v1', vin: '1FTFW1ET9DFC10312', make: 'FORD', model: 'F-150', modelYear: 2021,
      inServiceDate: new Date('2021-05-01T12:00:00Z'), currentMileage: 62_000,
      avgMilesPerDay: 32, isHybridOrEv: false, isOriginalOwner: true,
    },
    contracts: [],
    prepaidEntitlements: [],
    openDeclines: [],
    inspectionHistory: [],
    openRecalls: [],
    maintenanceIntervals: [],
    ...overrides,
  }
}

/** Tread wearing down across three visits, worst on the right front. */
function tireHistory(finalWorst: number): InspectionSnapshot[] {
  return [40_000, 51_000, 62_000].map((mileage, i) => ({
    mileage,
    recordedAt: new Date(2025, i * 5, 1),
    items: (['LF', 'RF', 'LR', 'RR'] as const).map((position) => ({
      itemKey: `tire_tread_${position.toLowerCase()}`,
      componentGroupKey: 'TIRES',
      value: position === 'RF' ? finalWorst + (2 - i) * 2 : finalWorst + (2 - i) * 2 + 3,
      unit: 'THIRTY_SECONDS',
      position,
    })),
  }))
}

describe('prep sheet — mileage projection', () => {
  it('projects the odometer forward to the appointment date', () => {
    const sheet = buildPrepSheet(baseInput({
      appointment: {
        id: 'a1', scheduledAt: new Date('2026-08-22T12:00:00Z'), promisedAt: null,
        transportType: 'WAITER', concerns: 'Oil change', advisorName: 'Dana',
      },
    }))
    // 10 days out at 32 miles/day = 320 more miles than last known.
    expect(sheet.projectedMileage).toBe(62_320)
  })

  it('uses the current odometer when there is no appointment', () => {
    expect(buildPrepSheet(baseInput()).projectedMileage).toBe(62_000)
  })
})

describe('prep sheet — declined services', () => {
  /** Front brakes, turned down in February at what the store charged then. */
  const decline = {
    id: 'd1', description: 'Front Brake Pads & Rotors', componentGroupKey: 'BRAKE_PADS_SHOES',
    opCode: 'BRK-FR', quotedAmount: 449,
    declinedAt: new Date('2026-02-01T12:00:00Z'), mileageAtDecline: 55_000,
  }

  /** The same job in the store's book today: $618. */
  const priceBook: PriceBook = {
    'BRK-FR': {
      code: 'BRK-FR', description: 'Front Brake Pads & Rotors',
      laborAmount: 333, partsAmount: 285,
    },
  }

  const declineOn = (input: Partial<PrepSheetInput>) =>
    buildPrepSheet(baseInput(input)).opportunities.find((o) => o.type === 'DECLINED_SERVICE')

  it('resurfaces an open decline', () => {
    const opp = declineOn({ openDeclines: [decline] })
    expect(opp?.title).toBe('Front Brake Pads & Rotors')
    expect(opp?.detail).toContain('6 months ago')
    expect(opp?.detail).toContain('55,000 miles')
  })

  /*
    The one that put a wrong number in front of a customer. The decline was
    quoted from its own record and, having no price source, read as a confirmed
    price on every customer surface — $449 on the tablet, $618 on the invoice.
  */
  it('quotes the store book today rather than the price on the old repair order', () => {
    const opp = declineOn({ openDeclines: [decline], priceBook })
    expect(opp?.estimatedAmount).toBe(618)
    expect(opp?.priceSource).toBe('STORE')
    expect(opp?.customerOutOfPocket).toBe(618)
  })

  it('keeps the old quote in the advisor detail and names the movement', () => {
    const opp = declineOn({ openDeclines: [decline], priceBook })
    expect(opp?.detail).toContain('quoted $449')
    expect(opp?.detail).toContain('$618 today')
    expect(opp?.talkTrack).toContain('$618')
  })

  it('says nothing about a price that has not moved', () => {
    const opp = declineOn({ openDeclines: [{ ...decline, quotedAmount: 618 }], priceBook })
    expect(opp?.estimatedAmount).toBe(618)
    expect(opp?.detail).not.toContain('today')
  })

  /*
    A decline the store cannot price is the ordinary case for a real
    integration, and it must land where every other unpriced line lands: our
    estimate, marked, redacted to "price to be confirmed" and off the menu until
    an advisor has looked at it.
  */
  it('falls through to the old quote as an estimate when nothing names the operation', () => {
    const opp = declineOn({ openDeclines: [{ ...decline, opCode: null }], priceBook })
    expect(opp?.estimatedAmount).toBe(449)
    expect(opp?.priceSource).toBe('ESTIMATE')
  })

  it('keeps an unpriceable decline off the default menu and out of the total', () => {
    const unpriced = buildPrepSheet(baseInput({
      openDeclines: [{ ...decline, opCode: null }], priceBook,
    }))
    const menu = buildMenu(unpriced.opportunities, defaultSelection(unpriced.opportunities))
    expect(menu.items).toHaveLength(0)
    expect(menu.customerTotal).toBe(0)

    // The same decline, priced by the store, is on the menu at the store's number.
    const priced = buildPrepSheet(baseInput({ openDeclines: [decline], priceBook }))
    const pricedMenu = buildMenu(priced.opportunities, defaultSelection(priced.opportunities))
    expect(pricedMenu.items).toHaveLength(1)
    expect(pricedMenu.customerTotal).toBe(618)
  })

  /*
    The customer used to be handed the advisor's sentence by omission — the one
    customer-facing string on the sheet that was not the sanitised one.
  */
  it('gives the customer history rather than the advisor’s wording', () => {
    const opp = declineOn({ openDeclines: [decline], priceBook })!
    const shown = customerDetail(opp)
    expect(shown).not.toBe(opp.detail)
    expect(shown).toContain('Recommended on a previous visit')
    expect(shown).not.toMatch(/declined|lead with|reference the exact/i)
  })

  it('shows the customer no figure for a price we cannot confirm', () => {
    const opp = declineOn({ openDeclines: [{ ...decline, opCode: null }], priceBook })!
    expect(opp.priceSource).toBe('ESTIMATE')
    expect(customerDetail(opp)).not.toMatch(/\$/)
  })

  it('tempers close probability because they already said no', () => {
    const opp = declineOn({ openDeclines: [decline] })
    expect(opp?.closeProbability).toBeLessThan(0.5)
  })

  it('treats a decline that is now covered as a different conversation', () => {
    // A/C compressor declined, and there is an exclusionary VSC on file.
    const vsc: Contract = {
      id: 'vsc1', productType: 'VSC', adminCompany: 'Zurich',
      purchaseDate: new Date('2024-01-01T12:00:00Z'), termMonths: 84, termMiles: 125_000,
      deductibleAmount: 100, deductibleType: 'PER_VISIT', tierType: 'EXCLUSIONARY',
      coveredComponentGroups: [], excludedComponentGroups: [],
      requiresPriorAuthorization: true, status: 'ACTIVE', source: 'MANUAL',
    }
    const sheet = buildPrepSheet(baseInput({
      contracts: [vsc],
      openDeclines: [{
        ...decline, id: 'd2', description: 'A/C Compressor',
        componentGroupKey: 'AC_COMPRESSOR', opCode: null, quotedAmount: 1850,
      }],
    }))
    const opp = sheet.opportunities.find((o) => o.type === 'DECLINED_SERVICE')
    expect(opp?.likelyPayer).toBe('VSC')
    expect(opp?.customerOutOfPocket).toBe(100)
    expect(opp?.closeProbability).toBeGreaterThan(0.6)
    expect(opp?.talkTrack).toMatch(/now covered/i)
  })
})

describe('prep sheet — wear prediction', () => {
  it('raises tires already at the sell threshold', () => {
    const sheet = buildPrepSheet(baseInput({ inspectionHistory: tireHistory(4) }))
    const opp = sheet.opportunities.find((o) => o.type === 'WEAR_PREDICTED')
    expect(opp?.title).toBe('Tires approaching replacement')
    expect(opp?.detail).toContain('RF')
    expect(opp?.urgency).toBe('HIGH')
  })

  it('escalates a tire at the legal minimum to SAFETY and ranks it first', () => {
    const sheet = buildPrepSheet(baseInput({
      inspectionHistory: tireHistory(2),
      openDeclines: [{
        id: 'd1', description: 'Transmission Fluid Service', componentGroupKey: 'TRANS_FLUID_SERVICE',
        quotedAmount: 2000, declinedAt: new Date('2026-01-01T12:00:00Z'), mileageAtDecline: 50_000,
      }],
    }))
    const first = sheet.opportunities[0]
    // A $2,000 decline must not outrank a bald tire.
    expect(first?.type).toBe('WEAR_PREDICTED')
    expect(first?.urgency).toBe('SAFETY')
  })

  it('says nothing about tires with plenty of tread left', () => {
    const sheet = buildPrepSheet(baseInput({ inspectionHistory: tireHistory(11) }))
    expect(sheet.opportunities.find((o) => o.type === 'WEAR_PREDICTED')).toBeUndefined()
  })
})

describe('prep sheet — prepaid maintenance', () => {
  const entitlement = (expiresOn?: Date): PrepaidEntitlement & { label: string } => ({
    contractId: 'ppm1', componentGroupKey: 'OIL_CHANGE', label: 'Oil Change',
    totalAllowed: 5, used: 2, expiresOn,
  })

  it('surfaces remaining prepaid visits', () => {
    const sheet = buildPrepSheet(baseInput({ prepaidEntitlements: [entitlement()] }))
    const opp = sheet.opportunities.find((o) => o.type === 'PPM_UNUSED')
    expect(opp?.title).toContain('3 prepaid')
    expect(opp?.customerOutOfPocket).toBe(0)
  })

  it('escalates urgency when the plan expires soon', () => {
    const soon = buildPrepSheet(baseInput({
      prepaidEntitlements: [entitlement(new Date('2026-09-15T12:00:00Z'))],
    }))
    const later = buildPrepSheet(baseInput({
      prepaidEntitlements: [entitlement(new Date('2027-09-15T12:00:00Z'))],
    }))
    expect(soon.opportunities[0]?.urgency).toBe('HIGH')
    expect(soon.opportunities[0]?.talkTrack).toMatch(/before the plan expires/i)
    expect(later.opportunities.find((o) => o.type === 'PPM_UNUSED')?.urgency).toBe('LOW')
  })

  it('ignores an exhausted plan', () => {
    const sheet = buildPrepSheet(baseInput({
      prepaidEntitlements: [{ ...entitlement(), used: 5 }],
    }))
    expect(sheet.opportunities.find((o) => o.type === 'PPM_UNUSED')).toBeUndefined()
  })
})

describe('prep sheet — ranking', () => {
  it('ranks a covered repair above an identical uncovered one', () => {
    // The whole point: low out-of-pocket is an easy yes.
    const withCoverage = buildPrepSheet(baseInput({
      contracts: [{
        id: 'tw', productType: 'TIRE_WHEEL', adminCompany: 'Safeguard',
        purchaseDate: new Date('2024-01-01T12:00:00Z'), termMonths: 84, termMiles: null,
        deductibleAmount: 0, deductibleType: 'NONE', tierType: 'INCLUSIONARY',
        coveredComponentGroups: ['TIRES'], excludedComponentGroups: [],
        requiresPriorAuthorization: false, status: 'ACTIVE', source: 'MANUAL',
        minimumTreadDepth32nds: 3,
      }],
      inspectionHistory: tireHistory(4),
    }))
    const without = buildPrepSheet(baseInput({ inspectionHistory: tireHistory(4) }))

    const a = withCoverage.opportunities.find((o) => o.type === 'WEAR_PREDICTED')
    const b = without.opportunities.find((o) => o.type === 'WEAR_PREDICTED')
    expect(a?.priorityScore).toBeGreaterThan(b?.priorityScore ?? 0)
  })

  it('totals the opportunity and splits covered from customer-owed', () => {
    const sheet = buildPrepSheet(baseInput({
      openDeclines: [{
        id: 'd1', description: 'Four Tires', componentGroupKey: 'TIRES',
        quotedAmount: 1000, declinedAt: new Date('2026-05-01T12:00:00Z'), mileageAtDecline: 58_000,
      }],
    }))
    expect(sheet.totals.opportunityValue).toBe(1000)
    expect(sheet.totals.customerOutOfPocket).toBe(1000)
    expect(sheet.totals.coveredValue).toBe(0)
  })
})

describe('prep sheet — alerts', () => {
  it('raises a do-not-drive recall to the top as an alert', () => {
    const sheet = buildPrepSheet(baseInput({
      openRecalls: [{
        campaignNumber: '24V-999', componentGroupKeys: ['AIRBAG_SRS'],
        description: 'Inflator may rupture', isCandidate: true, parkIt: true,
      }],
    }))
    expect(sheet.alerts.join(' ')).toContain('DO NOT DRIVE')
    expect(sheet.opportunities[0]?.urgency).toBe('SAFETY')
  })

  it('flags a candidate recall as needing portal verification', () => {
    const sheet = buildPrepSheet(baseInput({
      openRecalls: [{
        campaignNumber: '24V-100', componentGroupKeys: ['TRANSMISSION_INTERNAL'],
        description: 'Unexpected downshift', isCandidate: true,
      }],
    }))
    expect(sheet.opportunities[0]?.talkTrack).toMatch(/OEM portal/i)
  })

  it('treats a long-absent customer as a win-back', () => {
    const sheet = buildPrepSheet(baseInput({
      customer: {
        id: 'c1', name: 'Dormant Dan', visitCount: 2, lifetimeSpend: 400,
        lastVisitAt: new Date('2024-01-01T12:00:00Z'), preferredChannel: 'SMS', pinnedNotes: [],
      },
    }))
    expect(sheet.alerts.join(' ')).toMatch(/win-back/i)
  })

  it('surfaces pinned customer notes at the podium', () => {
    const sheet = buildPrepSheet(baseInput({
      customer: {
        id: 'c1', name: 'Picky Pete', visitCount: 9, lifetimeSpend: 7000,
        lastVisitAt: NOW, preferredChannel: 'SMS',
        pinnedNotes: ['Previous CSI detractor — escalate to manager on arrival.'],
      },
    }))
    expect(sheet.alerts.join(' ')).toContain('CSI detractor')
  })

  it('warns when we have no warranty data for the make', () => {
    const sheet = buildPrepSheet(baseInput({
      vehicle: { ...baseInput().vehicle, make: 'DELOREAN' },
    }))
    expect(sheet.alerts.join(' ')).toMatch(/No factory warranty reference data/i)
  })
})

/**
 * Opportunity identity.
 *
 * Ids were `${type}-${index}` over the pre-sort array, so a recall arriving or
 * a technician's inspection landing shifted every later id onto a different
 * item of the same type — and the id still resolved, to the wrong service.
 *
 * These pin the property rather than the format. The exact string is nobody's
 * business outside `build.ts`; what must hold is that a line keeps its id
 * while it is on the sheet, and that an id from one build never points at a
 * different service on the next.
 */
describe('prep sheet — opportunity identity', () => {
  /** Four interval services, every one of them due at 62,000 miles. */
  const intervals: MaintenanceInterval[] = [
    { description: 'Engine Air Filter', componentGroupKey: 'ENGINE_AIR_FILTER',
      intervalMiles: 30_000, estimatedAmount: 75, opCode: 'ENG-FLT' },
    { description: 'Cabin Air Filter', componentGroupKey: 'CABIN_AIR_FILTER',
      intervalMiles: 30_000, estimatedAmount: 97, opCode: 'CAB-FLT' },
    { description: 'Brake Fluid Exchange', componentGroupKey: 'BRAKE_FLUID_SERVICE',
      intervalMiles: 45_000, estimatedAmount: 183, opCode: 'BRK-FLU' },
    { description: 'Transmission Fluid Service', componentGroupKey: 'TRANS_FLUID_SERVICE',
      intervalMiles: 60_000, estimatedAmount: 367, opCode: 'TRANS-SVC' },
  ]

  const lastServiceMileageByGroup = {
    ENGINE_AIR_FILTER: 32_000,
    CABIN_AIR_FILTER: 32_000,
    BRAKE_FLUID_SERVICE: 17_000,
    TRANS_FLUID_SERVICE: 2_000,
  }

  const brakeDecline = {
    id: 'd1', description: 'Front Brake Pads & Rotors', componentGroupKey: 'BRAKE_PADS_SHOES',
    quotedAmount: 449, declinedAt: new Date('2026-02-01T12:00:00Z'), mileageAtDecline: 55_000,
  }
  const cabinDecline = {
    id: 'd2', description: 'Cabin air filter', componentGroupKey: 'CABIN_AIR_FILTER',
    quotedAmount: 97, declinedAt: new Date('2026-03-01T12:00:00Z'), mileageAtDecline: 57_000,
  }
  const batteryDecline = {
    id: 'd3', description: 'Battery replacement', componentGroupKey: 'BATTERY',
    quotedAmount: 307, declinedAt: new Date('2026-04-01T12:00:00Z'), mileageAtDecline: 59_000,
  }

  const airbagRecall = {
    campaignNumber: '24V-100', componentGroupKeys: ['AIRBAG_SRS'],
    description: 'Inflator may rupture', isCandidate: true,
  }
  const wiringRecall = {
    campaignNumber: '25V-222', componentGroupKeys: ['ELECTRICAL_SYSTEM'],
    description: 'Wiring harness may chafe', isCandidate: false,
  }

  /** The sheet as it stands when the advisor opens the page. */
  const sheetOf = (over: Partial<PrepSheetInput> = {}): PrepSheet =>
    buildPrepSheet(baseInput({
      maintenanceIntervals: intervals,
      lastServiceMileageByGroup,
      openDeclines: [brakeDecline, cabinDecline, batteryDecline],
      openRecalls: [airbagRecall],
      ...over,
    }))

  const idByTitle = (sheet: PrepSheet) =>
    new Map(sheet.opportunities.map((o) => [o.title, o.id]))

  /** Every line on both sheets kept the id it had. */
  function expectSurvivorsKeepTheirIds(before: PrepSheet, after: PrepSheet) {
    const was = idByTitle(before)
    const now = idByTitle(after)
    const survivors = [...was.keys()].filter((title) => now.has(title))
    expect(survivors.length).toBeGreaterThan(3)
    for (const title of survivors) {
      expect(`${title} → ${now.get(title)}`).toBe(`${title} → ${was.get(title)}`)
    }
  }

  /**
   * The dangerous half, asserted the way the customer meets it: resolve each
   * of yesterday's ids through the menu the customer would actually be shown.
   * Same service, or nothing at all — never a different one.
   */
  function expectNoSubstitution(before: PrepSheet, after: PrepSheet) {
    for (const original of before.opportunities) {
      const resolved = after.opportunities.find((o) => o.id === original.id)
      if (resolved) expect(resolved.title).toBe(original.title)

      const menu = buildMenu(after.opportunities, { includedIds: [original.id] })
      for (const item of menu.items) expect(item.opportunity.title).toBe(original.title)
    }
  }

  it('keeps every id when a second recall arrives', () => {
    const before = sheetOf()
    const after = sheetOf({ openRecalls: [airbagRecall, wiringRecall] })
    expect(after.opportunities.length).toBe(before.opportunities.length + 1)
    expectSurvivorsKeepTheirIds(before, after)
    expectNoSubstitution(before, after)
  })

  /*
    The realistic trigger. A technician submits an MPI with uneven front tread,
    which adds an alignment and a tyre line *above* the interval services in
    source order — the exact shift that used to hand the customer a $149
    alignment where the advisor had ticked a $75 air filter.
  */
  it('keeps every id when an inspection adds alignment and wear lines', () => {
    const before = sheetOf()
    const after = sheetOf({ inspectionHistory: tireHistory(4) })

    const added = after.opportunities.filter((o) => !idByTitle(before).has(o.title))
    expect(added.map((o) => o.title)).toContain('Four Wheel Alignment')
    expect(added.map((o) => o.title)).toContain('Tires approaching replacement')

    expectSurvivorsKeepTheirIds(before, after)
    expectNoSubstitution(before, after)
  })

  /*
    The quieter mode: reconcile resolves a decline in the background, with no
    technician and no OEM pull involved. Under the positional scheme the ticked
    "Rear brakes" became "Battery replacement" on the customer's phone.
  */
  it('keeps every id when a decline is resolved between builds', () => {
    const before = sheetOf()
    const after = sheetOf({ openDeclines: [brakeDecline, batteryDecline] })
    expect(after.opportunities.length).toBe(before.opportunities.length - 1)
    expectSurvivorsKeepTheirIds(before, after)
    expectNoSubstitution(before, after)
  })

  it('is unmoved by ranking — the same sheet built twice reads the same', () => {
    expect(idByTitle(sheetOf())).toEqual(idByTitle(sheetOf()))
  })

  /*
    Uniqueness is guaranteed, not assumed. Everything here collides on some
    part of the key: two intervals sharing a component group, an interval that
    claims the group the alignment rule uses, a duplicated recall campaign, two
    prepaid entitlements sold on one contract, and two entitlements identical
    down to the group.
  */
  it('gives every line its own id on a sheet engineered to collide', () => {
    const sheet = buildPrepSheet(baseInput({
      maintenanceIntervals: [
        ...intervals,
        { description: 'Front Brake Pads & Rotors', componentGroupKey: 'BRAKE_PADS_SHOES',
          intervalMiles: 30_000, estimatedAmount: 618, opCode: 'BRK-FR' },
        { description: 'Rear Brake Pads & Rotors', componentGroupKey: 'BRAKE_PADS_SHOES',
          intervalMiles: 30_000, estimatedAmount: 540, opCode: 'BRK-RR' },
        { description: 'Wheel Alignment Check', componentGroupKey: 'WHEEL_ALIGNMENT',
          intervalMiles: 30_000, estimatedAmount: 149, opCode: 'ALIGN' },
        // No record and past the interval: lands in the second maintenance
        // pass, which must not collide with the first.
        { description: 'Spark Plug Replacement', componentGroupKey: 'SPARK_PLUGS',
          intervalMiles: 60_000, estimatedAmount: 535, opCode: 'PLUGS' },
      ],
      lastServiceMileageByGroup: {
        ...lastServiceMileageByGroup,
        BRAKE_PADS_SHOES: 32_000,
        WHEEL_ALIGNMENT: 32_000,
      },
      // Same brakes, twice, from two different repair orders.
      openDeclines: [brakeDecline, { ...brakeDecline, id: 'd9' }, cabinDecline],
      openRecalls: [airbagRecall, airbagRecall, wiringRecall],
      prepaidEntitlements: [
        { contractId: 'ppm1', componentGroupKey: 'OIL_CHANGE', label: 'Oil Change',
          totalAllowed: 5, used: 2 },
        { contractId: 'ppm1', componentGroupKey: 'TIRE_ROTATION', label: 'Tire Rotation',
          totalAllowed: 5, used: 1 },
        { contractId: 'ppm1', componentGroupKey: 'TIRE_ROTATION', label: 'Tire Rotation',
          totalAllowed: 3, used: 0 },
      ],
      inspectionHistory: tireHistory(4),
    }))

    const ids = sheet.opportunities.map((o) => o.id)
    expect(new Set(ids).size).toBe(ids.length)

    // The pairs that would have shared a key are still separable.
    const brakeIntervals = sheet.opportunities.filter((o) => o.type === 'MAINTENANCE_DUE'
      && o.componentGroupKey === 'BRAKE_PADS_SHOES')
    expect(brakeIntervals).toHaveLength(2)
    expect(brakeIntervals[0]!.id).not.toBe(brakeIntervals[1]!.id)

    const alignmentLines = sheet.opportunities.filter((o) => o.componentGroupKey === 'WHEEL_ALIGNMENT')
    expect(alignmentLines).toHaveLength(2)

    // Two entitlements on one contract are told apart by what they redeem
    // against, not by where they sat in the array.
    const oil = sheet.opportunities.find((o) => o.componentGroupKey === 'OIL_CHANGE')
    const rotation = sheet.opportunities.find((o) => o.componentGroupKey === 'TIRE_ROTATION')
    expect(oil!.id).not.toBe(rotation!.id)
  })

  /*
    Campaign numbers and source ids come out of other people's systems and end
    up in JSON keys, query strings and a text column.
  */
  it('keeps ids safe to put in a URL or a JSON key', () => {
    const sheet = sheetOf({
      openRecalls: [{ ...airbagRecall, campaignNumber: 'NHTSA 24V-999 / rev B & C' }],
      openDeclines: [{ ...brakeDecline, id: 'ro#1182 line 3' }],
    })
    for (const o of sheet.opportunities) {
      expect(o.id).toMatch(/^[A-Za-z0-9_.:~-]+$/)
      expect(o.id).toBe(encodeURIComponent(o.id).replace(/%3A/g, ':'))
    }
  })
})

describe('prep sheet — warranty upsell', () => {
  it('prompts a service contract when factory coverage is closing', () => {
    const sheet = buildPrepSheet(baseInput({
      vehicle: {
        ...baseInput().vehicle, modelYear: 2023,
        inServiceDate: new Date('2023-10-01T12:00:00Z'), currentMileage: 33_000,
      },
    }))
    const opp = sheet.opportunities.find((o) => o.type === 'WARRANTY_EXPIRING')
    expect(opp).toBeDefined()
    expect(opp?.talkTrack).toMatch(/easiest to justify/i)
  })

  it('stays quiet when they already own a service contract', () => {
    const sheet = buildPrepSheet(baseInput({
      vehicle: {
        ...baseInput().vehicle, modelYear: 2023,
        inServiceDate: new Date('2023-10-01T12:00:00Z'), currentMileage: 33_000,
      },
      contracts: [{
        id: 'vsc1', productType: 'VSC', adminCompany: 'Zurich',
        purchaseDate: new Date('2023-10-01T12:00:00Z'), termMonths: 84, termMiles: 100_000,
        deductibleAmount: 100, deductibleType: 'PER_VISIT', tierType: 'EXCLUSIONARY',
        coveredComponentGroups: [], excludedComponentGroups: [],
        requiresPriorAuthorization: true, status: 'ACTIVE', source: 'MANUAL',
      }],
    }))
    expect(sheet.opportunities.find((o) => o.type === 'WARRANTY_EXPIRING')).toBeUndefined()
  })
})
