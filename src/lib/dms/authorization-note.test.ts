import { describe, expect, it } from 'vitest'
import { authorizationNote, withAuthorization } from './authorization-note'

const auth = (over: Partial<NonNullable<Parameters<typeof authorizationNote>[0]>> = {}) => ({
  name: 'Mark Johnson',
  at: new Date('2026-08-15T14:30:00'),
  channel: 'LINK',
  authorisedAmount: 618,
  ...over,
})

describe('authorizationNote', () => {
  it('says nothing when the advisor recorded the answers', () => {
    // The ordinary case, and not a lesser one — just a different claim. The
    // provenance line already covers it. Dressing it up as a customer
    // authorisation would be the record asserting something that did not
    // happen.
    expect(authorizationNote(null)).toBeNull()
  })

  it('names who confirmed, when, and how much', () => {
    const note = authorizationNote(auth())!
    expect(note).toContain('Mark Johnson')
    expect(note).toContain('$618')
    expect(note).toMatch(/2026/)
  })

  it('says where they were in words a DMS reader understands', () => {
    // "TABLET" means nothing to somebody reading a comment field two months
    // later on a screen that has never heard of DealerTech.
    expect(authorizationNote(auth({ channel: 'LINK' }))!).toMatch(/their own phone/)
    expect(authorizationNote(auth({ channel: 'TABLET' }))!).toMatch(/at the dealership/)
    expect(authorizationNote(auth({ channel: 'WHATEVER' }))!).toMatch(/device we provided/)
  })

  it('states its own limits inside the permanent record', () => {
    // Without this, somebody eventually treats it as the dealership's written
    // estimate. It is not, and the record has to say so where it will be read
    // rather than in a comment in our source.
    const note = authorizationNote(auth())!
    expect(note).toMatch(/does not/i)
    expect(note).toMatch(/repair order/i)
  })

  it('never claims the customer authorised more than they saw', () => {
    // The amount is the one presented, not a live re-price. "They agreed to
    // $618" only means anything alongside $618 being what the screen said.
    expect(authorizationNote(auth({ authorisedAmount: 0 }))!).toContain('$0')
  })
})

describe('withAuthorization', () => {
  it('leaves a note untouched when there is no authorisation', () => {
    expect(withAuthorization('APPROVED\n  Brakes', null)).toBe('APPROVED\n  Brakes')
  })

  it('appends the block below the existing note', () => {
    const out = withAuthorization('APPROVED\n  Brakes', auth())
    expect(out.startsWith('APPROVED\n  Brakes')).toBe(true)
    expect(out).toContain('CUSTOMER AUTHORISATION')
  })
})
