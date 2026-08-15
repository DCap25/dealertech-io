import { describe, expect, it } from 'vitest'
import { callerKey, FixedWindowLimiter } from './window'

const RULE = { limit: 3, windowMs: 60_000 }

describe('FixedWindowLimiter', () => {
  it('allows up to the limit and refuses after it', () => {
    const limiter = new FixedWindowLimiter(RULE)
    expect(limiter.check('a', 0).ok).toBe(true)
    expect(limiter.check('a', 0).ok).toBe(true)
    expect(limiter.check('a', 0).ok).toBe(true)
    expect(limiter.check('a', 0).ok).toBe(false)
  })

  it('counts each key separately', () => {
    // One person failing to sign in must not lock out the next.
    const limiter = new FixedWindowLimiter(RULE)
    for (let i = 0; i < 5; i++) limiter.check('a', 0)
    expect(limiter.check('b', 0).ok).toBe(true)
  })

  it('lets the window expire', () => {
    const limiter = new FixedWindowLimiter(RULE)
    for (let i = 0; i < 4; i++) limiter.check('a', 0)
    expect(limiter.check('a', 0).ok).toBe(false)
    expect(limiter.check('a', 60_001).ok).toBe(true)
  })

  it('reports what is left and when it resets', () => {
    const limiter = new FixedWindowLimiter(RULE)
    const first = limiter.check('a', 1_000)
    expect(first.remaining).toBe(2)
    expect(first.resetAt).toBe(61_000)
    expect(first.retryAfterSeconds).toBe(60)
  })

  it('never reports a retry-after below one second', () => {
    // Zero would invite an immediate retry, which is the opposite of the point.
    const limiter = new FixedWindowLimiter(RULE)
    const r = limiter.check('a', 59_999.9)
    expect(r.retryAfterSeconds).toBeGreaterThanOrEqual(1)
  })

  it('forgets a key on success', () => {
    // A correct password should clear the count, so somebody who mistyped
    // twice is not one slip away from being locked out of their own drive.
    const limiter = new FixedWindowLimiter(RULE)
    limiter.check('a', 0)
    limiter.check('a', 0)
    limiter.reset('a')
    expect(limiter.check('a', 0).remaining).toBe(2)
  })

  it('does not grow without bound on varied keys', () => {
    /*
      Every key here is attacker-supplied — an email address or a forwarded IP.
      Without the sweep, varying it is a way to exhaust an instance's memory,
      which would turn the defence into the vulnerability it was added to
      prevent.
    */
    const limiter = new FixedWindowLimiter(RULE)
    for (let i = 0; i < 1_500; i++) limiter.check(`key-${i}`, 0)
    expect(limiter.size).toBeGreaterThan(1_000)

    // A later call past the window sweeps the expired ones out.
    limiter.check('trigger', 120_000)
    expect(limiter.size).toBeLessThan(10)
  })
})

describe('callerKey', () => {
  it('prefers the header the host actually sets', () => {
    const h = new Headers({
      'x-nf-client-connection-ip': '203.0.113.9',
      'x-forwarded-for': '198.51.100.1, 10.0.0.1',
    })
    expect(callerKey(h)).toBe('203.0.113.9')
  })

  it('takes the first hop from a forwarded chain', () => {
    const h = new Headers({ 'x-forwarded-for': '198.51.100.1, 10.0.0.1' })
    expect(callerKey(h)).toBe('198.51.100.1')
  })

  it('falls back rather than returning nothing', () => {
    // An empty key would put every anonymous caller in one bucket and lock
    // them out collectively, which is worse than not limiting them.
    expect(callerKey(new Headers())).toBe('unknown')
    expect(callerKey(new Headers(), 'anon')).toBe('anon')
  })
})
