import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveAccess } from '@/lib/billing/access'
import { linkStatusMessage } from '@/lib/presentation/link'

/**
 * The customer's phone, when the dealership behind it cannot save.
 *
 * ---------------------------------------------------------------------------
 * TWO THINGS ARE BEING PROVED HERE, AND THE SECOND IS THE IMPORTANT ONE
 * ---------------------------------------------------------------------------
 * The first is the same fact the drive test pins down: a suspended dealership
 * writes nothing, so neither store function is ever reached.
 *
 * The second is what the customer reads. This is the only guarded surface in
 * the product that is not looked at by an employee, and the sentence staff get
 * — "This account is suspended. Contact DealerTech to restore access." — must
 * never appear on it. Somebody deciding whether to spend six hundred pounds at
 * a dealership should not learn from us that the dealership is behind on a bill
 * with a vendor they have never heard of. So there is a test below that reads
 * the refusal and fails on any word that would leak it, and it is written to
 * fail loudly rather than to be quietly deleted.
 */

const fixture = vi.hoisted(() => ({
  STORE: '33333333-3333-3333-3333-333333333333',
  /** The lifecycle status the store behind the token is in. Set per case. */
  status: 'ACTIVE' as 'ACTIVE' | 'SUSPENDED' | 'EXPIRED' | 'CHURNED',
  /** The status the link itself is in, independent of the dealership. */
  linkStatus: 'OPEN' as 'OPEN' | 'EXPIRED' | 'ENDED' | 'AUTHORIZED',
  /** Set the moment either store function is entered. */
  wrote: false,
}))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

vi.mock('@/lib/auth/session', () => ({
  accessForStore: async () => resolveAccess({
    status: fixture.status,
    statusChangedAt: new Date('2026-03-01T00:00:00Z'),
    trialEndsAt: new Date('2026-03-01T00:00:00Z'),
    asOf: new Date('2026-03-15T09:00:00Z'),
  }),
}))

vi.mock('@/lib/presentation/link-store', () => ({
  linkSessionFromToken: async () => ({
    id: 'session-1',
    storeId: fixture.STORE,
    appointmentId: 'appointment-1',
    sequence: 1,
    snapshot: { tiers: [], itemCount: 0 },
    decisions: {},
    status: fixture.linkStatus,
    authorizedAt: null,
    authorizedName: null,
  }),
  /*
    Both mirror the real functions' own guard: they re-read the token and hand
    the session straight back, unwritten, unless it is OPEN. Faking them as
    unconditional writers would have let this file claim the suspension check
    was doing work that the link's own status was already doing.
  */
  recordLinkDecisions: async () => {
    if (fixture.linkStatus !== 'OPEN') return { status: fixture.linkStatus }
    fixture.wrote = true
    return { status: 'OPEN' }
  },
  authoriseLinkSession: async () => {
    if (fixture.linkStatus !== 'OPEN') return { status: fixture.linkStatus }
    fixture.wrote = true
    return { status: 'AUTHORIZED' }
  },
}))

const { authorise, saveAnswer } = await import('./actions')

const CLOSED = linkStatusMessage('ENDED')

function authoriseForm(): FormData {
  const form = new FormData()
  form.set('token', 'a-token')
  form.set('name', 'Rebecca Hall')
  return form
}

beforeEach(() => {
  fixture.status = 'ACTIVE'
  fixture.linkStatus = 'OPEN'
  fixture.wrote = false
})

describe('a menu link at a dealership that cannot save', () => {
  it('drops no answer silently — it refuses the tap and says so', async () => {
    fixture.status = 'SUSPENDED'

    expect(await saveAnswer('a-token', 'item-1', 'ACCEPTED')).toBe('ENDED')
    expect(fixture.wrote).toBe(false)
  })

  it('refuses an authorisation rather than recording a consent that is not there', async () => {
    /*
      The one that would matter in a dispute.

      An authorisation is a customer putting their name to a figure. Letting the
      submit look like it worked while nothing was written would leave them
      believing they had approved six hundred pounds of brakes and us holding no
      record of it — a false impression of consent, which is the single thing
      this surface exists to avoid creating.
    */
    fixture.status = 'SUSPENDED'

    const state = await authorise({}, authoriseForm())
    expect(state.done).toBeUndefined()
    expect(state.refused).toBe('ENDED')
    expect(state.error).toBe(CLOSED)
    expect(fixture.wrote).toBe(false)
  })

  it('says nothing to the customer about the dealership’s billing', async () => {
    /*
      Do not relax this test. If a wording change trips it, change the wording.

      The refusal a customer sees is deliberately not the true reason. Every
      word below appears in the sentence staff are shown for the same state, and
      any of them reaching a phone would disclose a dealership's commercial
      trouble to their own customer, mid-decision, on our initiative.
    */
    fixture.status = 'SUSPENDED'
    const leaks = [
      'suspend', 'billing', 'DealerTech', 'payment', 'invoice',
      'subscription', 'account', 'trial', 'expired',
    ]

    const state = await authorise({}, authoriseForm())
    for (const word of leaks) {
      expect(state.error?.toLowerCase(), word).not.toContain(word.toLowerCase())
    }
  })

  it('points them at the person who can actually help', async () => {
    // Their advisor, not us. They have a phone number for one of those.
    fixture.status = 'SUSPENDED'
    const state = await authorise({}, authoriseForm())
    expect(state.error).toContain('advisor')
  })

  it('treats a trial that ran out exactly like a suspension', async () => {
    // EXPIRED and CHURNED both carry `canWork: false`. The customer surface
    // draws no distinction between them — none of it is their business.
    for (const status of ['EXPIRED', 'CHURNED'] as const) {
      fixture.status = status
      fixture.wrote = false
      expect(await saveAnswer('a-token', 'item-1', 'ACCEPTED'), status).toBe('ENDED')
      expect(fixture.wrote, status).toBe(false)
    }
  })
})

describe('a menu link at a dealership in good standing', () => {
  it('records the tap as before', async () => {
    expect(await saveAnswer('a-token', 'item-1', 'ACCEPTED')).toBe('OPEN')
    expect(fixture.wrote).toBe(true)
  })

  it('takes the authorisation as before', async () => {
    const state = await authorise({}, authoriseForm())
    expect(state.done).toBe(true)
    expect(state.error).toBeUndefined()
    expect(fixture.wrote).toBe(true)
  })

  it('still refuses a name too short to be one', async () => {
    // Checked before the dealership is, because it is the customer's own input
    // and has nothing to do with anybody's billing.
    const form = new FormData()
    form.set('token', 'a-token')
    form.set('name', 'R')

    const state = await authorise({}, form)
    expect(state.error).toBe('Please type your name to confirm.')
    expect(fixture.wrote).toBe(false)
  })
})

describe('a link that is closed on its own terms', () => {
  it('keeps its own more specific answer rather than borrowing ENDED', async () => {
    // A dealership in good standing with an expired link must still say
    // "expired" — the suspension path must not swallow the ordinary one.
    fixture.linkStatus = 'EXPIRED'

    const state = await authorise({}, authoriseForm())
    expect(state.refused).toBe('EXPIRED')
  })
})
