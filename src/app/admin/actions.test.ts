import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The lead pipeline's write paths, exercised as endpoints.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS LOOKS LIKE team/actions.test.ts AND NOT LIKE THE ENGINE TESTS
 * ---------------------------------------------------------------------------
 * `stage.ts` and `ics.ts` are pure and tested as such. What those tests cannot
 * reach is the part of this feature that is only true at the call site: that
 * provisioning is one transaction and a failure halfway leaves nothing behind,
 * that a lost lead cannot be recorded without a reason, and that a refused
 * action writes nothing at all. None of that is a property of an engine — it
 * is a property of the action, so the action is what is under test with its
 * collaborators replaced.
 *
 * The fake database is the assertion that matters. Writes inside a
 * transaction are staged and only land when the callback resolves, exactly as
 * Postgres would, so "the invitation failed and the organisation survived" is
 * a thing this test can catch.
 *
 * Nothing here touches a database. `.env.local` is production; a test that
 * needed a connection would be a test nobody could safely run.
 */

const fixture = vi.hoisted(() => ({
  ADMIN: '11111111-1111-1111-1111-111111111111',
  LEAD: '22222222-2222-2222-2222-222222222222',
  ORG: '33333333-3333-3333-3333-333333333333',
  STORE: '44444444-4444-4444-4444-444444444444',

  /** Rows the fake select hands back, keyed by table. Set per case. */
  rows: {} as Record<string, unknown[]>,
  /** Everything that actually committed. Staged writes that rolled back are absent. */
  writes: [] as { op: 'insert' | 'update'; table: string; values: Record<string, unknown> }[],
  transactions: 0,
  rollbacks: 0,
  /** Makes `createInvitationOn` throw, to prove the whole thing rolls back. */
  invitationFails: false,
}))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

vi.mock('@/lib/auth/session', () => ({
  requirePlatformAdmin: async () => ({
    id: fixture.ADMIN,
    email: 'dan@dealertech.io',
    name: 'Dan',
    isPlatformAdmin: true,
  }),
}))

/*
  The two halves of provisioning, replaced.

  Both are `server-only` and both are tested by the fact that this action hands
  them its transaction — what matters here is that they run inside it, and that
  one of them failing takes the rest with it.
*/
vi.mock('@/lib/invites/provision', () => ({
  createStoreOn: async () => ({ organizationId: fixture.ORG, storeId: fixture.STORE }),
}))

vi.mock('@/lib/invites/create', () => ({
  createInvitationOn: async () => {
    if (fixture.invitationFails) throw new Error('an invitation already exists for that address')
    return { token: 'tok-abc', email: 'ray@lonestar.test' }
  },
}))

// Stubbed because it is `server-only`, not because these cases reach it.
vi.mock('@/lib/demo-tour/store', () => ({
  issueTourCode: async () => ({ id: 'c1', code: 'ABCDEFGHJK', expiresAt: new Date() }),
  revokeTourCode: async () => true,
}))

vi.mock('@/db/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/client')>()

  /** The name of a schema table, for recording what was written where. */
  const nameOf = (table: unknown): string => {
    for (const [key, value] of Object.entries(actual.schema)) {
      if (value === table) return key
    }
    return 'unknown'
  }

  type Write = (typeof fixture.writes)[number]

  class Select {
    private table = ''
    from(t: unknown) { this.table = nameOf(t); return this }
    leftJoin() { return this }
    innerJoin() { return this }
    where() { return this }
    orderBy() { return this }
    groupBy() { return this }
    limit() { return this }
    then<T>(ok: (rows: unknown[]) => T, err?: (e: unknown) => T) {
      return Promise.resolve(fixture.rows[this.table] ?? []).then(ok, err)
    }
  }

  class Insert {
    constructor(private table: string, private sink: Write[]) {}
    async values(values: Record<string, unknown>) {
      this.sink.push({ op: 'insert', table: this.table, values })
      return []
    }
  }

  class Update {
    private values: Record<string, unknown> = {}
    constructor(private table: string, private sink: Write[]) {}
    set(values: Record<string, unknown>) { this.values = values; return this }
    where() { return this }
    then<T>(ok: (rows: unknown[]) => T, err?: (e: unknown) => T) {
      this.sink.push({ op: 'update', table: this.table, values: this.values })
      return Promise.resolve([]).then(ok, err)
    }
  }

  /**
   * A handle whose writes go to `sink`. Inside a transaction that is staging.
   *
   * The return type is spelled out because `transaction` hands a handle to its
   * callback, which makes the function recursive and leaves inference with
   * nothing to anchor on.
   */
  interface Handle {
    select: () => Select
    insert: (t: unknown) => Insert
    update: (t: unknown) => Update
    transaction: <T>(work: (tx: Handle) => Promise<T>) => Promise<T>
  }

  const handle = (sink: Write[]): Handle => ({
    select: () => new Select(),
    insert: (t: unknown) => new Insert(nameOf(t), sink),
    update: (t: unknown) => new Update(nameOf(t), sink),
    /*
      Commit on resolve, discard on throw.

      The whole point of the fake. Staged writes reach `fixture.writes` only if
      the callback returns, so an action that leaves an organisation standing
      after a later failure fails a test rather than a customer.
    */
    transaction: async <T>(work: (tx: Handle) => Promise<T>): Promise<T> => {
      fixture.transactions += 1
      const staged: Write[] = []
      try {
        const result = await work(handle(staged))
        fixture.writes.push(...staged)
        return result
      } catch (error) {
        fixture.rollbacks += 1
        throw error
      }
    },
  })

  return { ...actual, getDb: () => handle(fixture.writes) }
})

const {
  addLeadNote, bookWalkthrough, markLeadLost, markWalkthroughDone,
  provisionFromLead, walkthroughIcs,
} = await import('./actions')

/** A lead that exists, with nothing recorded against it. */
const PLAIN_LEAD = [{
  contacted: false,
  contactedAt: null,
  walkthroughAt: null,
  walkthroughDoneAt: null,
  lostAt: null,
  lostReason: null,
  dealershipName: 'Lone Star Ford',
  name: 'Ray Delgado',
  email: 'ray@lonestar.test',
  phone: '512-555-0101',
}]

function provisionForm(): FormData {
  const form = new FormData()
  form.set('leadId', fixture.LEAD)
  form.set('dealershipName', 'Lone Star Ford')
  form.set('adminEmail', 'ray@lonestar.test')
  form.set('laborRate', '185')
  return form
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [k, v] of Object.entries(fields)) data.set(k, v)
  return data
}

const written = (table: string) => fixture.writes.filter((w) => w.table === table)

beforeEach(() => {
  fixture.rows = { demoRequests: PLAIN_LEAD }
  fixture.writes = []
  fixture.transactions = 0
  fixture.rollbacks = 0
  fixture.invitationFails = false
})

describe('provisionFromLead is one transaction', () => {
  it('creates the tenant, marks the lead, and records both trails', async () => {
    const state = await provisionFromLead({}, provisionForm())

    expect(state.error).toBeUndefined()
    expect(state.link).toBe('/invite/tok-abc')
    // The way onward. Provisioning used to end at a link with the new tenant
    // reachable only by finding it in the list by name.
    expect(state.organizationId).toBe(fixture.ORG)

    expect(fixture.transactions).toBe(1)
    expect(written('demoRequests')[0]?.values.provisionedOrgId).toBe(fixture.ORG)
    expect(written('leadEvents')[0]?.values.kind).toBe('SYSTEM')
    expect(written('auditLog')[0]?.values.action).toBe('LEAD_PROVISIONED')
  })

  it('rolls everything back when the invitation fails', async () => {
    /*
      The bug this transaction was written for. The old version created the
      organisation and the store, then failed on the invitation, and reported
      "could not create the dealership" — which was false. The dealership was
      created, nobody was invited to it, and nothing on the console said so.
    */
    fixture.invitationFails = true

    const state = await provisionFromLead({}, provisionForm())

    expect(state.error).toContain('Could not create the dealership')
    expect(state.link).toBeUndefined()
    expect(fixture.rollbacks).toBe(1)
    // Not one write survived: no lead update, no timeline entry, no audit row.
    expect(fixture.writes).toEqual([])
  })

  it('keeps the original contact date rather than re-stamping it', async () => {
    // "Contacted 40 days ago" is the number that decides whether a lead went
    // cold, and provisioning resetting it would reset the clock at the finish.
    const first = new Date('2026-07-01T00:00:00.000Z')
    fixture.rows = { demoRequests: [{ ...PLAIN_LEAD[0], contactedAt: first }] }

    await provisionFromLead({}, provisionForm())
    expect(written('demoRequests')[0]?.values.contactedAt).toBe(first)
  })

  it('opens no transaction at all when the form is wrong', async () => {
    const bad = provisionForm()
    bad.set('laborRate', '0')

    const state = await provisionFromLead({}, bad)
    expect(state.error).toContain('door rate')
    expect(fixture.transactions).toBe(0)
    expect(fixture.writes).toEqual([])
  })

  it('refuses a brand the warranty engine has never heard of', async () => {
    const bad = provisionForm()
    bad.set('franchiseMake', 'DELOREAN')

    expect((await provisionFromLead({}, bad)).error).toContain('franchise brand')
    expect(fixture.transactions).toBe(0)
  })
})

describe('bookWalkthrough', () => {
  it('stores the instant the browser computed', async () => {
    const state = await bookWalkthrough({}, form({
      leadId: fixture.LEAD,
      walkthroughAt: '2026-08-25T19:00:00.000Z',
    }))

    expect(state.error).toBeUndefined()
    expect(written('demoRequests')[0]?.values.walkthroughAt)
      .toEqual(new Date('2026-08-25T19:00:00.000Z'))
    expect(written('auditLog')[0]?.values.action).toBe('LEAD_WALKTHROUGH_BOOKED')
  })

  it('clears the done stamp, so a rebooking is not finished and booked at once', async () => {
    fixture.rows = {
      demoRequests: [{
        ...PLAIN_LEAD[0],
        walkthroughAt: new Date('2026-08-01T15:00:00.000Z'),
        walkthroughDoneAt: new Date('2026-08-01T15:00:00.000Z'),
      }],
    }

    await bookWalkthrough({}, form({
      leadId: fixture.LEAD,
      walkthroughAt: '2026-09-01T15:00:00.000Z',
    }))

    expect(written('demoRequests')[0]?.values.walkthroughDoneAt).toBeNull()
  })

  it('records the move, which the overwritten column cannot', async () => {
    const was = new Date('2026-08-01T15:00:00.000Z')
    fixture.rows = { demoRequests: [{ ...PLAIN_LEAD[0], walkthroughAt: was }] }

    await bookWalkthrough({}, form({
      leadId: fixture.LEAD,
      walkthroughAt: '2026-09-01T15:00:00.000Z',
    }))

    expect(written('auditLog')[0]?.values.changes).toContain(was.toISOString())
    expect(String(written('leadEvents')[0]?.values.body)).toContain('moved to')
  })

  it('writes nothing when the datetime will not parse', async () => {
    const state = await bookWalkthrough({}, form({
      leadId: fixture.LEAD,
      walkthroughAt: 'next tuesday-ish',
    }))

    expect(state.error).toBe('Pick a date and a time.')
    expect(fixture.transactions).toBe(0)
    expect(fixture.writes).toEqual([])
  })

  it('rolls back when the lead has gone', async () => {
    fixture.rows = { demoRequests: [] }

    const state = await bookWalkthrough({}, form({
      leadId: fixture.LEAD,
      walkthroughAt: '2026-08-25T19:00:00.000Z',
    }))

    expect(state.error).toContain('no longer exists')
    expect(fixture.writes).toEqual([])
  })
})

describe('markWalkthroughDone', () => {
  it('refuses when nothing is booked, and writes nothing', async () => {
    // Nothing observes whether a call happened, so this button is the fact.
    // Allowing it on a lead with no booking would let a walkthrough be marked
    // held that was never in anybody's diary.
    const state = await markWalkthroughDone({}, form({ leadId: fixture.LEAD }))

    expect(state.error).toContain('Nothing is booked')
    expect(fixture.writes).toEqual([])
  })

  it('stamps it and writes the call, but no audit row', async () => {
    /*
      Deliberately unaudited. Nothing changed hands and no access was granted;
      the closed vocabulary is for the security record rather than for every
      click, and the timeline is where somebody would look for this.
    */
    fixture.rows = {
      demoRequests: [{ ...PLAIN_LEAD[0], walkthroughAt: new Date('2026-08-01T15:00:00.000Z') }],
    }

    const state = await markWalkthroughDone({}, form({
      leadId: fixture.LEAD, note: 'Went well, wants pricing.',
    }))

    expect(state.ok).toBe('Recorded.')
    expect(written('demoRequests')[0]?.values.walkthroughDoneAt).toBeInstanceOf(Date)
    expect(written('leadEvents')[0]?.values.body).toBe('Went well, wants pricing.')
    expect(written('auditLog')).toEqual([])
  })
})

describe('markLeadLost', () => {
  it('demands a reason, and writes nothing without one', async () => {
    const state = await markLeadLost({}, form({ leadId: fixture.LEAD }))

    expect(state.error).toContain('Say why')
    expect(fixture.transactions).toBe(0)
    expect(fixture.writes).toEqual([])
  })

  it('records the loss with its reason in both trails', async () => {
    const state = await markLeadLost({}, form({
      leadId: fixture.LEAD, reason: 'Signed with Xtime in July.',
    }))

    expect(state.ok).toBe('Recorded as lost.')
    expect(written('demoRequests')[0]?.values.lostReason).toBe('Signed with Xtime in July.')
    expect(written('auditLog')[0]?.values.action).toBe('LEAD_MARKED_LOST')
    expect(written('auditLog')[0]?.values.changes).toContain('"reopened":false')
  })

  it('reopens without demanding a reason', async () => {
    /*
      A flag that can only be set is one nobody trusts enough to use — the same
      argument that made uncontacting possible — and LOST is the one control
      here that hides a lead from every stage tab at once.
    */
    fixture.rows = {
      demoRequests: [{
        ...PLAIN_LEAD[0],
        lostAt: new Date('2026-08-01T00:00:00.000Z'),
        lostReason: 'Went quiet.',
      }],
    }

    const state = await markLeadLost({}, form({ leadId: fixture.LEAD, intent: 'reopen' }))

    expect(state.ok).toBe('Back in the pipeline.')
    expect(written('demoRequests')[0]?.values.lostAt).toBeNull()
    expect(written('demoRequests')[0]?.values.lostReason).toBeNull()
  })

  it('records the reopening under the same action, not a fifth verb', async () => {
    // Adding a verb to a closed vocabulary for the undo of another is how a
    // vocabulary stops being closed. The pair reads correctly in sequence.
    fixture.rows = {
      demoRequests: [{ ...PLAIN_LEAD[0], lostAt: new Date(), lostReason: 'Went quiet.' }],
    }

    await markLeadLost({}, form({ leadId: fixture.LEAD, intent: 'reopen' }))

    expect(written('auditLog')[0]?.values.action).toBe('LEAD_MARKED_LOST')
    expect(written('auditLog')[0]?.values.changes).toContain('"reopened":true')
  })

  it('keeps the original loss date when the reason is edited', async () => {
    const lostAt = new Date('2026-06-01T00:00:00.000Z')
    fixture.rows = { demoRequests: [{ ...PLAIN_LEAD[0], lostAt, lostReason: 'Went quiet.' }] }

    await markLeadLost({}, form({ leadId: fixture.LEAD, reason: 'Signed with Xtime.' }))
    expect(written('demoRequests')[0]?.values.lostAt).toBe(lostAt)
  })
})

describe('addLeadNote', () => {
  it('appends, and does not touch the audit log', async () => {
    const state = await addLeadNote({}, form({
      leadId: fixture.LEAD, body: 'They run CDK.', kind: 'NOTE',
    }))

    expect(state.ok).toBe('Note added.')
    expect(written('leadEvents')[0]?.values.body).toBe('They run CDK.')
    // Free text a person typed does not belong in the log that is never
    // deleted — it could never be corrected there.
    expect(written('auditLog')).toEqual([])
  })

  it('refuses an empty note', async () => {
    expect((await addLeadNote({}, form({ leadId: fixture.LEAD, body: '   ' }))).error)
      .toBe('Nothing to save.')
    expect(fixture.writes).toEqual([])
  })

  it('whitelists the kind rather than trusting the form', async () => {
    // The database checks it too (0035), and a value that only failed there
    // would surface as a constraint error rather than a usable sentence.
    await addLeadNote({}, form({ leadId: fixture.LEAD, body: 'x', kind: 'DROP TABLE' }))
    expect(written('leadEvents')[0]?.values.kind).toBe('NOTE')
  })

  it('keeps CALL when that is what was asked for', async () => {
    await addLeadNote({}, form({ leadId: fixture.LEAD, body: 'Rang them.', kind: 'CALL' }))
    expect(written('leadEvents')[0]?.values.kind).toBe('CALL')
  })
})

describe('walkthroughIcs', () => {
  it('refuses when nothing is booked', async () => {
    expect((await walkthroughIcs(fixture.LEAD)).error).toBe('Nothing is booked yet.')
  })

  it('refuses a lead that has gone', async () => {
    fixture.rows = { demoRequests: [] }
    expect((await walkthroughIcs(fixture.LEAD)).error).toContain('no longer exists')
  })

  it('builds a file named after the dealership', async () => {
    fixture.rows = {
      demoRequests: [{ ...PLAIN_LEAD[0], walkthroughAt: new Date('2026-08-25T19:00:00.000Z') }],
    }

    const result = await walkthroughIcs(fixture.LEAD)

    expect(result.filename).toBe('walkthrough-lone-star-ford.ics')
    expect(result.ics).toContain('DTSTART:20260825T190000Z')
    expect(result.ics).toContain('BEGIN:VEVENT')
    // Stable across rebookings, so an updated file replaces the diary entry.
    expect(result.ics).toContain(`UID:walkthrough-${fixture.LEAD}@dealertech.io`)
  })

  it('carries the contact details, and a path rather than a public URL', async () => {
    fixture.rows = {
      demoRequests: [{ ...PLAIN_LEAD[0], walkthroughAt: new Date('2026-08-25T19:00:00.000Z') }],
    }

    // Unfolded first: the description is long enough to wrap, and RFC 5545
    // folding puts a CRLF and a space in the middle of the URL. A test that
    // searched the raw file would be asserting the line width by accident.
    const unfolded = (result: string) => result.replace(/\r\n /g, '')
    const ics = unfolded((await walkthroughIcs(fixture.LEAD)).ics ?? '')

    expect(ics).toContain('ray@lonestar.test')
    // A path, not an origin: the file is for Dan's own calendar and the
    // console is not published.
    expect(ics).toContain(`/admin/leads/${fixture.LEAD}`)
    expect(ics).not.toContain('https://')
  })
})
