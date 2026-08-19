import { describe, expect, it } from 'vitest'
import {
  generateDeviceToken, generatePairingCode, hashToken, isPairingExpired, isWellFormedCode,
  normalizePairingCode, pairingExpiry, tokenMatches,
} from './codes'
import { isSessionIdle, SESSION_IDLE_MINUTES, sessionIdleDeadline } from './session'
import { buildDeviceSnapshot, FORBIDDEN_KEYS, sanitizeDecisions } from './snapshot'
import {
  menuTotals, nextTabletState, withAuthorisation, withoutTap,
  type PendingTaps, type PolledSession, type TabletState,
} from './tablet-state'
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

describe('tablet idle window', () => {
  const lastTap = new Date('2026-08-12T16:40:00')

  it('is thirty minutes from the last tap', () => {
    expect(SESSION_IDLE_MINUTES).toBe(30)
    expect(sessionIdleDeadline(lastTap)).toEqual(new Date('2026-08-12T17:10:00'))
  })

  it('leaves a menu up while somebody is still answering it', () => {
    expect(isSessionIdle(lastTap, new Date('2026-08-12T17:09:59'))).toBe(false)
  })

  it('ends it at the deadline', () => {
    // `>=`, the same side of the boundary `isPairingExpired` takes.
    expect(isSessionIdle(lastTap, new Date('2026-08-12T17:10:00'))).toBe(true)
    expect(isSessionIdle(lastTap, new Date('2026-08-12T17:10:01'))).toBe(true)
  })

  it('clears a tablet left on a bench overnight', () => {
    expect(isSessionIdle(lastTap, new Date('2026-08-13T07:30:00'))).toBe(true)
  })

  it('runs from the last tap, never from the push', () => {
    /*
      The property a customer working through the menu alone depends on. A
      session pushed at 16:00 and answered steadily is still live at 17:00,
      because each tap moved `lastActivityAt` — an absolute cap from the push
      would blank the screen of somebody mid-answer.
    */
    const pushed = new Date('2026-08-12T16:00:00')
    const now = new Date('2026-08-12T17:00:00')
    expect(isSessionIdle(pushed, now)).toBe(true)
    expect(isSessionIdle(new Date('2026-08-12T16:55:00'), now)).toBe(false)
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

// ===========================================================================

describe('what a poll does to the tablet', () => {
  const s = sheet([opp(), opp({ id: 'o2', title: 'Cabin filter', urgency: 'LOW' })])
  const snapshot = buildDeviceSnapshot(s, defaultSelection(s.opportunities))

  const presenting = (sessionId: string, over: Partial<TabletState> = {}): TabletState => ({
    phase: 'PRESENTING',
    sessionId,
    deviceName: 'Lane 3',
    snapshot,
    decisions: {},
    selfServe: false,
    authorized: null,
    ...over,
  } as TabletState)

  const polled = (
    id: string,
    decisions: Record<string, string> = {},
    over: Partial<PolledSession> = {},
  ) => ({
    deviceName: 'Lane 3',
    session: { id, snapshot, decisions, selfServe: false, authorized: null, ...over },
  })

  it('keeps the taps in flight while the same session polls again', () => {
    // The ordinary case, twice a second. Dropping the map here would make
    // every answer flicker back to unanswered until the server caught up.
    const next = nextTabletState(presenting('s1'), { o1: 'ACCEPTED' }, polled('s1'))
    expect(next.pending).toEqual({ o1: 'ACCEPTED' })
    expect(next.state.phase).toBe('PRESENTING')
  })

  it('drops them when a different session arrives', () => {
    /*
      F8. The advisor re-curates and sends again: a new session, a new snapshot,
      no decisions on it — and the previous customer's in-flight taps were being
      merged over it. Ids are stable per visit, so two sends of one re-curated
      menu is exactly where they land on each other.
    */
    const next = nextTabletState(presenting('s1'), { o1: 'ACCEPTED' }, polled('s2'))
    expect(next.pending).toEqual({})
    expect(next.state).toMatchObject({ phase: 'PRESENTING', sessionId: 's2' })
  })

  it('drops them when the menu goes away', () => {
    // Taken back by the advisor, or ended by the idle window on the server.
    const next = nextTabletState(presenting('s1'), { o1: 'ACCEPTED' }, {
      deviceName: 'Lane 3',
      session: null,
    })
    expect(next.pending).toEqual({})
    expect(next.state).toEqual({ phase: 'IDLE', deviceName: 'Lane 3' })
  })

  it('starts a menu arriving at an idle tablet with nothing carried over', () => {
    const next = nextTabletState({ phase: 'IDLE', deviceName: 'Lane 3' }, { o1: 'ACCEPTED' }, polled('s1'))
    expect(next.pending).toEqual({})
  })

  it('shows what the server says, not what the tablet remembered', () => {
    const next = nextTabletState(presenting('s1'), {}, polled('s1', { o2: 'DECLINED' }))
    expect(next.state).toMatchObject({ decisions: { o2: 'DECLINED' } })
  })
})

describe('a tap the server refused', () => {
  /*
    F14. The customer answers as the advisor takes the menu back, the route
    returns 409, and the optimistic paint is a claim nobody is holding up.
  */
  it('stops showing the one that was refused', () => {
    expect(withoutTap({ o1: 'ACCEPTED', o2: 'DECLINED' }, 'o1')).toEqual({ o2: 'DECLINED' })
  })

  it('leaves the taps still in flight alone', () => {
    // A customer working down a menu has several outstanding at once and only
    // the refused one is a lie.
    const pending = { o1: 'ACCEPTED', o2: 'CALL_ME', o3: 'DECLINED' }
    expect(withoutTap(pending, 'o2')).toEqual({ o1: 'ACCEPTED', o3: 'DECLINED' })
  })

  it('hands back the same map when there is nothing to take back', () => {
    // The poll may already have absorbed it. Returning a new object would
    // re-render the menu for a change that is not one.
    const pending = { o1: 'ACCEPTED' }
    expect(withoutTap(pending, 'o9')).toBe(pending)
    expect(withoutTap({}, 'o1')).toEqual({})
  })
})

describe('what the tablet footer counts', () => {
  const s = sheet([
    opp({ priceSource: 'STORE', customerOutOfPocket: 900 }),
    opp({ id: 'o2', title: 'Cabin filter', urgency: 'LOW', priceSource: 'STORE', customerOutOfPocket: 120 }),
  ])
  const snapshot = buildDeviceSnapshot(s, defaultSelection(s.opportunities))

  it('counts only what is on this menu', () => {
    /*
      The other half of F8. A decisions map can hold an id that is not on the
      snapshot in front of the customer — an answer from the session before it,
      or a line the advisor dropped when they re-curated — and counting those
      told the customer they had said yes to more than the screen showed.
    */
    const totals = menuTotals(snapshot, {
      o1: 'ACCEPTED',
      'from-the-last-menu': 'ACCEPTED',
      'also-a-ghost': 'CALL_ME',
    })
    expect(totals.accepted).toBe(1)
    expect(totals.callMe).toBe(0)
    expect(totals.acceptedTotal).toBe(900)
  })

  it('adds up what they said yes to', () => {
    const totals = menuTotals(snapshot, { o1: 'ACCEPTED', o2: 'ACCEPTED' })
    expect(totals.accepted).toBe(2)
    expect(totals.acceptedTotal).toBe(1020)
  })

  it('counts an unpriced line as a yes but adds nothing for it', () => {
    // "Price to be confirmed" on screen and our estimate in the total underneath
    // is the same unhonourable number arriving by another route.
    const s2 = sheet([
      opp({ priceSource: 'STORE', customerOutOfPocket: 900 }),
      opp({ id: 'o2', title: 'Cabin filter', urgency: 'LOW', priceSource: 'ESTIMATE' }),
    ])
    // Ticked on by hand: `defaultSelection` leaves an unpriced line off a menu,
    // so it only ever reaches a tablet because an advisor chose to send it.
    const snap = buildDeviceSnapshot(s2, { includedIds: ['o1', 'o2'] })
    const totals = menuTotals(snap, { o1: 'ACCEPTED', o2: 'ACCEPTED' })
    expect(totals.accepted).toBe(2)
    expect(totals.acceptedTotal).toBe(900)
  })

  it('keeps a call-me out of the yeses', () => {
    const totals = menuTotals(snapshot, { o1: 'CALL_ME', o2: 'DECLINED' })
    expect(totals).toEqual({
      accepted: 0, declined: 1, callMe: 1, answered: 2, acceptedTotal: 0,
    })
  })

  /*
    Q6. A handed-over tablet says "4 of 6 answered" over its confirm bar and the
    advisor's mirror reads back the same figure, so the two screens describing
    one moment cannot disagree about how far through it the customer is.
  */
  it('counts all three answers as answered, and never a cleared one', () => {
    expect(menuTotals(snapshot, { o1: 'ACCEPTED', o2: 'DECLINED' }).answered).toBe(2)
    expect(menuTotals(snapshot, { o1: 'CALL_ME' }).answered).toBe(1)
    // Tapping the same button twice takes the answer back. An absence is not
    // an answer, on either screen.
    expect(menuTotals(snapshot, { o1: 'PENDING', o2: 'PENDING' }).answered).toBe(0)
    expect(menuTotals(snapshot, {}).answered).toBe(0)
  })

  it('will not let a ghost id inflate how far through they are', () => {
    const totals = menuTotals(snapshot, { o1: 'ACCEPTED', 'from-the-last-menu': 'DECLINED' })
    expect(totals.answered).toBe(1)
    expect(totals.declined).toBe(0)
  })
})

// ===========================================================================

describe('a tablet handed to the customer', () => {
  /*
    Q6. The same tablet, the same snapshot, the same shared menu — plus the
    link's finish. What is new in the pure layer is a session that can be
    *over*: the customer typed their name and sent it, the server stops taking
    taps, and the glass becomes a record of what they chose.

    Every case here is checked against an attended session as well, because the
    one thing this must not do is change the conversation an advisor is already
    holding.
  */
  const s = sheet([opp(), opp({ id: 'o2', title: 'Cabin filter', urgency: 'LOW' })])
  const snapshot = buildDeviceSnapshot(s, defaultSelection(s.opportunities))

  const screen = (over: Partial<TabletState> = {}, pending: PendingTaps = {}) => ({
    state: {
      phase: 'PRESENTING',
      sessionId: 's1',
      deviceName: 'Lane 3',
      snapshot,
      decisions: {},
      selfServe: true,
      authorized: null,
      ...over,
    } as TabletState,
    pending,
  })

  const poll = (over: Partial<PolledSession> = {}) => ({
    deviceName: 'Lane 3',
    session: {
      id: 's1', snapshot, decisions: {}, selfServe: true, authorized: null, ...over,
    } as PolledSession,
  })

  const betty = { at: '2026-08-18T14:04:00.000Z', name: 'Betty Lewis' }

  it('carries the mode and the sign-off onto the screen', () => {
    const next = nextTabletState(screen().state, {}, poll({ authorized: betty }))
    expect(next.state).toMatchObject({ selfServe: true, authorized: betty })
  })

  it('drops the taps still in flight once they have sent it', () => {
    /*
      The server refuses a tap against an authorised session, so a paint left
      over from one is an answer on the glass that the frozen authorisation does
      not contain — under a banner saying it has been sent.
    */
    const next = nextTabletState(screen().state, { o1: 'ACCEPTED' }, poll({ authorized: betty }))
    expect(next.pending).toEqual({})
  })

  it('leaves an attended session exactly as it was', () => {
    // An advisor presenting a menu never authorises from the glass, so nothing
    // above can reach this path — pinned so it stays that way.
    const attended = screen({ selfServe: false }).state
    const next = nextTabletState(attended, { o1: 'ACCEPTED' }, poll({ selfServe: false }))
    expect(next.pending).toEqual({ o1: 'ACCEPTED' })
    expect(next.state).toMatchObject({ selfServe: false, authorized: null })
  })

  it('paints the confirmation without waiting for the next poll', () => {
    // They pressed the button. Up to 1.5 seconds of a menu that still looks
    // answerable is the product losing the one action that matters most.
    const next = withAuthorisation(screen({}, { o1: 'ACCEPTED' }), betty)
    expect(next.state).toMatchObject({ authorized: betty })
    expect(next.pending).toEqual({})
  })

  it('will not let a second confirmation rewrite the first', () => {
    // A double tap, or a retried request. The record stops moving, and whose
    // name is on it is the part that must not move at all.
    const already = screen({ authorized: betty })
    const next = withAuthorisation(already, { at: '2026-08-18T15:00:00.000Z', name: 'Someone Else' })
    expect(next).toBe(already)
    expect(next.state).toMatchObject({ authorized: betty })
  })

  it('has nothing to authorise on an idle tablet', () => {
    const idle = { state: { phase: 'IDLE', deviceName: 'Lane 3' } as TabletState, pending: {} }
    expect(withAuthorisation(idle, betty)).toBe(idle)
  })

  it('goes idle when the advisor takes a finished menu back', () => {
    // F7/F8/F14 are unchanged by any of this: the session ending is the session
    // ending, whoever was holding the tablet.
    const next = nextTabletState(
      screen({ authorized: betty }).state,
      {},
      { deviceName: 'Lane 3', session: null },
    )
    expect(next.state).toEqual({ phase: 'IDLE', deviceName: 'Lane 3' })
  })
})
