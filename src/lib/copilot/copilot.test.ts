import { describe, expect, it } from 'vitest'
import { buildCopilotContext, renderContext } from './context'
import { buildUserPrompt, sourceLabel } from './prompts'
import { mockAnswer } from './mock-answer'
import { resolveProviderName } from './provider'
import type { CopilotContext } from './types'
import type { Opportunity, PrepSheet } from '@/lib/prep-sheet'
import type { TermStatus } from '@/lib/warranty'

function opportunity(over: Partial<Opportunity> = {}): Opportunity {
  return {
    id: 'opp-1',
    type: 'WEAR_PREDICTED',
    title: 'Tires approaching replacement',
    detail: 'Worst corner RF is at 4/32".',
    estimatedAmount: 1100,
    customerOutOfPocket: 1100,
    likelyPayer: 'CUSTOMER_PAY',
    urgency: 'HIGH',
    closeProbability: 0.5,
    priorityScore: 80,
    talkTrack: 'Show the trend across their last 2 visits.',
    ...over,
  }
}

/** An expired term — the fixtures assert on opportunities, not on coverage. */
function term(): TermStatus {
  return {
    name: 'Federal Emissions (long)',
    term: { months: 96, miles: 80000 },
    active: false,
    monthsRemaining: 0,
    milesRemaining: 0,
    expiresOn: new Date('2026-01-01T12:00:00Z'),
    expiresAtMiles: 80000,
    limitingFactor: 'TIME',
    expiredBy: 'TIME',
  }
}

function sheet(over: Partial<PrepSheet> = {}): PrepSheet {
  return {
    customer: {
      id: 'c1',
      name: 'Maria Perez',
      visitCount: 6,
      lifetimeSpend: 1412,
      lastVisitAt: null,
      preferredChannel: 'SMS',
      pinnedNotes: [],
    },
    vehicle: {
      id: 'v1',
      vin: '5NMJBCAE1MH234TB0CT',
      make: 'HYUNDAI',
      model: 'Tucson',
      modelYear: 2021,
      inServiceDate: null,
      currentMileage: 51140,
      avgMilesPerDay: 30,
      isHybridOrEv: false,
      isOriginalOwner: true,
    },
    appointment: {
      id: 'a1',
      scheduledAt: new Date('2026-08-12T12:00:00Z'),
      promisedAt: null,
      transportType: 'WAITER',
      concerns: 'Noise from front end over bumps',
      advisorName: 'Marcus Reyes',
    },
    warranty: {
      make: 'HYUNDAI',
      modelYear: 2021,
      known: true,
      program: undefined,
      basic: null,
      powertrain: null,
      corrosion: null,
      emissionsLong: term(),
      emissionsShort: term(),
      hybridEv: null,
      warnings: [],
    },
    contracts: [],
    prepaidEntitlements: [],
    inspectionHistory: [],
    projectedMileage: 51140,
    opportunities: [opportunity()],
    totals: { opportunityValue: 1100, customerOutOfPocket: 1100, coveredValue: 0 },
    alerts: [],
    ...over,
  }
}

describe('buildCopilotContext', () => {
  it('carries the visit identity the advisor would read aloud', () => {
    const ctx = buildCopilotContext(sheet())
    expect(ctx.customerName).toBe('Maria Perez')
    expect(ctx.vehicle).toBe('2021 HYUNDAI Tucson')
    expect(ctx.vinLast6).toBe('4TB0CT')
    expect(ctx.concern).toBe('Noise from front end over bumps')
  })

  it('reflects the advisor decisions so far', () => {
    const s = sheet({
      opportunities: [opportunity(), opportunity({ id: 'opp-2', estimatedAmount: 400 })],
    })
    const ctx = buildCopilotContext(s, { 'opp-1': 'ACCEPTED' })
    expect(ctx.acceptedValue).toBe(1100)
    expect(ctx.remainingValue).toBe(400)
    expect(ctx.opportunities.find((o) => o.id === 'opp-1')?.decision).toBe('ACCEPTED')
  })

  it('defaults an untouched opportunity to PENDING', () => {
    const ctx = buildCopilotContext(sheet())
    expect(ctx.opportunities[0]?.decision).toBe('PENDING')
  })

  it('grounds a call-me as a call-me, and never as money', () => {
    // The route used to filter CALL_ME out of the decisions map (the same
    // hand-written-list drift F5 fixed on the tablet mirror), so the model was
    // told the customer had not answered — on the one line where they had
    // asked to be called. The context passes the answer through verbatim and
    // keeps it out of both totals: not accepted money, and not still-winnable.
    const s = sheet({
      opportunities: [opportunity(), opportunity({ id: 'opp-2', estimatedAmount: 400 })],
    })
    const ctx = buildCopilotContext(s, { 'opp-1': 'CALL_ME' })
    expect(ctx.opportunities.find((o) => o.id === 'opp-1')?.decision).toBe('CALL_ME')
    expect(ctx.acceptedValue).toBe(0)
    expect(ctx.remainingValue).toBe(400)
  })
})

describe('renderContext', () => {
  it('states that coverage is the engine\'s call, not the model\'s', () => {
    // Cheap to assert and expensive to lose: this line is what stops the model
    // reasoning its way to a different payer than the engine decided.
    expect(renderContext(buildCopilotContext(sheet()))).toContain(
      'decided by the coverage engine, not by you',
    )
  })

  it('includes the money figures verbatim so the model quotes rather than computes', () => {
    const rendered = renderContext(buildCopilotContext(sheet()))
    expect(rendered).toContain('$1,100')
    expect(rendered).toContain('Still on the table: $1,100')
  })

  it('says so plainly when there is nothing to sell', () => {
    const rendered = renderContext(buildCopilotContext(sheet({ opportunities: [] })))
    expect(rendered).toContain('Nothing outstanding on this vehicle.')
  })

  it('says so plainly when there is no coverage at all', () => {
    // Asserted on the context directly: a real snapshot always carries the
    // federal emissions term, so this branch is only reachable in principle.
    const bare = { ...buildCopilotContext(sheet()), coverage: [] }
    expect(renderContext(bare)).toContain('No factory warranty or purchased products on file.')
  })
})

describe('buildUserPrompt', () => {
  it('puts the grounding block first so it caches across intents', () => {
    const ctx = buildCopilotContext(sheet())
    const a = buildUserPrompt({ intent: 'NEXT_STEP' }, ctx)
    const b = buildUserPrompt({ intent: 'TALK_TRACK', opportunityId: 'opp-1' }, ctx)
    expect(a.startsWith('## This visit')).toBe(true)
    expect(b.startsWith('## This visit')).toBe(true)
  })

  it('names the specific opportunity when one is targeted', () => {
    const ctx = buildCopilotContext(sheet())
    const prompt = buildUserPrompt({ intent: 'TALK_TRACK', opportunityId: 'opp-1' }, ctx)
    expect(prompt).toContain('The item in question is "Tires approaching replacement"')
  })

  it('ignores an opportunity id that is not on this sheet', () => {
    const ctx = buildCopilotContext(sheet())
    const prompt = buildUserPrompt({ intent: 'TALK_TRACK', opportunityId: 'not-here' }, ctx)
    expect(prompt).not.toContain('The item in question')
  })

  it('quotes the objection back verbatim', () => {
    const ctx = buildCopilotContext(sheet())
    const prompt = buildUserPrompt({ intent: 'OBJECTION', objection: 'Too expensive' }, ctx)
    expect(prompt).toContain('The customer just said: "Too expensive"')
  })
})

describe('sourceLabel', () => {
  it('credits the coverage engine when explaining coverage', () => {
    const ctx = buildCopilotContext(sheet())
    expect(sourceLabel({ intent: 'EXPLAIN_COVERAGE' }, ctx)).toContain('coverage engine')
  })

  it('names the item for a talk track', () => {
    const ctx = buildCopilotContext(sheet())
    expect(sourceLabel({ intent: 'TALK_TRACK', opportunityId: 'opp-1' }, ctx)).toContain(
      'Tires approaching replacement',
    )
  })
})

describe('mockAnswer', () => {
  const ctx = (): CopilotContext => buildCopilotContext(sheet())

  it('recommends the highest-ranked outstanding item', () => {
    expect(mockAnswer({ intent: 'NEXT_STEP' }, ctx())).toContain(
      'Present Tires approaching replacement next',
    )
  })

  it('does not recommend an item the advisor already worked', () => {
    const worked = buildCopilotContext(sheet(), { 'opp-1': 'DECLINED' })
    const answer = mockAnswer({ intent: 'NEXT_STEP' }, worked)
    expect(answer).not.toContain('Present Tires')
    expect(answer).toContain('worked every item')
  })

  it('offers three distinct angles for a talk track', () => {
    const answer = mockAnswer({ intent: 'TALK_TRACK', opportunityId: 'opp-1' }, ctx())
    expect(answer).toContain('**Consultative**')
    expect(answer).toContain('**Value**')
    expect(answer).toContain('**Urgency**')
  })

  it('matches a known objection rather than falling through', () => {
    const answer = mockAnswer({ intent: 'OBJECTION', objection: 'Too expensive' }, ctx())
    expect(answer).toContain("I'd rather tell you the real number")
  })

  it('falls back gracefully on an objection it has no script for', () => {
    const answer = mockAnswer({ intent: 'OBJECTION', objection: 'My cousin is a mechanic' }, ctx())
    expect(answer).toContain('let them fill the silence')
  })

  it('never promises coverage outright', () => {
    // The advisor may read this to a customer. A flat promise is a comeback.
    const covered = buildCopilotContext(
      sheet({ opportunities: [opportunity({ likelyPayer: 'VSC', customerOutOfPocket: 100 })] }),
    )
    const answer = mockAnswer({ intent: 'EXPLAIN_COVERAGE' }, covered)
    expect(answer.toLowerCase()).not.toContain('will be covered')
  })
})

describe('resolveProviderName', () => {
  it('defaults to the mock so a fresh clone works with no key', () => {
    expect(resolveProviderName({})).toBe('mock')
  })

  it('needs an explicit opt-in even when a key is present', () => {
    // A key in the environment for some other purpose must not silently start
    // billing the dealership for every tap on the drive.
    expect(resolveProviderName({ ANTHROPIC_API_KEY: 'sk-test' })).toBe('mock')
  })

  it('uses the real provider when opted in and keyed', () => {
    expect(
      resolveProviderName({
        COPILOT_PROVIDER: 'anthropic',
        ANTHROPIC_API_KEY: 'sk-test',
      }),
    ).toBe('anthropic')
  })

  it('falls back to the mock when opted in without a key', () => {
    expect(resolveProviderName({ COPILOT_PROVIDER: 'anthropic' })).toBe('mock')
  })
})
