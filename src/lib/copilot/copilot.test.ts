import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildCopilotContext, renderContext } from './context'
import { buildUserPrompt, sourceLabel } from './prompts'
import { mockAnswer } from './mock-answer'
import { resolveProviderName } from './provider'
import { SURFACES, buildAppGuide, renderAppGuide } from './app-guide'
import { appHelpSourceLabel, buildAppHelpPrompt, mockAppHelpAnswer } from './app-help'
import { selectMode, showsHelpLauncher } from './mode'
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

/* ======================================================= app help ======== */

describe('buildAppGuide', () => {
  it('gives a salesperson their one page and not the drive', () => {
    // The fence in src/lib/auth/sales.ts redirects SALES out of fifteen pages.
    // Coaching them into one would be the guide making a promise the product
    // immediately breaks — the same broken promise WorkspaceNav refuses to
    // make by not showing them the link.
    const guide = buildAppGuide('SALES')
    expect(guide.surfaces.some((s) => s.path === '/introduce')).toBe(true)
    expect(guide.surfaces.some((s) => s.path === '/drive')).toBe(false)
    expect(guide.surfaces.some((s) => s.path === '/follow-up')).toBe(false)
  })

  it('names what a salesperson cannot reach, so the answer can be honest', () => {
    const guide = buildAppGuide('SALES')
    expect(guide.outOfReach.length).toBeGreaterThan(10)
    expect(guide.outOfReach.some((n) => n.includes('drive'))).toBe(true)
  })

  it('gives an advisor the drive but not the manager surfaces', () => {
    const guide = buildAppGuide('ADVISOR')
    expect(guide.surfaces.some((s) => s.path === '/drive/[appointmentId]')).toBe(true)
    expect(guide.surfaces.some((s) => s.path === '/team')).toBe(false)
    expect(guide.surfaces.some((s) => s.path === '/billing')).toBe(false)
  })

  it('gives a manager the roster, billing and the department board', () => {
    const guide = buildAppGuide('SERVICE_MANAGER')
    for (const path of ['/manager', '/team', '/import', '/setup', '/billing']) {
      expect(guide.surfaces.some((s) => s.path === path)).toBe(true)
    }
  })

  it('includes a fixed ops director as a manager', () => {
    // The role that WorkspaceNav's hand-rolled predicate used to omit. The
    // guide and the nav must not disagree about who counts as a manager.
    expect(buildAppGuide('FIXED_OPS_DIRECTOR').surfaces.some((s) => s.path === '/team')).toBe(true)
  })

  it('keeps the operations console for DealerTech staff only', () => {
    expect(buildAppGuide('SERVICE_MANAGER').surfaces.some((s) => s.path === '/admin')).toBe(false)
    expect(
      buildAppGuide('ADVISOR', { isPlatformAdmin: true }).surfaces.some((s) => s.path === '/admin'),
    ).toBe(true)
  })

  it('tells everybody the principles, sales floor included', () => {
    // "A preference is not an authorization" is exactly the sentence somebody
    // booking a first service at delivery should also have heard.
    expect(buildAppGuide('SALES').principles.length).toBe(
      buildAppGuide('SERVICE_MANAGER').principles.length,
    )
  })

  it('describes the customer screens to staff who never open them', () => {
    // An advisor asks "what do they see when I send the link?" more often than
    // they ask anything about their own screens.
    const guide = buildAppGuide('ADVISOR')
    const link = guide.surfaces.find((s) => s.path === '/m/[token]')
    expect(link?.customerFacing).toBe(true)
    expect(guide.surfaces.find((s) => s.path === '/present')?.customerFacing).toBe(true)
  })
})

describe('the guide covers the whole app', () => {
  /*
    The mechanism, not the good intention.

    A guide is only worth grounding an answer in while it is complete, and
    "remember to update the guide" is exactly the instruction that gets
    forgotten. So the route tree is walked and every page is required to have an
    entry: add a screen without teaching the Co-Pilot about it and this fails.

    Route paths are the keys — `GuideSurface.path` is the App Router path with
    its dynamic segments spelled the way the directories are, so the mapping is
    a string comparison rather than a convention somebody has to remember.
  */
  const APP_DIR = fileURLToPath(new URL('../../app', import.meta.url))

  /**
   * Every directory under src/app holding a `page.tsx`, as a route path.
   *
   * `api/` is skipped: those are `route.ts` handlers with no page, so they
   * never match anyway, and skipping them says out loud that an endpoint is not
   * a surface a person can be told how to use.
   */
  function routePaths(dir: string, prefix = ''): string[] {
    const found: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (prefix === '' && entry.name === 'api') continue
        found.push(...routePaths(join(dir, entry.name), `${prefix}/${entry.name}`))
      } else if (entry.name === 'page.tsx') {
        found.push(prefix === '' ? '/' : prefix)
      }
    }
    return found
  }

  /**
   * Pages the guide deliberately does not carry, each for a stated reason.
   *
   * Every one of them is outside the product a signed-in person is asking
   * about. Note what is NOT excluded: `/present` and `/m/[token]` are in the
   * guide, because an advisor needs to know what the customer is looking at —
   * the Co-Pilot is kept off those screens by the layout it is mounted in and
   * by `showsHelpLauncher`, not by leaving them out of the guide.
   */
  const NOT_IN_THE_GUIDE = new Set([
    '/', // the marketing site
    '/demo', // the marketing demo surface
    '/login', // the sign-in form; there is nothing to explain and nobody signed in to explain it to
  ])

  const routes = routePaths(APP_DIR)

  it('found the route tree at all', () => {
    // Guards the guard: a walk that silently returned nothing would make every
    // assertion below pass while checking nothing.
    expect(routes.length).toBeGreaterThan(25)
    expect(routes).toContain('/drive/[appointmentId]')
  })

  it('has an entry for every page in the app', () => {
    const known = new Set(SURFACES.map((s) => s.path))
    const missing = routes.filter((r) => !NOT_IN_THE_GUIDE.has(r) && !known.has(r))
    expect(missing).toEqual([])
  })

  it('has no entry for a page that no longer exists', () => {
    const live = new Set(routes)
    expect(SURFACES.filter((s) => !live.has(s.path)).map((s) => s.path)).toEqual([])
  })

  it('keys each surface once', () => {
    expect(new Set(SURFACES.map((s) => s.path)).size).toBe(SURFACES.length)
  })

  it('says what every surface is for and what is done on it', () => {
    for (const s of SURFACES) {
      expect(s.name.length).toBeGreaterThan(2)
      expect(s.purpose.length).toBeGreaterThan(20)
      expect(s.does.length).toBeGreaterThan(0)
    }
  })
})

describe('renderAppGuide', () => {
  it('names who is asking and where they work', () => {
    const rendered = renderAppGuide(buildAppGuide('ADVISOR'), 'Riverside Hyundai')
    expect(rendered).toContain('A service advisor at Riverside Hyundai')
  })

  it('never shows a salesperson a route they would be redirected out of', () => {
    const rendered = renderAppGuide(buildAppGuide('SALES'), 'Riverside Hyundai')
    expect(rendered).not.toContain('/drive')
    expect(rendered).not.toContain('/follow-up')
    expect(rendered).toContain('/introduce')
  })

  it('lists what is out of reach by name only, with an instruction not to explain it', () => {
    const rendered = renderAppGuide(buildAppGuide('SALES'))
    expect(rendered).toContain('## Screens this person cannot open')
    expect(rendered).toContain('Do not explain how to use them')
  })

  it('separates the screens the customer holds from the ones staff open', () => {
    const rendered = renderAppGuide(buildAppGuide('ADVISOR'))
    expect(rendered).toContain('## What the customer sees (staff never open these)')
  })

  it('carries the principles worth repeating', () => {
    const rendered = renderAppGuide(buildAppGuide('ADVISOR'))
    expect(rendered).toContain('A preference is not an authorization')
    expect(rendered).toContain('Tier comes from measurement')
  })
})

describe('buildAppHelpPrompt', () => {
  it('puts the guide first so it caches across a shift of questions', () => {
    const guide = buildAppGuide('ADVISOR')
    const a = buildAppHelpPrompt({ intent: 'APP_HELP', question: 'How do I book?' }, guide)
    const b = buildAppHelpPrompt({ intent: 'APP_HELP', question: 'What is a prep sheet?' }, guide)
    expect(a.startsWith('## What DealerTech is')).toBe(true)
    const prefix = renderAppGuide(guide)
    expect(a.startsWith(prefix)).toBe(true)
    expect(b.startsWith(prefix)).toBe(true)
  })

  it('quotes the question back verbatim', () => {
    const prompt = buildAppHelpPrompt(
      { intent: 'APP_HELP', question: 'Where do declined jobs go?' },
      buildAppGuide('ADVISOR'),
    )
    expect(prompt).toContain('They ask: "Where do declined jobs go?"')
  })

  it('carries no customer anywhere in it', () => {
    // The whole point of the second grounding: a question about the software
    // must not be answered with somebody's coverage in the prompt.
    const prompt = buildAppHelpPrompt(
      { intent: 'APP_HELP', question: 'How do I send a menu?' },
      buildAppGuide('ADVISOR'),
      'Riverside Hyundai',
    )
    expect(prompt).not.toContain('Maria Perez')
    expect(prompt).not.toContain('VIN')
    expect(prompt).not.toContain('Still on the table')
  })
})

describe('appHelpSourceLabel', () => {
  it('credits the guide and the role it was sliced for', () => {
    expect(appHelpSourceLabel(buildAppGuide('ADVISOR'))).toContain('service advisor')
  })
})

describe('mockAppHelpAnswer', () => {
  it('answers a "how do I" with the steps that actually work', () => {
    const answer = mockAppHelpAnswer(
      { intent: 'APP_HELP', question: 'How do I send the menu to their phone?' },
      buildAppGuide('ADVISOR'),
    )
    expect(answer).toContain('Send the menu to their phone')
    expect(answer).toContain('1.')
  })

  it('sends a salesperson to their own page rather than into the fence', () => {
    const answer = mockAppHelpAnswer(
      { intent: 'APP_HELP', question: 'How do I see the drive?' },
      buildAppGuide('SALES'),
    )
    expect(answer).toContain('Introduce a customer to service')
    expect(answer.toLowerCase()).toContain("isn't yours")
  })

  it('admits what the guide does not cover instead of inventing a screen', () => {
    const answer = mockAppHelpAnswer(
      { intent: 'APP_HELP', question: 'How do I export to QuickBooks?' },
      buildAppGuide('ADVISOR'),
    )
    expect(answer).toContain("I don't have that in the product guide")
  })

  it('points a question about one customer back at the prep sheet', () => {
    const answer = mockAppHelpAnswer({ intent: 'APP_HELP' }, buildAppGuide('ADVISOR'))
    expect(answer).toContain('prep sheet')
  })
})

describe('selectMode', () => {
  it('grounds a visit question in the visit', () => {
    expect(selectMode({ intent: 'NEXT_STEP', appointmentId: 'a1' })).toEqual({
      mode: 'VISIT',
      appointmentId: 'a1',
    })
  })

  it('keeps app help away from a visit even when asked from inside one', () => {
    // The prep sheet's own panel offers "How this screen works", so this call
    // arrives with an appointment id attached. The product guide is the whole
    // grounding for it and no customer belongs in the answer.
    expect(selectMode({ intent: 'APP_HELP', appointmentId: 'a1' })).toEqual({ mode: 'APP_HELP' })
  })

  it('answers app help with no appointment at all', () => {
    expect(selectMode({ intent: 'APP_HELP' })).toEqual({ mode: 'APP_HELP' })
  })

  it('refuses a visit question with nothing to ground it in', () => {
    // Silently answering this from the guide would turn "what should I present
    // next" into a tour of the software.
    const selection = selectMode({ intent: 'NEXT_STEP' })
    expect('error' in selection).toBe(true)
  })
})

describe('showsHelpLauncher', () => {
  it('never appears on a screen a customer is holding', () => {
    expect(showsHelpLauncher('/present')).toBe(false)
    expect(showsHelpLauncher('/m/abc123')).toBe(false)
  })

  it('stands down on the prep sheet, which has its own', () => {
    expect(showsHelpLauncher('/drive/appt-1')).toBe(false)
  })

  it('appears on every other workspace page', () => {
    for (const path of [
      '/drive', '/drive/week', '/drive/book', '/follow-up', '/customers',
      '/customers/c1', '/vehicles/v1', '/advisor/scorecard', '/manager', '/team',
      '/setup', '/import', '/billing', '/devices', '/introduce',
    ]) {
      expect(showsHelpLauncher(path)).toBe(true)
    }
  })

  it('stays off the signed-out doors and the operations console', () => {
    for (const path of ['/', '/demo', '/login', '/signup', '/invite/tok', '/admin', '/admin/leads']) {
      expect(showsHelpLauncher(path)).toBe(false)
    }
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
