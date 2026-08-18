import { describe, expect, it } from 'vitest'
import {
  LINK_TTL_HOURS, createLinkToken, hashLinkToken, isUsableAuthorisationName,
  linkExpiryFrom, linkStatus, linkStatusMessage, linkStatusTitle, refusalFromStatus,
  type LinkRecord,
} from './link'

const NOW = new Date('2026-08-15T12:00:00Z')

const record = (over: Partial<LinkRecord> = {}): LinkRecord => ({
  expiresAt: new Date('2026-08-16T00:00:00Z'),
  endedAt: null,
  authorizedAt: null,
  ...over,
})

describe('createLinkToken', () => {
  it('never repeats', () => {
    const seen = new Set(Array.from({ length: 200 }, () => createLinkToken().token))
    expect(seen.size).toBe(200)
  })

  it('survives being sent in a text message', () => {
    // A token mangled by an email client that linkifies things is a menu
    // nobody can answer.
    for (let i = 0; i < 50; i++) {
      expect(createLinkToken().token).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })

  it('stores a hash that cannot be turned back into the link', () => {
    // Whoever opens the link sees a named person, their vehicle and their
    // prices. A dump of the table must show nobody anything.
    const { token, tokenHash } = createLinkToken()
    expect(tokenHash).toBe(hashLinkToken(token))
    expect(tokenHash).not.toContain(token)
    expect(tokenHash).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe('linkExpiryFrom', () => {
  it('is twelve hours out and does not mutate its input', () => {
    const expiry = linkExpiryFrom(NOW)
    expect((expiry.getTime() - NOW.getTime()) / 3_600_000).toBe(LINK_TTL_HOURS)
    expect(NOW.toISOString()).toBe('2026-08-15T12:00:00.000Z')
  })
})

describe('linkStatus', () => {
  it('is open before anything has happened', () => {
    expect(linkStatus(record(), NOW)).toBe('OPEN')
  })

  it('expires on the hour it says', () => {
    expect(linkStatus(record({ expiresAt: NOW }), NOW)).toBe('EXPIRED')
  })

  it('closes when the advisor closes it', () => {
    expect(linkStatus(record({ endedAt: NOW }), NOW)).toBe('ENDED')
  })

  it('shows an authorised customer what they chose rather than an error', () => {
    // Coming back to a link you already used is not a failure. The record is
    // theirs as much as ours, and an error page reads like being shut out.
    expect(linkStatus(record({ authorizedAt: NOW }), NOW)).toBe('AUTHORIZED')
    expect(linkStatus(record({ authorizedAt: NOW, endedAt: NOW }), NOW)).toBe('AUTHORIZED')
    expect(
      linkStatus(record({ authorizedAt: NOW, expiresAt: new Date('2020-01-01') }), NOW),
    ).toBe('AUTHORIZED')
  })

  it('treats a link with no expiry as open', () => {
    expect(linkStatus(record({ expiresAt: null }), NOW)).toBe('OPEN')
  })
})

describe('refusalFromStatus', () => {
  it('says nothing went wrong when the link is open', () => {
    expect(refusalFromStatus('OPEN')).toBeNull()
  })

  it('names every way a write can be turned away', () => {
    // The whole of F9 was a write being refused and nobody asking why. Each of
    // these has to arrive as something the screen can put into a sentence.
    expect(refusalFromStatus('EXPIRED')).toBe('EXPIRED')
    expect(refusalFromStatus('ENDED')).toBe('ENDED')
    expect(refusalFromStatus('AUTHORIZED')).toBe('AUTHORIZED')
  })

  it('treats a token that no longer resolves as a refusal, not a success', () => {
    // Null is the one outcome that is not a `LinkStatus`. Reading it as "fine"
    // is precisely the silence being fixed.
    expect(refusalFromStatus(null)).toBe('UNKNOWN')
  })
})

describe('linkStatusTitle', () => {
  it('heads every refusal, including the ones only a live menu can hit', () => {
    expect(linkStatusTitle('EXPIRED')).toBe('This link has expired')
    expect(linkStatusTitle('ENDED')).toBe('This list is closed')
    expect(linkStatusTitle('AUTHORIZED')).toMatch(/sent to your advisor/i)
    expect(linkStatusTitle('UNKNOWN')).toMatch(/no longer valid/i)
  })
})

describe('linkStatusMessage', () => {
  it('never leaves the customer at a dead end', () => {
    // Every one of these has to say what happens next. "This link is invalid"
    // to somebody trying to approve six hundred pounds of work is how a
    // dealership loses the sale and the trust in one screen.
    expect(linkStatusMessage('EXPIRED')).toMatch(/send a new one/i)
    expect(linkStatusMessage('ENDED')).toMatch(/call/i)
    expect(linkStatusMessage('AUTHORIZED')).toMatch(/what you chose/i)
  })

  it('reassures rather than blames when a link runs out', () => {
    expect(linkStatusMessage('EXPIRED')).toMatch(/nothing you chose has been lost/i)
  })

  it('tells somebody whose token stopped resolving what to do next', () => {
    expect(linkStatusMessage('UNKNOWN')).toMatch(/call your service advisor/i)
  })
})

describe('isUsableAuthorisationName', () => {
  it('accepts what a real person types on a phone', () => {
    expect(isUsableAuthorisationName('Bec')).toBe(true)
    expect(isUsableAuthorisationName('  Rebecca Cho  ')).toBe(true)
  })

  it('refuses an empty confirmation', () => {
    expect(isUsableAuthorisationName('')).toBe(false)
    expect(isUsableAuthorisationName('   ')).toBe(false)
    expect(isUsableAuthorisationName('R')).toBe(false)
  })
})
