import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  TOUR_CODE_ALPHABET,
  TOUR_CODE_LENGTH,
  TOUR_CODE_TTL_DAYS,
  TOUR_CODE_UNKNOWN,
  TOUR_ROLES,
  createTourCode,
  formatTourCode,
  hashTourCode,
  isTourRole,
  isWellFormedTourCode,
  normalizeTourCode,
  tourCodeStatus,
  tourCodeStatusMessage,
  tourExpiryFrom,
  tourHashesMatch,
  tourRole,
} from './codes'

const NOW = new Date('2026-08-19T12:00:00Z')

describe('the alphabet', () => {
  it('contains nothing a person could misread down a phone', () => {
    // The whole reason this alphabet exists. A zero read as an O turns a
    // thirty-second unlock into a support call with the prospect you are
    // trying to sell to.
    for (const ambiguous of ['0', 'O', '1', 'I']) {
      expect(TOUR_CODE_ALPHABET, ambiguous).not.toContain(ambiguous)
    }
  })

  it('is uppercase letters and digits only', () => {
    expect(TOUR_CODE_ALPHABET).toMatch(/^[A-Z2-9]+$/)
  })

  it('has no repeated character', () => {
    // A duplicate would silently bias generation toward it.
    expect(new Set(TOUR_CODE_ALPHABET).size).toBe(TOUR_CODE_ALPHABET.length)
  })

  it('is a power of two long, which is what makes the modulo unbiased', () => {
    /*
      `createTourCode` picks characters with `randomBytes()[i] % 32` and its
      comment claims that is uniform. That claim is only true because 256 is an
      exact multiple of the alphabet length. Adding a character would make the
      comment a lie and every code very slightly predictable, so the property
      is asserted rather than trusted.
    */
    expect(256 % TOUR_CODE_ALPHABET.length).toBe(0)
  })
})

describe('createTourCode', () => {
  it('produces ten characters from the alphabet', () => {
    const { code } = createTourCode()
    expect(code).toHaveLength(TOUR_CODE_LENGTH)
    expect([...code].every((c) => TOUR_CODE_ALPHABET.includes(c))).toBe(true)
  })

  it('is well-formed by its own definition', () => {
    // The generator and the validator drifting apart would make every freshly
    // issued code unusable, which is the kind of bug that ships on a Friday.
    for (let i = 0; i < 50; i++) {
      expect(isWellFormedTourCode(createTourCode().code)).toBe(true)
    }
  })

  it('does not repeat itself', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 500; i++) seen.add(createTourCode().code)
    expect(seen.size).toBe(500)
  })

  it('returns the hash of the code it returns, and not the code', () => {
    const { code, codeHash } = createTourCode()
    expect(codeHash).toBe(createHash('sha256').update(code).digest('hex'))
    expect(codeHash).not.toContain(code)
    expect(codeHash).toHaveLength(64)
  })

  it('spreads across the alphabet rather than favouring one end', () => {
    /*
      A weak guard against the classic modulo-bias mistake reappearing. With
      2,000 characters over 32 symbols the expectation is ~62 each; asserting
      only that every symbol appears at all is loose enough never to flake and
      tight enough to catch a generator that has collapsed onto a subset.
    */
    let all = ''
    for (let i = 0; i < 200; i++) all += createTourCode().code
    for (const c of TOUR_CODE_ALPHABET) expect(all, c).toContain(c)
  })
})

describe('normalizeTourCode', () => {
  it('accepts whatever shape a human types it in', () => {
    for (const typed of [
      'fkmt9pqr34',
      '  FKMT9PQR34  ',
      'FKMT9-PQR34',
      'fkmt9 pqr34',
      'FKMT9.PQR34',
    ]) {
      expect(normalizeTourCode(typed), typed).toBe('FKMT9PQR34')
    }
  })

  it('strips the hyphen the console prints', () => {
    // The formatted form is what a prospect sees and therefore what they type.
    // If normalising did not undo it, the code on the screen would not work.
    const { code } = createTourCode()
    expect(normalizeTourCode(formatTourCode(code))).toBe(code)
  })
})

describe('isWellFormedTourCode', () => {
  it('rejects a code of the wrong length', () => {
    expect(isWellFormedTourCode('FKMT9PQR3')).toBe(false)
    expect(isWellFormedTourCode('FKMT9PQR345')).toBe(false)
    expect(isWellFormedTourCode('')).toBe(false)
  })

  it('rejects the ambiguous glyphs even at the right length', () => {
    // Somebody reading a code aloud says "oh" and the listener types O. It is
    // not a code we could ever have issued, so it is caught before the lookup.
    expect(isWellFormedTourCode('FKMTOPQR34')).toBe(false)
    expect(isWellFormedTourCode('FKMT1PQR34')).toBe(false)
    expect(isWellFormedTourCode('FKMT0PQR34')).toBe(false)
    expect(isWellFormedTourCode('FKMTIPQR34')).toBe(false)
  })

  it('accepts a code typed in lower case or with separators', () => {
    expect(isWellFormedTourCode('fkmt9pqr34')).toBe(true)
    expect(isWellFormedTourCode('FKMT9-PQR34')).toBe(true)
  })

  it('rejects punctuation that would survive nothing but the length check', () => {
    // The normaliser strips these, so the length is measured after stripping —
    // "FKMT9PQR34!!" is ten valid characters plus noise and must still pass,
    // while "!!!!!!!!!!" is ten characters of pure noise and must not.
    expect(isWellFormedTourCode('!!!!!!!!!!')).toBe(false)
    expect(isWellFormedTourCode('FKMT9PQR34!!')).toBe(true)
  })
})

describe('hashTourCode', () => {
  it('normalises before hashing, so the shape it was typed in does not matter', () => {
    /*
      The bug this prevents: a prospect pastes the hyphenated form from the
      email, the lookup hashes it raw, and a perfectly valid code returns "not
      one of ours" for a reason invisible in a diff.
    */
    const canonical = hashTourCode('FKMT9PQR34')
    for (const variant of ['fkmt9pqr34', 'FKMT9-PQR34', '  fkmt9 pqr34 ']) {
      expect(hashTourCode(variant), variant).toBe(canonical)
    }
  })

  it('is SHA-256 hex', () => {
    expect(hashTourCode('FKMT9PQR34')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('differs completely for a one-character difference', () => {
    expect(hashTourCode('FKMT9PQR34')).not.toBe(hashTourCode('FKMT9PQR35'))
  })
})

describe('tourHashesMatch', () => {
  it('matches a hash against itself', () => {
    const h = hashTourCode('FKMT9PQR34')
    expect(tourHashesMatch(h, h)).toBe(true)
  })

  it('rejects a different hash of the same length', () => {
    expect(tourHashesMatch(hashTourCode('FKMT9PQR34'), hashTourCode('FKMT9PQR35'))).toBe(false)
  })

  it('rejects a length mismatch without throwing', () => {
    // timingSafeEqual throws outright on differing lengths, which would turn a
    // truncated value in the database into a 500 rather than a refusal.
    expect(tourHashesMatch('abc', hashTourCode('FKMT9PQR34'))).toBe(false)
    expect(tourHashesMatch('', '')).toBe(true)
  })

  it('uses a constant-time comparison rather than ===', () => {
    /*
      Asserted against the source, because the property is not observable from
      the outside: a `===` implementation passes every behavioural test above.
      The lookup is by hash so the database does the real matching and this is
      belt-and-braces — but it is exactly the sort of line somebody
      "simplifies" while tidying, and the point of writing it was that it is
      free to do properly and awkward to explain later.
    */
    const source = readFileSync(fileURLToPath(new URL('./codes.ts', import.meta.url)), 'utf8')
    expect(source).toContain('timingSafeEqual')
    const body = source.slice(source.indexOf('export function tourHashesMatch'))
    expect(body.slice(0, body.indexOf('\n}'))).toContain('timingSafeEqual(left, right)')
  })
})

describe('tourCodeStatus', () => {
  const live = { expiresAt: new Date('2026-08-26T12:00:00Z'), revokedAt: null }

  it('is valid before the expiry with no revocation', () => {
    expect(tourCodeStatus(live, NOW)).toBe('VALID')
  })

  it('is expired at the instant it expires, not a moment after', () => {
    // `<=`, deliberately. A credential that is still good on the tick of its
    // own deadline is a credential whose deadline is a suggestion.
    expect(tourCodeStatus({ ...live, expiresAt: NOW }, NOW)).toBe('EXPIRED')
    expect(tourCodeStatus({ ...live, expiresAt: new Date(NOW.getTime() + 1) }, NOW)).toBe('VALID')
  })

  it('is expired once the expiry has passed', () => {
    expect(tourCodeStatus({ ...live, expiresAt: new Date('2026-08-18T12:00:00Z') }, NOW)).toBe('EXPIRED')
  })

  it('is revoked when it has been withdrawn', () => {
    expect(tourCodeStatus({ ...live, revokedAt: new Date('2026-08-18T09:00:00Z') }, NOW)).toBe('REVOKED')
  })

  it('reports revoked ahead of expired when both are true', () => {
    /*
      Order matters, the same ordering `inviteStatus` uses. "We withdrew this"
      and "this ran out" are different conversations, and the first is the one
      worth having — a code that was pulled and then also aged out was pulled.
    */
    const both = { expiresAt: new Date('2026-08-01T12:00:00Z'), revokedAt: new Date('2026-08-02T12:00:00Z') }
    expect(tourCodeStatus(both, NOW)).toBe('REVOKED')
  })

  it('has no accepted state — a code is reusable on purpose', () => {
    // A dealer group that puts three people on the walkthrough should not need
    // three codes. The expiry is what stops it becoming a permanent back door.
    expect(tourCodeStatus(live, NOW)).toBe('VALID')
    expect(tourCodeStatus(live, NOW)).toBe('VALID')
  })
})

describe('tourCodeStatusMessage', () => {
  it('tells a withdrawn code apart from an expired one', () => {
    expect(tourCodeStatusMessage('REVOKED')).toContain('withdrawn')
    expect(tourCodeStatusMessage('EXPIRED')).toContain(String(TOUR_CODE_TTL_DAYS))
  })

  it('gives a way back in rather than a dead end', () => {
    // Every refusal on this surface is in front of somebody we want as a
    // customer. A message with no next step is a lost lead.
    for (const status of ['REVOKED', 'EXPIRED'] as const) {
      expect(tourCodeStatusMessage(status), status).toContain('dan@dealertech.io')
    }
  })

  it('stays vague only about a code that does not exist', () => {
    /*
      The one place the generic-error discipline applies. A named state tells a
      prospect something Dan would tell them anyway; "not one of ours" is the
      only signal a guesser gets, so it says nothing about length, shape or
      whether anything nearby exists.
    */
    expect(TOUR_CODE_UNKNOWN).not.toMatch(/expire|revok|withdraw|\d/i)
  })
})

describe('tourExpiryFrom', () => {
  it('is seven days out, matching an invitation', () => {
    const out = tourExpiryFrom(NOW)
    expect(out.toISOString()).toBe('2026-08-26T12:00:00.000Z')
    expect(TOUR_CODE_TTL_DAYS).toBe(7)
  })

  it('does not mutate the date it was handed', () => {
    // setDate mutates. Handing this the request clock and having it move is
    // the kind of thing that shows up three files away.
    const now = new Date(NOW)
    tourExpiryFrom(now)
    expect(now.toISOString()).toBe(NOW.toISOString())
  })

  it('produces a code that is valid now and not in eight days', () => {
    const expiresAt = tourExpiryFrom(NOW)
    expect(tourCodeStatus({ expiresAt, revokedAt: null }, NOW)).toBe('VALID')
    const later = new Date(NOW.getTime() + 8 * 86_400_000)
    expect(tourCodeStatus({ expiresAt, revokedAt: null }, later)).toBe('EXPIRED')
  })
})

describe('formatTourCode', () => {
  it('splits it into two halves for reading aloud', () => {
    expect(formatTourCode('FKMT9PQR34')).toBe('FKMT9-PQR34')
  })

  it('formats what was typed, however it was typed', () => {
    expect(formatTourCode('fkmt9pqr34')).toBe('FKMT9-PQR34')
  })
})

describe('TOUR_ROLES', () => {
  it('offers the three people who are actually on a walkthrough call', () => {
    expect(TOUR_ROLES.map((r) => r.code)).toEqual(['ADVISOR', 'SERVICE_MANAGER', 'BDC'])
  })

  it('points every role at a seeded demo account and never at a real one', () => {
    /*
      The `.test` domain is what `npm run demo:rotate` keys off when it rotates
      the shared password, and it is the line between the fictional dealership
      and a real one. A tour that signed into a real address would hand a
      prospect somebody's actual customers.
    */
    for (const role of TOUR_ROLES) {
      expect(role.email, role.code).toMatch(/@lonestarford\.test$/)
    }
  })

  it('gives each role a distinct account and a distinct landing page', () => {
    expect(new Set(TOUR_ROLES.map((r) => r.email)).size).toBe(TOUR_ROLES.length)
    expect(new Set(TOUR_ROLES.map((r) => r.home)).size).toBe(TOUR_ROLES.length)
  })

  it('lands each role on the screen that role actually works', () => {
    // Not `landingPath()`, which sends everybody with a store to /drive. A BDC
    // lead who arrives on the drive has to be told where their own screen is,
    // and a demo whose first instruction is "now click over here" has lost.
    expect(tourRole('ADVISOR').home).toBe('/drive')
    expect(tourRole('SERVICE_MANAGER').home).toBe('/manager')
    expect(tourRole('BDC').home).toBe('/bdc')
  })

  it('says in one line what each role sees', () => {
    for (const role of TOUR_ROLES) {
      expect(role.sees.length, role.code).toBeGreaterThan(40)
      expect(role.label.length, role.code).toBeGreaterThan(2)
    }
  })

  it('recognises its own codes and nothing else', () => {
    expect(isTourRole('ADVISOR')).toBe(true)
    expect(isTourRole('SERVICE_MANAGER')).toBe(true)
    expect(isTourRole('BDC')).toBe(true)
    // A staff role the seed has but the tour does not offer. Accepting it would
    // sign a prospect in as somebody with no account behind them.
    expect(isTourRole('TECHNICIAN')).toBe(false)
    expect(isTourRole('ADMIN')).toBe(false)
    expect(isTourRole('')).toBe(false)
    expect(isTourRole('advisor')).toBe(false)
  })
})
