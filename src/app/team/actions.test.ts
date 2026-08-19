import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The roster guards, exercised as endpoints rather than as engines.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS TEST LOOKS DIFFERENT TO EVERY OTHER ONE IN THE REPO
 * ---------------------------------------------------------------------------
 * Everything else here tests a pure function, because everything that decides
 * something is pure. This does not, and it is deliberate: the bug being pinned
 * down was never in `resolveAccess`. That engine already said MANAGE_STAFF was
 * blocked at RESTRICTED and SUSPENDED, and `billing.test.ts` already proved it.
 * What was missing was anybody asking. `removeStaff` and `changeRole` wrote to
 * the roster of a suspended dealership because no call site consulted the
 * ladder, and no amount of testing the ladder would have caught that.
 *
 * So the seam under test is the action itself, with its collaborators replaced.
 * `checkAccess` is a fake that answers whatever the case needs, and the scoped
 * database is a fake that hands back a roster and never runs a callback — which
 * is also the assertion that matters. A blocked action opens exactly one scoped
 * block (the roster read that precedes the verdict) and never reaches the write.
 *
 * Nothing here touches a database. `.env.local` is production; a test that
 * needed a connection would be a test nobody could safely run.
 */

const fixture = vi.hoisted(() => ({
  ACTOR: '11111111-1111-1111-1111-111111111111',
  TARGET: '22222222-2222-2222-2222-222222222222',
  STORE: '33333333-3333-3333-3333-333333333333',
  /** What the fake `checkAccess` answers. Set per case. */
  access: { allowed: true } as { allowed: true } | { allowed: false; error: string },
  /** How many scoped blocks the action opened. The write is always the last. */
  scopes: 0,
  /** What the faked roster read hands back. Reset per case. */
  roster: [] as { userId: string; role: string; isActive: boolean }[],
}))

/** A manager and somebody to act on, both present and both active. */
const ROSTER = [
  { userId: fixture.ACTOR, role: 'ADMIN', isActive: true },
  { userId: fixture.TARGET, role: 'ADVISOR', isActive: true },
]

/** The same store with the advisor already taken off, for the restore cases. */
const ROSTER_WITH_LEAVER = [
  { userId: fixture.ACTOR, role: 'ADMIN', isActive: true },
  { userId: fixture.TARGET, role: 'ADVISOR', isActive: false },
]

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

vi.mock('@/lib/auth/session', () => ({
  requireUser: async () => ({
    id: fixture.ACTOR,
    email: 'manager@lonestar.test',
    name: 'A Manager',
    storeId: fixture.STORE,
    storeName: 'Lone Star Ford',
    role: 'ADMIN',
    isAdvisor: false,
    memberships: [],
    isPlatformAdmin: false,
  }),
  checkAccess: async () => fixture.access,
}))

vi.mock('@/db/scoped', () => ({
  /*
    Counts the block and returns the roster.

    The callback is never invoked, so no query is ever built and no write can
    escape. Every read in these actions is the roster read, and the write blocks
    are what we are asserting do not happen.
  */
  withCurrentUserScope: async () => {
    fixture.scopes += 1
    return fixture.roster
  },
}))

// Stubbed because both pull in `server-only`, which refuses to load outside a
// server component graph — not because either does anything these cases reach.
vi.mock('@/lib/audit/record', () => ({ recordAudit: async () => {} }))
vi.mock('@/lib/invites/create', () => ({ createInvitation: async () => ({ token: 'x' }) }))

const { changeRole, removeStaff, restoreStaff } = await import('./actions')

const SUSPENDED = 'This account is suspended. Contact DealerTech to restore access.'

function removalForm(): FormData {
  const form = new FormData()
  form.set('userId', fixture.TARGET)
  return form
}

function roleForm(): FormData {
  const form = new FormData()
  form.set('userId', fixture.TARGET)
  form.set('role', 'TECHNICIAN')
  return form
}

beforeEach(() => {
  fixture.access = { allowed: true }
  fixture.scopes = 0
  fixture.roster = ROSTER
})

describe('removeStaff is gated on MANAGE_STAFF', () => {
  it('refuses, and writes nothing, when the ladder blocks it', async () => {
    fixture.access = { allowed: false, error: SUSPENDED }

    const state = await removeStaff({}, removalForm())
    expect(state.error).toBe(SUSPENDED)
    expect(state.ok).toBeUndefined()
    // One block: the roster read before the verdict. The write never opened.
    expect(fixture.scopes).toBe(1)
  })

  it('goes through for a dealership in good standing', async () => {
    const state = await removeStaff({}, removalForm())

    expect(state.error).toBeUndefined()
    expect(state.ok).toContain('Removed')
    expect(fixture.scopes).toBe(2)
  })

  it('reports the roster verdict rather than the billing one', async () => {
    // Order matters for the sentence somebody reads. Being told to chase an
    // invoice for a change they were never allowed to make points them at the
    // wrong problem entirely.
    fixture.access = { allowed: false, error: SUSPENDED }
    const form = new FormData()
    form.set('userId', 'somebody-who-does-not-work-here')

    const state = await removeStaff({}, form)
    expect(state.error).not.toBe(SUSPENDED)
    expect(state.error).toContain('roster')
  })
})

describe('changeRole is gated on MANAGE_STAFF', () => {
  it('refuses, and writes nothing, when the ladder blocks it', async () => {
    fixture.access = { allowed: false, error: SUSPENDED }

    const state = await changeRole({}, roleForm())
    expect(state.error).toBe(SUSPENDED)
    expect(state.ok).toBeUndefined()
    expect(fixture.scopes).toBe(1)
  })

  it('goes through for a dealership in good standing', async () => {
    const state = await changeRole({}, roleForm())

    expect(state.error).toBeUndefined()
    expect(state.ok).toBe('Role updated.')
  })

  it('cannot be used to promote somebody while suspended', async () => {
    // The hole this guard closes. Blocking removal and leaving this open would
    // let a suspended dealership make an existing account an ADMIN, which is
    // inviting an administrator by another route.
    fixture.access = { allowed: false, error: SUSPENDED }
    const form = new FormData()
    form.set('userId', fixture.TARGET)
    form.set('role', 'ADMIN')

    const state = await changeRole({}, form)
    expect(state.error).toBe(SUSPENDED)
  })
})

describe('restoreStaff is gated on MANAGE_STAFF', () => {
  function restoreForm(): FormData {
    const form = new FormData()
    form.set('userId', fixture.TARGET)
    return form
  }

  it('refuses, and writes nothing, when the ladder blocks it', async () => {
    /*
      Restoring is inviting with the invitation already served.

      This one was missed when removal and role changes were guarded, and it is
      the bypass that made the other two decorative: a dealership blocked from
      INVITE_STAFF and MANAGE_STAFF could still put every person who had ever
      worked there back on the roster, one at a time.
    */
    fixture.roster = ROSTER_WITH_LEAVER
    fixture.access = { allowed: false, error: SUSPENDED }

    const state = await restoreStaff({}, restoreForm())
    expect(state.error).toBe(SUSPENDED)
    expect(state.ok).toBeUndefined()
    expect(fixture.scopes).toBe(1)
  })

  it('goes through for a dealership in good standing', async () => {
    fixture.roster = ROSTER_WITH_LEAVER

    const state = await restoreStaff({}, restoreForm())
    expect(state.error).toBeUndefined()
    expect(state.ok).toBe('Back on the roster.')
    expect(fixture.scopes).toBe(2)
  })

  it('reports the roster verdict rather than the billing one', async () => {
    // Somebody who is already active cannot be restored, and that is the
    // sentence they should read — not one about an invoice.
    fixture.access = { allowed: false, error: SUSPENDED }

    const state = await restoreStaff({}, restoreForm())
    expect(state.error).not.toBe(SUSPENDED)
    expect(state.error).toContain('already on the roster')
  })
})

