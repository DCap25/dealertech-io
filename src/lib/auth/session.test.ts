import { describe, expect, it } from 'vitest'
import { resolveActiveStore, type StoreMembership } from './active-store'

const LONE_STAR: StoreMembership = {
  storeId: '11111111-1111-1111-1111-111111111111',
  storeName: 'Lone Star Ford',
  role: 'ADVISOR',
}
const HILL_COUNTRY: StoreMembership = {
  storeId: '22222222-2222-2222-2222-222222222222',
  storeName: 'Hill Country BMW',
  role: 'SERVICE_MANAGER',
}
/** A dealership this user has no role at. */
const SOMEONE_ELSE = '99999999-9999-9999-9999-999999999999'

describe('resolveActiveStore', () => {
  it('honours a cookie naming a rooftop they actually work', () => {
    expect(resolveActiveStore([LONE_STAR, HILL_COUNTRY], HILL_COUNTRY.storeId))
      .toEqual(HILL_COUNTRY)
  })

  it('ignores a cookie naming a dealership they have no role at', () => {
    // The whole boundary. The cookie is attacker-controlled, so it may only
    // pick from the membership list — never look a store up.
    expect(resolveActiveStore([LONE_STAR], SOMEONE_ELSE)).toEqual(LONE_STAR)
    expect(resolveActiveStore([LONE_STAR, HILL_COUNTRY], SOMEONE_ELSE)).toEqual(LONE_STAR)
  })

  it('falls back to their first rooftop with no cookie at all', () => {
    expect(resolveActiveStore([LONE_STAR, HILL_COUNTRY], undefined)).toEqual(LONE_STAR)
    expect(resolveActiveStore([LONE_STAR, HILL_COUNTRY], '')).toEqual(LONE_STAR)
  })

  it('is not fooled by junk in the cookie', () => {
    for (const junk of ['null', 'undefined', '*', "' OR 1=1 --", '../../etc/passwd']) {
      expect(resolveActiveStore([LONE_STAR], junk), junk).toEqual(LONE_STAR)
    }
  })

  it('carries the role held at the active store, not at another one', () => {
    // A person can advise at one rooftop and manage another. Reading the role
    // from the wrong membership would show a manager's department view to
    // someone who is only an advisor there.
    expect(resolveActiveStore([LONE_STAR, HILL_COUNTRY], HILL_COUNTRY.storeId)?.role)
      .toBe('SERVICE_MANAGER')
    expect(resolveActiveStore([LONE_STAR, HILL_COUNTRY], LONE_STAR.storeId)?.role)
      .toBe('ADVISOR')
  })

  it('is null for someone with no memberships', () => {
    // Authenticated but not staff anywhere — an invited user before anyone
    // granted them a role. Treated as signed out rather than defaulted in.
    expect(resolveActiveStore([], undefined)).toBeNull()
    expect(resolveActiveStore([], LONE_STAR.storeId)).toBeNull()
  })
})
