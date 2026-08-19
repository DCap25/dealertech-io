import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A drive write, proved to stop at a suspended dealership.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS ONE STANDS FOR THE OTHER SIXTEEN
 * ---------------------------------------------------------------------------
 * `checkWork` is now called from seventeen server actions, and testing each of
 * them through its own mocked collaborators would be seventeen copies of this
 * file proving one fact. What is worth pinning down is the fact itself, at a
 * representative site: the guard runs *before* the scoped block opens, so a
 * blocked account never starts a transaction, never reads an appointment, and
 * never writes an outcome row.
 *
 * `recordVisitOutcomes` was chosen because it is the least entangled of them —
 * and because it is the one that would have been most tempting to leave alone.
 * It fires at the end of a visit, it already swallows every failure to avoid
 * blocking an advisor mid-drive, and an outcome row is easy to think of as
 * bookkeeping rather than as work. It is the advisor's scorecard and the
 * follow-up loop's input, which is exactly the kind of write that goes quiet.
 *
 * Nothing here touches a database. `.env.local` is production.
 */

const fixture = vi.hoisted(() => ({
  STORE: '33333333-3333-3333-3333-333333333333',
  USER: '11111111-1111-1111-1111-111111111111',
  /** What the fake `checkWork` answers. Set per case. */
  work: { allowed: true } as { allowed: true } | { allowed: false; error: string },
  /** Did the action open a scope? Anything but false here is a write path run. */
  scopeOpened: false,
}))

vi.mock('@/lib/auth/session', () => ({
  getCurrentUser: async () => ({ id: fixture.USER, storeId: fixture.STORE }),
  getCurrentStore: async () => ({ id: fixture.STORE }),
  checkWork: async () => fixture.work,
}))

vi.mock('@/db/scoped', () => ({
  /*
    Records that the transaction was opened and refuses to run the callback.

    Reaching this at all is the failure the blocked cases are looking for: by
    the time a scope exists the action is committed to reading an appointment
    and upserting against it.
  */
  withCurrentUserScope: async () => {
    fixture.scopeOpened = true
    return { ok: true, recorded: 0 }
  },
}))

const { recordVisitOutcomes } = await import('./outcome-actions')

const SUSPENDED = 'This account is suspended. Records are readable; new work cannot be saved. Contact DealerTech.'

/** One decision, shaped the way the prep sheet sends them. */
const PAYLOAD = [{
  opportunityKey: 'BRAKES_FRONT',
  opportunityType: 'WEAR',
  title: 'Front brakes',
  urgency: 'NOW',
  likelyPayer: 'CUSTOMER',
  estimatedAmount: 618,
  customerOutOfPocket: 618,
  outcome: 'ACCEPTED' as const,
}]

beforeEach(() => {
  fixture.work = { allowed: true }
  fixture.scopeOpened = false
})

describe('recordVisitOutcomes stops at a suspended dealership', () => {
  it('refuses, and never opens the transaction', async () => {
    fixture.work = { allowed: false, error: SUSPENDED }

    const result = await recordVisitOutcomes('appointment-1', PAYLOAD)

    expect(result.ok).toBe(false)
    expect(result.error).toBe(SUSPENDED)
    // The assertion that matters: no scope, so no read and no upsert.
    expect(fixture.scopeOpened).toBe(false)
  })

  it('runs normally for a dealership in good standing', async () => {
    const result = await recordVisitOutcomes('appointment-1', PAYLOAD)

    expect(result.ok).toBe(true)
    expect(fixture.scopeOpened).toBe(true)
  })

  it('refuses in the shape this action already answers in', async () => {
    // Never throws. The advisor is finishing a visit, and an error boundary at
    // that moment costs more than the record does — which is why the guard
    // returns `{ ok: false, error }` rather than letting anything escape.
    fixture.work = { allowed: false, error: SUSPENDED }

    const result = await recordVisitOutcomes('appointment-1', PAYLOAD)
    expect(result).toEqual({ ok: false, error: SUSPENDED })
  })

  it('still refuses an empty payload before it asks about billing', async () => {
    // Order: nothing to record is not a billing problem, and saying it is would
    // send somebody to look at an invoice over an empty form.
    fixture.work = { allowed: false, error: SUSPENDED }

    const result = await recordVisitOutcomes('appointment-1', [])
    expect(result.error).toBe('Nothing to record.')
  })
})
