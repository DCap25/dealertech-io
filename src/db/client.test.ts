import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The connection string is checked before anything touches it, because Node's
 * URL parser puts the string it could not parse into the error — and
 * postgres.js lets that propagate. One mistyped value wrote a live database
 * password into a hosting provider's function log.
 *
 * These assert the message names the problem and never quotes the value.
 */

const PASSWORD = 'sup3r-s3cret-pw'

async function getDbFresh() {
  vi.resetModules()
  const { getDb } = await import('./client')
  return getDb
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('DATABASE_URL validation', () => {
  it('catches an unreplaced placeholder from the Supabase template', async () => {
    // Supabase's Connect panel shows aws-0-<region>. Pasted as-is, `<` and `>`
    // are invalid in a hostname and every render fails.
    const getDb = await getDbFresh()
    expect(() =>
      getDb(`postgresql://postgres.abc:${PASSWORD}@aws-0-<region>.pooler.supabase.com:6543/postgres`),
    ).toThrow(/<placeholder>/i)
  })

  it('never puts the connection string in the error', async () => {
    const getDb = await getDbFresh()
    const url = `postgresql://postgres.abc:${PASSWORD}@aws-0-<region>.pooler.supabase.com:6543/postgres`
    try {
      getDb(url)
      throw new Error('should have thrown')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      expect(message).not.toContain(PASSWORD)
      expect(message).not.toContain(url)
    }
  })

  it('points at percent-encoding when the password is the problem', async () => {
    const getDb = await getDbFresh()
    try {
      // A bare @ in the password splits the authority in the wrong place.
      getDb('not even a url')
      throw new Error('should have thrown')
    } catch (error) {
      expect((error as Error).message).toMatch(/percent-encoded/i)
    }
  })

  it('still complains clearly when nothing is set at all', async () => {
    vi.stubEnv('DATABASE_URL', '')
    const getDb = await getDbFresh()
    expect(() => getDb()).toThrow(/DATABASE_URL is not set/)
  })
})
