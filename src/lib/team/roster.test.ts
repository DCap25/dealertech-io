import { describe, expect, it } from 'vitest'
import {
  canChangeRole, canManageStaff, canRemove, canRestore, type RosterMember,
} from './roster'

const RAY = 'u-ray'
const MARCUS = 'u-marcus'
const DANA = 'u-dana'

const m = (userId: string, role: RosterMember['role'], isActive = true): RosterMember =>
  ({ userId, role, isActive })

/** One manager, two advisors — the shape of most service drives. */
const store = (): RosterMember[] => [
  m(RAY, 'SERVICE_MANAGER'),
  m(MARCUS, 'ADVISOR'),
  m(DANA, 'ADVISOR'),
]

describe('canManageStaff', () => {
  it('is the manager-ish roles and nobody else', () => {
    expect(canManageStaff('SERVICE_MANAGER')).toBe(true)
    expect(canManageStaff('FIXED_OPS_DIRECTOR')).toBe(true)
    expect(canManageStaff('ADMIN')).toBe(true)
    expect(canManageStaff('ADVISOR')).toBe(false)
    expect(canManageStaff('BDC')).toBe(false)
    expect(canManageStaff('TECHNICIAN')).toBe(false)
  })
})

describe('canRemove', () => {
  it('lets a manager remove an advisor', () => {
    expect(canRemove(store(), RAY, MARCUS).ok).toBe(true)
  })

  it('refuses an advisor trying to remove anybody, including themselves', () => {
    expect(canRemove(store(), MARCUS, DANA).ok).toBe(false)
    expect(canRemove(store(), MARCUS, MARCUS).ok).toBe(false)
  })

  it('refuses to remove the last person who can manage staff', () => {
    // The dealership would be locked out of its own roster, and the only way
    // back is us reaching into the database.
    const result = canRemove(store(), RAY, RAY)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/only person/i)
  })

  it('lets a manager remove themselves once somebody else can manage', () => {
    // A manager moving to another rooftop should not need to ask us to tidy
    // up behind them.
    const roster = [...store(), m('u-second', 'SERVICE_MANAGER')]
    expect(canRemove(roster, RAY, RAY).ok).toBe(true)
  })

  it('does not count someone already removed as cover', () => {
    // An inactive manager cannot invite anybody, so they are not a reason to
    // let the last active one go.
    const roster = [...store(), m('u-gone', 'SERVICE_MANAGER', false)]
    expect(canRemove(roster, RAY, RAY).ok).toBe(false)
  })

  it('refuses somebody who is not on this roster', () => {
    // The id arrives in a form post. A manager at one store must not be able
    // to remove staff at another by pasting a uuid.
    expect(canRemove(store(), RAY, 'u-stranger').ok).toBe(false)
  })

  it('counts a fixed ops director as cover', () => {
    // In a group this is often the only manager-ish account at a rooftop.
    const roster = [m(RAY, 'SERVICE_MANAGER'), m('u-fod', 'FIXED_OPS_DIRECTOR')]
    expect(canRemove(roster, RAY, RAY).ok).toBe(true)
  })
})

describe('canChangeRole', () => {
  it('promotes an advisor to manager', () => {
    expect(canChangeRole(store(), RAY, MARCUS, 'SERVICE_MANAGER').ok).toBe(true)
  })

  it('refuses to demote the last manager', () => {
    // The same lockout as removal, and easier to do by accident.
    const result = canChangeRole(store(), RAY, RAY, 'ADVISOR')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/stepping down|only person/i)
  })

  it('lets the last manager step down once somebody else is promoted', () => {
    const roster = [...store(), m('u-second', 'SERVICE_MANAGER')]
    expect(canChangeRole(roster, RAY, RAY, 'ADVISOR').ok).toBe(true)
  })

  it('lets a manager move between manager-ish roles even when alone', () => {
    // SERVICE_MANAGER to ADMIN loses nothing — somebody can still work the
    // roster afterwards, so the guard must not fire.
    expect(canChangeRole(store(), RAY, RAY, 'ADMIN').ok).toBe(true)
  })

  it('refuses a no-op', () => {
    expect(canChangeRole(store(), RAY, MARCUS, 'ADVISOR').ok).toBe(false)
  })

  it('refuses an advisor changing anybody', () => {
    expect(canChangeRole(store(), MARCUS, DANA, 'SERVICE_MANAGER').ok).toBe(false)
  })
})

describe('canRestore', () => {
  it('brings back somebody who was removed', () => {
    const roster = [...store(), m('u-back', 'ADVISOR', false)]
    expect(canRestore(roster, RAY, 'u-back').ok).toBe(true)
  })

  it('refuses somebody who is already active', () => {
    expect(canRestore(store(), RAY, MARCUS).ok).toBe(false)
  })

  it('refuses an advisor doing the restoring', () => {
    const roster = [...store(), m('u-back', 'ADVISOR', false)]
    expect(canRestore(roster, MARCUS, 'u-back').ok).toBe(false)
  })
})
