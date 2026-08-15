import { describe, expect, it } from 'vitest'
import { DEFAULT_INTERVALS, intervalApplies } from './build'
import { detectAlignment } from './alignment'
import type { MaintenanceInterval, PrepSheetVehicle } from './types'

function vehicle(over: Partial<PrepSheetVehicle> = {}): PrepSheetVehicle {
  return {
    id: 'v1',
    vin: '1FTFW1E84MFA12345',
    make: 'FORD',
    model: 'F-150',
    modelYear: 2022,
    inServiceDate: null,
    currentMileage: 60_000,
    avgMilesPerDay: 30,
    isHybridOrEv: false,
    isOriginalOwner: true,
    driveType: 'FOUR_WD',
    isFullyElectric: false,
    ...over,
  }
}

const interval = (over: Partial<MaintenanceInterval>): MaintenanceInterval => ({
  description: 'Something',
  componentGroupKey: 'OIL_CHANGE',
  intervalMiles: 30_000,
  estimatedAmount: 100,
  ...over,
})

describe('intervalApplies — combustion', () => {
  const plugs = interval({ description: 'Spark Plugs', appliesTo: { combustionOnly: true } })

  it('offers spark plugs on a petrol car', () => {
    expect(intervalApplies(plugs, vehicle())).toBe(true)
  })

  it('never offers spark plugs on an electric car', () => {
    // The single most visible error this menu could make. A customer who is
    // told their Tesla needs plugs stops believing everything else on it.
    expect(intervalApplies(plugs, vehicle({ isFullyElectric: true }))).toBe(false)
  })

  it('still offers them on a hybrid, which has an engine', () => {
    expect(intervalApplies(plugs, vehicle({ isHybridOrEv: true, isFullyElectric: false }))).toBe(true)
  })

  it('offers brake fluid and cabin filter to an electric car', () => {
    // An EV still has brakes and a cabin. Gating everything on combustion
    // would leave an electric customer with an almost empty menu.
    const ev = vehicle({ isFullyElectric: true })
    expect(intervalApplies(interval({ componentGroupKey: 'BRAKE_FLUID_SERVICE' }), ev)).toBe(true)
    expect(intervalApplies(interval({ componentGroupKey: 'CABIN_AIR_FILTER' }), ev)).toBe(true)
  })
})

describe('the default menu on an electric car', () => {
  const ev = vehicle({ isFullyElectric: true, isHybridOrEv: true, driveType: 'RWD' })
  const offered = DEFAULT_INTERVALS.filter((i) => intervalApplies(i, ev)).map(
    (i) => i.componentGroupKey,
  )

  it('offers nothing that requires an engine', () => {
    for (const group of [
      'OIL_CHANGE', 'ENGINE_AIR_FILTER', 'SPARK_PLUGS', 'FUEL_INDUCTION_SERVICE',
      'PCV_SYSTEM', 'ACCESSORY_DRIVE', 'TRANS_FLUID_SERVICE', 'POWER_STEERING_PUMP',
    ]) {
      expect(offered, group).not.toContain(group)
    }
  })

  it('does not quote a combustion coolant interval at an EV owner', () => {
    // An EV has coolant. What it does not have is an interval we can defend —
    // Tesla publishes none for the Model 3, and other makers disagree by
    // 100,000 miles. See the note beside COOLANT_SERVICE.
    expect(offered).not.toContain('COOLANT_SERVICE')
  })

  it('still leaves a menu worth showing', () => {
    // Gating everything on combustion would hand an EV customer a blank
    // tablet. Tyres, brakes and the cabin are all still there.
    expect(offered).toContain('TIRE_ROTATION')
    expect(offered).toContain('BRAKE_FLUID_SERVICE')
    expect(offered).toContain('CABIN_AIR_FILTER')
    expect(offered).toContain('TIRE_BALANCE')
    expect(offered).toContain('WIPER_BLADES')
    expect(offered.length).toBeGreaterThanOrEqual(5)
  })

  it('does not offer driveline fluid on a sealed electric drive unit', () => {
    // A rear-drive Model 3 matches the driveline rule but has its motor,
    // gearing and differential in one unit, filled for life. Matching on
    // driveline alone put a $189 diff service in front of a Tesla owner.
    expect(offered).not.toContain('DIFF_FLUID_SERVICE')
    expect(offered).not.toContain('TRANSFER_CASE')
  })
})

describe('intervalApplies — driveline', () => {
  const diff = interval({ appliesTo: { driveTypes: ['RWD', 'AWD', 'FOUR_WD'] } })
  const transferCase = interval({ appliesTo: { driveTypes: ['AWD', 'FOUR_WD'] } })

  it('offers a differential service on anything with a driven rear axle', () => {
    for (const driveType of ['RWD', 'AWD', 'FOUR_WD'] as const) {
      expect(intervalApplies(diff, vehicle({ driveType })), driveType).toBe(true)
    }
  })

  it('does not offer one on a front-wheel-drive car', () => {
    // Its differential is inside the transaxle and is serviced with the
    // transmission fluid — there is no separate service to sell.
    expect(intervalApplies(diff, vehicle({ driveType: 'FWD' }))).toBe(false)
  })

  it('only offers a transfer case service to all-wheel and four-wheel drive', () => {
    expect(intervalApplies(transferCase, vehicle({ driveType: 'AWD' }))).toBe(true)
    expect(intervalApplies(transferCase, vehicle({ driveType: 'RWD' }))).toBe(false)
    expect(intervalApplies(transferCase, vehicle({ driveType: 'FWD' }))).toBe(false)
  })

  it('skips rather than guesses when the driveline is unknown', () => {
    // Dropping a line we were unsure about costs one item. Offering a transfer
    // case service on a Camry costs the advisor the room.
    expect(intervalApplies(diff, vehicle({ driveType: null }))).toBe(false)
    expect(intervalApplies(transferCase, vehicle({ driveType: undefined }))).toBe(false)
  })
})

describe('intervalApplies — phased-out systems', () => {
  const powerSteering = interval({ appliesTo: { combustionOnly: true, maxModelYear: 2012 } })

  it('offers a power steering flush on a car old enough to have hydraulic assist', () => {
    expect(intervalApplies(powerSteering, vehicle({ modelYear: 2009 }))).toBe(true)
    expect(intervalApplies(powerSteering, vehicle({ modelYear: 2012 }))).toBe(true)
  })

  it('does not offer one on a car that has electric steering and no fluid', () => {
    expect(intervalApplies(powerSteering, vehicle({ modelYear: 2013 }))).toBe(false)
    expect(intervalApplies(powerSteering, vehicle({ modelYear: 2024 }))).toBe(false)
  })
})

describe('detectAlignment', () => {
  it('says nothing when both sides match', () => {
    // Alignment is not a mileage service. With no evidence there is nothing
    // to recommend, and inventing an interval is what this avoids.
    expect(
      detectAlignment([
        { position: 'LF', value: 8 },
        { position: 'RF', value: 8 },
        { position: 'LR', value: 9 },
        { position: 'RR', value: 9 },
      ]),
    ).toBeNull()
  })

  it('ignores a difference small enough to be measurement noise', () => {
    // 1/32" is where on the tread the technician happened to put the gauge.
    expect(
      detectAlignment([
        { position: 'LF', value: 8 },
        { position: 'RF', value: 7 },
      ]),
    ).toBeNull()
  })

  it('reports a real spread across the front axle, with the numbers', () => {
    const finding = detectAlignment([
      { position: 'LF', value: 8 },
      { position: 'RF', value: 4 },
    ])
    expect(finding?.axle).toBe('FRONT')
    expect(finding?.spread).toBe(4)
    // The recommendation carries its own proof rather than citing a schedule.
    expect(finding?.detail).toContain('8/32"')
    expect(finding?.detail).toContain('4/32"')
    expect(finding?.detail).toMatch(/right tyre is paying for it/)
  })

  it('reports the rear axle when that is where the wear is', () => {
    const finding = detectAlignment([
      { position: 'LF', value: 8 },
      { position: 'RF', value: 8 },
      { position: 'LR', value: 3 },
      { position: 'RR', value: 9 },
    ])
    expect(finding?.axle).toBe('REAR')
    expect(finding?.spread).toBe(6)
  })

  it('picks the worse axle when both are uneven', () => {
    const finding = detectAlignment([
      { position: 'LF', value: 8 },
      { position: 'RF', value: 5 },
      { position: 'LR', value: 9 },
      { position: 'RR', value: 2 },
    ])
    expect(finding?.axle).toBe('REAR')
  })

  it('needs both sides of an axle before it says anything', () => {
    expect(detectAlignment([{ position: 'LF', value: 3 }])).toBeNull()
    expect(detectAlignment([])).toBeNull()
  })
})
