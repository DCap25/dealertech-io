import { describe, expect, it } from 'vitest'
import { goLiveChecklist, isLive, type GoLiveFacts } from './go-live'
import { progress, type StoreSignals } from '@/lib/onboarding/steps'

/**
 * The onboarding checklist, from the console's side.
 *
 * The four rows that come from the dealership's own engine are tested there;
 * what is pinned here is the part only this module decides — that an
 * unaccepted invitation is a row with a button on it, that a self-serve signup
 * does not get nagged about an invitation nobody ever sent, and that "nothing
 * booked" is honest about there being nothing DealerTech can do about it.
 */

const ASOF = new Date('2026-08-20T12:00:00.000Z')

function signals(overrides: Partial<StoreSignals> = {}): StoreSignals {
  return {
    storeCreatedAt: new Date('2026-08-01T00:00:00.000Z'),
    laborRate: 185,
    partsTaxRate: 0.0825,
    laborTaxRate: 0,
    staffCount: 1,
    pendingInvites: 0,
    opCodeCount: 0,
    declineCount: 0,
    importCount: 0,
    presentationCount: 0,
    firstPresentationAt: null,
    acknowledged: new Set<string>(),
    ...overrides,
  }
}

function facts(overrides: Partial<GoLiveFacts> = {}): GoLiveFacts {
  return {
    progress: progress(signals()),
    adminInvite: null,
    appointmentCount: 0,
    // The state of a tenant provisioned today: `createStoreOn` writes the
    // eight defaults inside the provisioning transaction.
    cadenceRuleCount: 8,
    asOf: ASOF,
    ...overrides,
  }
}

const PENDING = {
  email: 'ray@lonestar.test',
  acceptedAt: null,
  revokedAt: null,
  expiresAt: new Date('2026-08-25T00:00:00.000Z'),
}

const rowFor = (items: ReturnType<typeof goLiveChecklist>, key: string) =>
  items.find((i) => i.key === key)

describe('the shape of the list', () => {
  it('leads with the two rows DealerTech owns, then the dealership’s own work', () => {
    expect(goLiveChecklist(facts()).map((i) => i.key)).toEqual([
      'ADMIN_INVITE',
      'CADENCE_RULES',
      'PRICE_BOOK',
      'HISTORY_IMPORTED',
      'TEAM_INVITED',
      'FIRST_APPOINTMENT',
      'FIRST_MENU_PRESENTED',
    ])
  })

  it('takes the four middle verdicts from the onboarding engine', () => {
    /*
      Not re-derived. Two implementations of "is their price book in" is how
      the console ends up telling a support call something the dealership's own
      screen contradicts.
    */
    const items = goLiveChecklist(facts({
      progress: progress(signals({ opCodeCount: 1_200, declineCount: 40 })),
    }))
    expect(rowFor(items, 'PRICE_BOOK')?.done).toBe(true)
    expect(rowFor(items, 'PRICE_BOOK')?.detail).toContain('1,200 op codes')
    expect(rowFor(items, 'HISTORY_IMPORTED')?.done).toBe(true)
  })

  it('points an unfinished setup row at the screen that finishes it', () => {
    const row = rowFor(goLiveChecklist(facts()), 'PRICE_BOOK')
    expect(row?.done).toBe(false)
    expect(row?.pointer).toEqual({ kind: 'LINK', label: '/manager', href: '/manager' })
  })
})

describe('the administrator', () => {
  it('is done, with no nagging, when nobody was ever invited', () => {
    // The ordinary state for a self-serve signup: the person who paid created
    // their own account, so there is nobody to chase.
    const row = rowFor(goLiveChecklist(facts()), 'ADMIN_INVITE')
    expect(row?.done).toBe(true)
    expect(row?.detail).toBe('signed up directly')
    expect(row?.pointer).toBeNull()
  })

  it('is done once they accepted', () => {
    const row = rowFor(goLiveChecklist(facts({
      adminInvite: { ...PENDING, acceptedAt: new Date('2026-08-05T00:00:00.000Z') },
    })), 'ADMIN_INVITE')

    expect(row?.done).toBe(true)
    expect(row?.detail).toContain('2026-08-05')
    expect(row?.pointer).toBeNull()
  })

  it('offers a fresh invitation when it is still pending', () => {
    /*
      A fresh one, never the old link. Only the token's SHA-256 is stored, so
      there is nothing to show again — which is exactly the thing the scope
      note asked for and the schema forbids.
    */
    const row = rowFor(goLiveChecklist(facts({ adminInvite: PENDING })), 'ADMIN_INVITE')

    expect(row?.done).toBe(false)
    expect(row?.detail).toContain('sent, not accepted')
    expect(row?.pointer).toEqual({ kind: 'REINVITE', email: 'ray@lonestar.test' })
  })

  it('says so when the link has expired', () => {
    const row = rowFor(goLiveChecklist(facts({
      adminInvite: { ...PENDING, expiresAt: new Date('2026-08-10T00:00:00.000Z') },
    })), 'ADMIN_INVITE')

    expect(row?.detail).toContain('expired')
    expect(row?.pointer?.kind).toBe('REINVITE')
  })

  it('says so when it was withdrawn', () => {
    const row = rowFor(goLiveChecklist(facts({
      adminInvite: { ...PENDING, revokedAt: new Date('2026-08-10T00:00:00.000Z') },
    })), 'ADMIN_INVITE')

    expect(row?.detail).toContain('withdrawn')
  })

  it('reads acceptance off the stamp, not off the expiry', () => {
    // An accepted invitation whose window has since closed is still accepted.
    const row = rowFor(goLiveChecklist(facts({
      adminInvite: {
        ...PENDING,
        acceptedAt: new Date('2026-08-03T00:00:00.000Z'),
        expiresAt: new Date('2026-08-08T00:00:00.000Z'),
      },
    })), 'ADMIN_INVITE')

    expect(row?.done).toBe(true)
  })
})

describe('the follow-up rules', () => {
  it('is done for a tenant provisioned since the defaults arrived', () => {
    const row = rowFor(goLiveChecklist(facts()), 'CADENCE_RULES')
    expect(row?.done).toBe(true)
    expect(row?.pointer).toBeNull()
  })

  it('catches the pre-build tenant whose worklist will never fill', () => {
    /*
      The whole reason the row exists. `generateTasks` produces nothing without
      rules, so the dealership's own screen says "nothing to work" — which
      reads as the product having looked, not as nobody having set it up. It
      was invisible from every other direction on this page.
    */
    const row = rowFor(goLiveChecklist(facts({ cadenceRuleCount: 0 })), 'CADENCE_RULES')

    expect(row?.done).toBe(false)
    expect(row?.detail).toContain('worklist will stay empty')
  })

  it('points at the backfill script rather than offering a button', () => {
    // Writing eight rows into somebody else's dealership deserves a person who
    // has read what the script does — and it lists before it writes, which a
    // button cannot offer.
    const row = rowFor(goLiveChecklist(facts({ cadenceRuleCount: 0 })), 'CADENCE_RULES')

    expect(row?.pointer?.kind).toBe('SCRIPT')
    expect(row?.pointer && 'command' in row.pointer ? row.pointer.command : '')
      .toContain('backfill-cadence-rules.ts --apply')
  })

  it('counts rules that exist, not rules that are switched on', () => {
    // A store that disabled all eight has made a decision, and nagging them
    // about it here would be second-guessing a setting they own.
    expect(rowFor(goLiveChecklist(facts({ cadenceRuleCount: 8 })), 'CADENCE_RULES')?.done)
      .toBe(true)
  })
})

describe('the first appointment', () => {
  it('admits that nobody here can book it', () => {
    const row = rowFor(goLiveChecklist(facts()), 'FIRST_APPOINTMENT')
    expect(row?.done).toBe(false)
    // A link would imply somebody on this side can do it. The honest answer is
    // that this is the row you ring them about.
    expect(row?.pointer?.kind).toBe('WAIT')
  })

  it('counts once anything is on the books', () => {
    const row = rowFor(goLiveChecklist(facts({ appointmentCount: 14 })), 'FIRST_APPOINTMENT')
    expect(row?.done).toBe(true)
    expect(row?.detail).toBe('14 booked')
  })
})

describe('isLive', () => {
  it('is false while anything is outstanding', () => {
    expect(isLive(goLiveChecklist(facts()))).toBe(false)
  })

  it('is true for a dealership that has actually started', () => {
    const items = goLiveChecklist(facts({
      progress: progress(signals({
        opCodeCount: 900,
        declineCount: 300,
        staffCount: 6,
        presentationCount: 12,
        firstPresentationAt: new Date('2026-08-09T00:00:00.000Z'),
      })),
      adminInvite: { ...PENDING, acceptedAt: new Date('2026-08-02T00:00:00.000Z') },
      appointmentCount: 40,
    }))

    expect(items.every((i) => i.done)).toBe(true)
    expect(isLive(items)).toBe(true)
  })
})
