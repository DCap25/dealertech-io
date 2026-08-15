import { describe, expect, it } from 'vitest'
import {
  DECISIONS, followUpPriority, isAuthorised, isDecision, needsFollowUp,
  sanitizeDecisions, totalDecisions, type Decision,
} from './decisions'

describe('the three answers', () => {
  it('offers a real third option, not a soft decline', () => {
    // "Maybe" and "think about it" both read as a polite no and get worked
    // like one. This is a request, and it should be answered.
    const callMe = DECISIONS.find((d) => d.code === 'CALL_ME')
    expect(callMe?.customerLabel).toMatch(/call me/i)
    expect(callMe?.customerLabel).not.toMatch(/maybe|think about/i)
  })

  it('offers "not today" as plainly as "yes"', () => {
    // The product exists because customers assume the advisor is inventing
    // work. Burying the decline is exactly what that customer expects.
    const decline = DECISIONS.find((d) => d.code === 'DECLINED')
    expect(decline?.customerLabel).toBeTruthy()
    expect(decline?.customerLabel.length).toBeLessThan(20)
  })
})

describe('isAuthorised', () => {
  it('is yes and nothing else', () => {
    // A call-me is not permission. Treating it as one is how work gets done
    // that nobody agreed to.
    expect(isAuthorised('ACCEPTED')).toBe(true)
    expect(isAuthorised('CALL_ME')).toBe(false)
    expect(isAuthorised('DECLINED')).toBe(false)
    expect(isAuthorised('PENDING')).toBe(false)
  })
})

describe('needsFollowUp', () => {
  it('follows up a decline and a call-me', () => {
    expect(needsFollowUp('DECLINED')).toBe(true)
    expect(needsFollowUp('CALL_ME')).toBe(true)
  })

  it('does not chase an item nobody answered', () => {
    // Pending is our failure to ask, not their decision. Following it up
    // would be following up on ourselves.
    expect(needsFollowUp('PENDING')).toBe(false)
    expect(needsFollowUp('ACCEPTED')).toBe(false)
  })
})

describe('followUpPriority', () => {
  it('puts a call-me well ahead of a decline', () => {
    // They asked to be contacted. Leaving that for the ordinary decline
    // cadence is a lost sale and, from their side, being ignored after asking
    // a direct question.
    expect(followUpPriority('CALL_ME')).toBeLessThan(followUpPriority('DECLINED'))
  })

  it('never schedules an accepted or pending item', () => {
    expect(followUpPriority('ACCEPTED')).toBe(Number.POSITIVE_INFINITY)
    expect(followUpPriority('PENDING')).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('sanitizeDecisions', () => {
  const presented = ['a', 'b', 'c']

  it('keeps answers to things that were presented', () => {
    expect(sanitizeDecisions(presented, { a: 'ACCEPTED', b: 'CALL_ME' }))
      .toEqual({ a: 'ACCEPTED', b: 'CALL_ME' })
  })

  it('drops an id that was never shown', () => {
    // A client posting an id it was never sent is broken or being probed.
    // Either way, do not record a decision against work nobody saw.
    expect(sanitizeDecisions(presented, { z: 'ACCEPTED' })).toEqual({})
  })

  it('drops a value that is not an answer', () => {
    expect(sanitizeDecisions(presented, { a: 'YES', b: 42, c: null })).toEqual({})
  })

  it('survives junk instead of an object', () => {
    for (const junk of [null, undefined, 'ACCEPTED', 7, []]) {
      expect(sanitizeDecisions(presented, junk)).toEqual({})
    }
  })
})

describe('totalDecisions', () => {
  const items = [
    { id: 'brakes', customerPrice: 618 },
    { id: 'tyres', customerPrice: 1_100 },
    { id: 'align', customerPrice: 149 },
    { id: 'cabin', customerPrice: 97 },
  ]

  it('counts each answer and totals only what was approved', () => {
    const decisions: Record<string, Decision> = {
      brakes: 'ACCEPTED', tyres: 'DECLINED', align: 'CALL_ME',
    }
    const totals = totalDecisions(items, decisions)
    expect(totals).toEqual({
      accepted: 1, declined: 1, callMe: 1, pending: 1, authorisedAmount: 618,
    })
  })

  it('does not count a call-me as money on the ticket', () => {
    const totals = totalDecisions(items, { align: 'CALL_ME' })
    expect(totals.authorisedAmount).toBe(0)
  })

  it('treats an unanswered item as pending rather than declined', () => {
    // An advisor who ran out of time has not been told no.
    const totals = totalDecisions(items, {})
    expect(totals.pending).toBe(4)
    expect(totals.declined).toBe(0)
  })

  it('prices from what was presented, not from anything since', () => {
    // The customer agreed to the number on the screen in front of them. If
    // the price has moved, that is a re-authorisation conversation.
    const totals = totalDecisions(
      [{ id: 'brakes', customerPrice: 618 }],
      { brakes: 'ACCEPTED' },
    )
    expect(totals.authorisedAmount).toBe(618)
  })
})

describe('isDecision', () => {
  it('accepts the four states and refuses everything else', () => {
    for (const ok of ['ACCEPTED', 'DECLINED', 'CALL_ME', 'PENDING']) {
      expect(isDecision(ok)).toBe(true)
    }
    for (const bad of ['accepted', 'MAYBE', '', null, 1, {}]) {
      expect(isDecision(bad)).toBe(false)
    }
  })
})
