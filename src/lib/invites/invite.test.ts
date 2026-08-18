import { describe, expect, it } from 'vitest'
import {
  createInviteToken, hashInviteToken, hashesMatch, inviteExpiryFrom, inviteStatus,
  inviteStatusMessage, isInvitableRole, normaliseEmail, type InviteRecord,
} from './invite'

const NOW = new Date('2026-08-14T12:00:00Z')

const record = (over: Partial<InviteRecord> = {}): InviteRecord => ({
  expiresAt: new Date('2026-08-21T12:00:00Z'),
  acceptedAt: null,
  revokedAt: null,
  ...over,
})

describe('createInviteToken', () => {
  it('never returns the same token twice', () => {
    const seen = new Set(Array.from({ length: 200 }, () => createInviteToken().token))
    expect(seen.size).toBe(200)
  })

  it('produces a token safe to paste into a URL', () => {
    // Base64url. A token that gets mangled by an email client that linkifies
    // things is an invitation nobody can accept.
    for (let i = 0; i < 50; i++) {
      expect(createInviteToken().token).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })

  it('returns the hash of the token it just made', () => {
    const { token, tokenHash } = createInviteToken()
    expect(tokenHash).toBe(hashInviteToken(token))
  })

  it('does not put the token itself in the hash', () => {
    // The point of the whole design: a database dump must not contain anything
    // that can be turned back into a working link.
    const { token, tokenHash } = createInviteToken()
    expect(tokenHash).not.toContain(token)
    expect(tokenHash).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe('hashesMatch', () => {
  it('matches a hash with itself and nothing else', () => {
    const a = hashInviteToken('one')
    expect(hashesMatch(a, hashInviteToken('one'))).toBe(true)
    expect(hashesMatch(a, hashInviteToken('two'))).toBe(false)
  })

  it('is false rather than throwing on mismatched lengths', () => {
    // timingSafeEqual throws when the buffers differ in size, which would turn
    // a malformed token into a 500 instead of a polite refusal.
    expect(hashesMatch(hashInviteToken('one'), 'short')).toBe(false)
    expect(hashesMatch('', 'x')).toBe(false)
  })
})

describe('inviteStatus', () => {
  it('is valid before anything has happened to it', () => {
    expect(inviteStatus(record(), NOW)).toBe('VALID')
  })

  it('expires the moment it reaches its expiry', () => {
    expect(inviteStatus(record({ expiresAt: NOW }), NOW)).toBe('EXPIRED')
    expect(inviteStatus(record({ expiresAt: new Date('2026-08-14T11:59:59Z') }), NOW)).toBe('EXPIRED')
  })

  it('is accepted once it has been used', () => {
    expect(inviteStatus(record({ acceptedAt: NOW }), NOW)).toBe('ACCEPTED')
  })

  it('reports a withdrawn invitation as revoked, whatever else is true', () => {
    // A manager who revokes an invitation has made a decision. It must not be
    // reported as merely "expired" or, worse, still usable.
    expect(inviteStatus(record({ revokedAt: NOW }), NOW)).toBe('REVOKED')
    expect(inviteStatus(record({ revokedAt: NOW, acceptedAt: NOW }), NOW)).toBe('REVOKED')
    expect(
      inviteStatus(record({ revokedAt: NOW, expiresAt: new Date('2020-01-01') }), NOW),
    ).toBe('REVOKED')
  })

  it('cannot be re-used by moving the clock back', () => {
    const used = record({ acceptedAt: new Date('2026-08-15T00:00:00Z') })
    expect(inviteStatus(used, NOW)).toBe('ACCEPTED')
  })
})

describe('inviteStatusMessage', () => {
  it('tells the recipient what to do next, not just what went wrong', () => {
    for (const status of ['REVOKED', 'EXPIRED', 'ACCEPTED'] as const) {
      expect(inviteStatusMessage(status)).toMatch(/sign in|new one/i)
    }
  })
})

describe('inviteExpiryFrom', () => {
  it('is seven days out and does not mutate its input', () => {
    const now = new Date('2026-08-14T12:00:00Z')
    const expiry = inviteExpiryFrom(now)
    expect(expiry.getTime()).toBeGreaterThan(now.getTime())
    expect(now.toISOString()).toBe('2026-08-14T12:00:00.000Z')
    expect(Math.round((expiry.getTime() - now.getTime()) / 86_400_000)).toBe(7)
  })
})

describe('isInvitableRole', () => {
  it('accepts the roles a dealership can hand out', () => {
    expect(isInvitableRole('ADVISOR')).toBe(true)
    expect(isInvitableRole('SERVICE_MANAGER')).toBe(true)
    // The sales floor, so a manager can hand out a delivery-introduction
    // login from the roster screen without anybody touching the database.
    expect(isInvitableRole('SALES')).toBe(true)
  })

  it('refuses anything else', () => {
    // The role arrives in a form post. Accepting an arbitrary string here is
    // how somebody invites themselves as something the enum never had.
    expect(isInvitableRole('OWNER')).toBe(false)
    expect(isInvitableRole('admin')).toBe(false)
    expect(isInvitableRole('')).toBe(false)
  })
})

describe('normaliseEmail', () => {
  it('folds case and trims, so a forwarded link cannot be redeemed on a technicality', () => {
    expect(normaliseEmail('  Marcus@LoneStarFord.test ')).toBe('marcus@lonestarford.test')
  })
})
