import { describe, expect, it } from 'vitest'
import {
  generateDeviceToken, generatePairingCode, hashToken, isPairingExpired, isWellFormedCode,
  normalizePairingCode, pairingExpiry, tokenMatches,
} from './codes'
import { buildDeviceSnapshot, FORBIDDEN_KEYS, sanitizeDecisions } from './snapshot'
import { defaultSelection } from '@/lib/menu/selection'
import type { Opportunity, PrepSheet } from '@/lib/prep-sheet'

// ===========================================================================

describe('pairing codes', () => {
  it('avoids glyphs a human confuses across a desk', () => {
    // The code is read off a tablet and typed into a phone mid-conversation.
    for (let i = 0; i < 200; i++) {
      expect(generatePairingCode()).not.toMatch(/[IO10]/)
    }
  })

  it('is six characters', () => {
    expect(generatePairingCode()).toHaveLength(6)
  })

  it('accepts whatever shape a human types', () => {
    expect(normalizePairingCode(' 7k2-qw4 ')).toBe('7K2QW4')
    expect(isWellFormedCode('7k2 qw4')).toBe(true)
  })

  it('rejects a code with an ambiguous glyph in it', () => {
    expect(isWellFormedCode('7K2QW0')).toBe(false)
    expect(isWellFormedCode('ABC')).toBe(false)
  })
})

describe('device tokens', () => {
  it('never stores the token itself', () => {
    // A dump of the devices table must not let anyone impersonate a tablet.
    const token = generateDeviceToken()
    const stored = hashToken(token)
    expect(stored).not.toContain(token)
    expect(stored).toHaveLength(64)
  })

  it('matches a correct token and rejects a wrong one', () => {
    const token = generateDeviceToken()
    const stored = hashToken(token)
    expect(tokenMatches(token, stored)).toBe(true)
    expect(tokenMatches(generateDeviceToken(), stored)).toBe(false)
  })

  it('rejects a malformed token without throwing', () => {
    expect(tokenMatches('not-a-token', hashToken('x'))).toBe(false)
    expect(tokenMatches('', 'short')).toBe(false)
  })

  it('generates a different token every time', () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateDeviceToken()))
    expect(seen.size).toBe(50)
  })
})

describe('pairing window', () => {
  it('closes after ten minutes', () => {
    const start = new Date('2026-08-12T09:00:00')
    const expires = pairingExpiry(start)
    expect(isPairingExpired(expires, new Date('2026-08-12T09:09:00'))).toBe(false)
    expect(isPairingExpired(expires, new Date('2026-08-12T09:10:00'))).toBe(true)
  })
})

// ===========================================================================

function opp(over: Partial<Opportunity> = {}): Opportunity {
  return {
    id: 'o1',
    type: 'WEAR_PREDICTED',
    title: 'Tyres approaching replacement',
    detail: 'ADVISOR: confirm history with the customer before quoting.',
    customerDetail: 'Worst corner RF is at 2/32".',
    componentGroupKey: 'TIRES',
    estimatedAmount: 1100,
    customerOutOfPocket: 900,
    likelyPayer: 'CUSTOMER_PAY',
    urgency: 'SAFETY',
    closeProbability: 0.42,
    priorityScore: 980,
    talkTrack: 'Lead with the measurement, never the price.',
    ...over,
  }
}

function sheet(opportunities: Opportunity[]): PrepSheet {
  return {
    customer: {
      id: 'c1', name: 'Betty Lewis', visitCount: 3, lifetimeSpend: 418,
      lastVisitAt: null, preferredChannel: 'SMS', pinnedNotes: [],
    },
    vehicle: {
      id: 'v1', vin: '1FTCVVGJ0RF58TASC', make: 'FORD', model: 'Edge', modelYear: 2024,
      inServiceDate: null, currentMileage: 29_517, avgMilesPerDay: null,
      isHybridOrEv: false, isOriginalOwner: true,
    },
    appointment: undefined,
    warranty: { terms: [] } as unknown as PrepSheet['warranty'],
    contracts: [],
    prepaidEntitlements: [],
    inspectionHistory: [
      {
        mileage: 29_517,
        recordedAt: new Date('2026-08-12T08:00:00'),
        items: [
          { itemKey: 'tread_rf', componentGroupKey: 'TIRES', value: 2, unit: 'THIRTY_SECONDS', position: 'RF' },
        ],
      },
    ],
    projectedMileage: 29_517,
    opportunities,
    totals: { opportunityValue: 1100, customerOutOfPocket: 900, coveredValue: 200 },
    alerts: [],
  }
}

describe('buildDeviceSnapshot', () => {
  const s = sheet([opp()])
  const snapshot = buildDeviceSnapshot(s, defaultSelection(s.opportunities))

  it('sends nothing the customer should not see', () => {
    // The whole point of the whitelist. Serialise the entire payload and look
    // for the forbidden keys at any depth — adding a field to Opportunity must
    // not silently add it here.
    const json = JSON.stringify(snapshot)
    for (const key of FORBIDDEN_KEYS) {
      expect(json, `snapshot leaked ${key}`).not.toContain(`"${key}"`)
    }
  })

  it('never sends the talk track’s wording either', () => {
    expect(JSON.stringify(snapshot)).not.toContain('Lead with the measurement')
  })

  it('uses the sanitised detail, not the advisor’s', () => {
    // `detail` carries instructions meant for the advisor. Turning the tablet
    // around must never expose "confirm history with the customer".
    const item = snapshot.tiers[0]!.items[0]!
    expect(item.detail).toBe('Worst corner RF is at 2/32".')
    expect(JSON.stringify(snapshot)).not.toContain('ADVISOR:')
  })

  it('carries what the customer needs to decide', () => {
    const item = snapshot.tiers[0]!.items[0]!
    expect(item.title).toBe('Tyres approaching replacement')
    expect(item.customerOutOfPocket).toBe(900)
    expect(item.fullAmount).toBe(1100)
    expect(snapshot.customerName).toBe('Betty Lewis')
    expect(snapshot.vehicleLabel).toBe('2024 FORD Edge')
  })

  it('carries this vehicle’s own measurement for the explainer', () => {
    const item = snapshot.tiers[0]!.items[0]!
    expect(item.explainerKey).toBe('TIRES')
    expect(item.reading).toEqual({ value: 2, unit: '32nds', position: 'RF' })
  })

  it('sends only what the advisor selected', () => {
    const two = sheet([opp(), opp({ id: 'o2', title: 'Cabin filter', urgency: 'LOW' })])
    const snap = buildDeviceSnapshot(two, { includedIds: ['o2'] })
    expect(snap.itemCount).toBe(1)
    expect(JSON.stringify(snap)).not.toContain('Tyres approaching')
  })

  /*
    Every customer-facing surface now decides whether to show a price by
    reading `priceConfirmed` off this snapshot — the tablet, the link, the
    advisor's own preview and the printout. It used to be decided in three
    places from three derivations, and they disagreed for a while: the screen
    said "price to be confirmed" while the paper the customer walked out with
    printed our estimate. These tests guard the single fact they all read.
  */
  it('marks a price the store cannot bill as unconfirmed', () => {
    const s2 = sheet([opp({ priceSource: 'ESTIMATE' })])
    const snap = buildDeviceSnapshot(s2, { includedIds: ['o1'] })
    expect(snap.tiers[0]!.items[0]!.priceConfirmed).toBe(false)
  })

  it('marks a price that came from the store as confirmed', () => {
    const s2 = sheet([opp({ priceSource: 'STORE' })])
    const snap = buildDeviceSnapshot(s2, { includedIds: ['o1'] })
    expect(snap.tiers[0]!.items[0]!.priceConfirmed).toBe(true)
  })

  it('treats an integration with no price book at all as confirmed', () => {
    // priceSource absent means nothing was resolved either way. Reading that
    // as "unpriced" would redact every price on any DMS with no price book
    // endpoint, which is a worse menu than the one we had.
    const snap = buildDeviceSnapshot(sheet([opp()]), { includedIds: ['o1'] })
    expect(snap.tiers[0]!.items[0]!.priceConfirmed).toBe(true)
  })

  it('leaves an unconfirmed price out of the totals underneath it', () => {
    // The screen says "price to be confirmed" and then the total would have
    // quietly included our figure — putting the number nobody can stand
    // behind back in front of the customer by another route.
    const s2 = sheet([
      opp({ priceSource: 'STORE', estimatedAmount: 300, customerOutOfPocket: 200 }),
      opp({ id: 'o2', title: 'Cabin filter', urgency: 'LOW', priceSource: 'ESTIMATE' }),
    ])
    const snap = buildDeviceSnapshot(s2, { includedIds: ['o1', 'o2'] })
    expect(snap.itemCount).toBe(2)
    expect(snap.customerTotal).toBe(200)
    expect(snap.coveredTotal).toBe(100)
  })

  /*
    Badges.

    Every snapshot test above this block runs on `likelyPayer: 'CUSTOMER_PAY'`,
    so until these existed no test had ever produced a covered badge at all —
    the branch that carries money to the tablet was the one branch the suite
    never entered. These fixtures use $62 and $540 precisely because those
    figures appear nowhere else in the payload.
  */
  const covered = (over: Partial<Opportunity> = {}) =>
    opp({
      title: 'Front brakes',
      urgency: 'MEDIUM',
      likelyPayer: 'VSC',
      estimatedAmount: 540,
      customerOutOfPocket: 62,
      ...over,
    })

  it('says what the customer owes in the customer’s own words', () => {
    const s2 = sheet([covered({ priceSource: 'STORE' })])
    const snap = buildDeviceSnapshot(s2, { includedIds: ['o1'] })
    expect(snap.tiers[0]!.items[0]!.badges).toEqual([
      { label: 'Covered — you pay $62', tone: 'COVERED' },
    ])

    // The advisor's own register never crosses to the tablet. "Only $62 to
    // them" is a sentence about the customer, read by the customer.
    const json = JSON.stringify(snap)
    expect(json).not.toContain('to them')
    expect(json).not.toContain('Customer pays nothing')
  })

  it('calls full coverage covered, not “Customer pays nothing”', () => {
    const s2 = sheet([covered({ priceSource: 'STORE', customerOutOfPocket: 0 })])
    const snap = buildDeviceSnapshot(s2, { includedIds: ['o1'] })
    expect(snap.tiers[0]!.items[0]!.badges).toEqual([
      { label: 'Covered in full', tone: 'COVERED' },
    ])
  })

  it('keeps the estimate out of the badge on an unpriced line', () => {
    /*
      The leak this closes, and why the whitelist test could not see it.

      "Sends nothing the customer should not see" scans for forbidden *keys*.
      A figure derived from `customerOutOfPocket` and baked into a label is a
      forbidden *value* inside an allowed key, which that assertion cannot
      catch by construction. So this one scans values: the price slot is
      redacted for an unpriced line, and the numbers behind it must not reach
      the screen by any other route.
    */
    const s2 = sheet([covered({ priceSource: 'ESTIMATE' })])
    const snap = buildDeviceSnapshot(s2, { includedIds: ['o1'] })
    const item = snap.tiers[0]!.items[0]!

    expect(item.priceConfirmed).toBe(false)
    expect(item.badges).toEqual([{ label: 'Coverage applies', tone: 'COVERED' }])

    // Scanned as money *strings* across the whole payload rather than as bare
    // digits, because the snapshot still ships `customerOutOfPocket` and
    // `fullAmount` as raw numbers on an unpriced line — suppressed by every
    // renderer, but present in the JSON. Whether they should be null is a
    // separate question; nothing may render them either way.
    const json = JSON.stringify(snap)
    expect(json).not.toMatch(/\$\s?\d/)
    expect(json).not.toContain('$62')
    expect(json).not.toContain('$540')

    const labels = JSON.stringify(snap.tiers.flatMap((t) => t.items.map((i) => i.badges)))
    expect(labels).not.toContain('62')
    expect(labels).not.toContain('540')
  })

  it('gives full coverage no price claim either when the price is unconfirmed', () => {
    // "Covered in full" is a statement that the customer owes zero, which is
    // the redacted figure said in words rather than digits.
    const s2 = sheet([covered({ priceSource: 'ESTIMATE', customerOutOfPocket: 0 })])
    const snap = buildDeviceSnapshot(s2, { includedIds: ['o1'] })
    expect(snap.tiers[0]!.items[0]!.badges).toEqual([
      { label: 'Coverage applies', tone: 'COVERED' },
    ])
  })

  it('keeps the non-monetary coverage badges on an unpriced line', () => {
    // Recall and prepaid say who pays, not how much, so there is nothing in
    // them for the price rule to redact.
    for (const [payer, label] of [
      ['OEM_RECALL', 'Manufacturer pays'],
      ['PPM', 'Already paid for'],
    ] as const) {
      const s2 = sheet([covered({ priceSource: 'ESTIMATE', likelyPayer: payer })])
      const snap = buildDeviceSnapshot(s2, { includedIds: ['o1'] })
      expect(snap.tiers[0]!.items[0]!.badges).toEqual([{ label, tone: 'COVERED' }])
    }
  })

  it('still flags a safety item on an unpriced line', () => {
    const s2 = sheet([
      covered({ priceSource: 'ESTIMATE', urgency: 'SAFETY', likelyPayer: 'CUSTOMER_PAY' }),
    ])
    const snap = buildDeviceSnapshot(s2, { includedIds: ['o1'] })
    expect(snap.tiers[0]!.items[0]!.badges).toEqual([{ label: 'Safety item', tone: 'SAFETY' }])
  })

  it('sends nothing about why the shop expects a yes', () => {
    // Close rate and "declined before" are the shop's own reasons for pushing
    // an item. They are on the advisor's list and must not be on the tablet's.
    const s2 = sheet([
      covered({ priceSource: 'STORE', type: 'DECLINED_SERVICE', closeProbability: 0.9 }),
    ])
    const json = JSON.stringify(buildDeviceSnapshot(s2, { includedIds: ['o1'] }))
    expect(json).not.toContain('Declined before')
    expect(json).not.toContain('High close rate')
  })
})

describe('sanitizeDecisions', () => {
  const s = sheet([opp(), opp({ id: 'o2', urgency: 'LOW' })])
  const snapshot = buildDeviceSnapshot(s, defaultSelection(s.opportunities))

  it('keeps decisions for items that were actually presented', () => {
    expect(sanitizeDecisions(snapshot, { o1: 'ACCEPTED', o2: 'DECLINED' })).toEqual({
      o1: 'ACCEPTED',
      o2: 'DECLINED',
    })
  })

  it('drops an id the device was never sent', () => {
    // A device posting something it was not given is broken or being probed.
    // Either way the answer is not to record a decision against an
    // opportunity nobody presented.
    expect(sanitizeDecisions(snapshot, { 'some-other-visit': 'ACCEPTED' })).toEqual({})
  })

  it('drops a value that is not a decision', () => {
    expect(sanitizeDecisions(snapshot, { o1: 'SKIPPED', o2: 42 })).toEqual({})
  })

  it('survives junk', () => {
    expect(sanitizeDecisions(snapshot, null)).toEqual({})
    expect(sanitizeDecisions(snapshot, 'nope')).toEqual({})
    expect(sanitizeDecisions(snapshot, [])).toEqual({})
  })
})
