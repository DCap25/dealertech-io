import { describe, expect, it } from 'vitest'
import {
  AUDIT_ACTIONS, buildAuditRow, MAX_CHANGES_CHARS, sanitiseChanges,
} from './events'

const BASE = {
  entityType: 'repair_orders',
  entityId: '11111111-1111-1111-1111-111111111111',
  storeId: '22222222-2222-2222-2222-222222222222',
  userId: '33333333-3333-3333-3333-333333333333',
} as const

describe('sanitiseChanges', () => {
  /*
    These are the tests that earn this file. The audit log is append-only and
    permanent by design — 0020 removed the UPDATE and DELETE that had crept in
    — so anything written here is written for good. A bearer token that lands
    in it stays valid and readable for as long as the log does, and there is no
    supported way to take it back out.
  */
  it('redacts anything that looks like a credential', () => {
    const out = sanitiseChanges({
      token: 'J2wwmzr0HwYtP6lGL8gssSdFWq1ihxde',
      tokenHash: 'abc123',
      password: 'hunter2',
      apiKey: 'sk-live-xxxx',
      email: 'advisor@dealership.test',
    }) as Record<string, unknown>

    expect(out.token).toBe('[redacted]')
    expect(out.tokenHash).toBe('[redacted]')
    expect(out.password).toBe('[redacted]')
    expect(out.apiKey).toBe('[redacted]')
    // Not a credential, and the whole point of a STAFF_INVITED entry.
    expect(out.email).toBe('advisor@dealership.test')
  })

  it('does not care how the key is spelled', () => {
    // access_token, accessToken and ACCESS-TOKEN are the same mistake.
    const out = sanitiseChanges({
      access_token: 'a', accessToken: 'b', 'ACCESS-TOKEN': 'c',
    }) as Record<string, unknown>
    expect(Object.values(out)).toEqual(['[redacted]', '[redacted]', '[redacted]'])
  })

  it('reaches nested objects and arrays', () => {
    const out = sanitiseChanges({
      invitations: [{ email: 'a@b.test', token: 'secret' }],
      nested: { deeper: { password: 'secret' } },
    }) as { invitations: { token: string; email: string }[]; nested: { deeper: { password: string } } }

    expect(out.invitations[0]!.token).toBe('[redacted]')
    expect(out.invitations[0]!.email).toBe('a@b.test')
    expect(out.nested.deeper.password).toBe('[redacted]')
  })

  it('redacts rather than drops', () => {
    // A key that was present and removed is itself worth knowing about; a
    // silent omission reads exactly like a field that was never set.
    const out = sanitiseChanges({ token: 'x' }) as Record<string, unknown>
    expect(Object.keys(out)).toContain('token')
  })

  it('refuses to recurse forever', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => sanitiseChanges(cyclic)).not.toThrow()
  })

  it('leaves primitives alone', () => {
    expect(sanitiseChanges(42)).toBe(42)
    expect(sanitiseChanges(null)).toBe(null)
    expect(sanitiseChanges('plain')).toBe('plain')
  })
})

describe('buildAuditRow', () => {
  it('serialises changes as JSON', () => {
    const row = buildAuditRow({
      ...BASE, action: 'REPAIR_ORDER_CLOSED', changes: { roNumber: '48408', customerPay: '3013.00' },
    })
    expect(JSON.parse(row!.changes!)).toEqual({ roNumber: '48408', customerPay: '3013.00' })
  })

  it('leaves changes null when there is nothing to say', () => {
    expect(buildAuditRow({ ...BASE, action: 'STAFF_REMOVED' })!.changes).toBeNull()
    expect(buildAuditRow({ ...BASE, action: 'STAFF_REMOVED', changes: {} })!.changes).toBeNull()
  })

  it('caps a runaway payload instead of writing it', () => {
    // One row must not be able to bloat a table nothing ever deletes from.
    const row = buildAuditRow({
      ...BASE, action: 'DMS_HANDOFF_PUSHED', changes: { blob: 'x'.repeat(50_000) },
    })
    expect(row!.changes!.length).toBeLessThan(MAX_CHANGES_CHARS + 40)
    expect(row!.changes).toMatch(/…\[truncated\]$/)
  })

  it('redacts on the way through, not only when asked', () => {
    const row = buildAuditRow({
      ...BASE, action: 'STAFF_INVITED', changes: { email: 'a@b.test', token: 'live-token' },
    })
    expect(row!.changes).not.toContain('live-token')
    expect(row!.changes).toContain('a@b.test')
  })

  it('returns null for an action outside the vocabulary', () => {
    /*
      Null rather than a throw, on purpose. This runs inside the transaction
      doing the real work, so a helper that could abort a repair order because
      somebody mistyped a constant would be a worse problem than the gap it
      leaves in the log.
    */
    const row = buildAuditRow({
      ...BASE, action: 'INVENTED_ACTION' as never,
    })
    expect(row).toBeNull()
  })

  it('keeps a null user, because not every event has one', () => {
    // A customer authorising a menu on their phone has no account. Attributing
    // it to the advisor who sent the link would be a false statement in the one
    // record that exists to prevent them.
    const row = buildAuditRow({
      ...BASE, action: 'MENU_AUTHORISED', userId: null, changes: { authorizedName: 'Karen Sanchez' },
    })
    expect(row!.userId).toBeNull()
    expect(row!.changes).toContain('Karen Sanchez')
  })

  it('has no duplicate actions in the vocabulary', () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length)
  })
})
