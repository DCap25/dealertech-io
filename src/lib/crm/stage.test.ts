import { describe, expect, it } from 'vitest'
import {
  ALL_LEAD_STAGES, LEAD_STAGES, QUIET_DAYS, STAGE_LABEL,
  deriveStage, hasCodeExpiringUnused, hasGoneQuiet, isNewLead, nextStep, stageOrder,
  type LeadFacts,
} from './stage'

/**
 * The pipeline, attacked one fact at a time.
 *
 * The claim under test is that a stage can never disagree with the record it
 * is drawn from, which only holds if the derivation is total: every
 * combination of facts produces exactly one stage, LOST outranks everything,
 * and no fact can make the stage go backwards. A board with a stored stage
 * would need a migration to be wrong; this can be wrong with a boolean, so
 * every rung of the ladder is pinned here.
 */

const NOW = new Date('2026-08-20T12:00:00.000Z')
const DAY = 86_400_000

/** Nothing has happened. Each case turns on exactly one field from here. */
function blank(): LeadFacts {
  return {
    contacted: false,
    contactedAt: null,
    codesIssued: 0,
    codesRedeemed: 0,
    lastCodeIssuedAt: null,
    liveCodeExpiresAt: null,
    walkthroughAt: null,
    walkthroughDoneAt: null,
    provisionedOrgId: null,
    firstMenuAt: null,
    lostAt: null,
    lostReason: null,
    lastActivityAt: null,
  }
}

function at(offsetDays: number): Date {
  return new Date(NOW.getTime() + offsetDays * DAY)
}

describe('the ladder', () => {
  it('starts at NEW with nothing to go on', () => {
    const { stage, because } = deriveStage(blank(), NOW)
    expect(stage).toBe('NEW')
    expect(because).toBe('nobody has rung them')
  })

  it('CONTACTED once somebody rang them', () => {
    const { stage, because } = deriveStage(
      { ...blank(), contacted: true, contactedAt: at(-3) },
      NOW,
    )
    expect(stage).toBe('CONTACTED')
    expect(because).toContain('rung 2026-08-17')
  })

  it('CONTACTED on the flag alone, with no date', () => {
    // The date is nullable — `recordLeadOutcome` clears it when the flag comes
    // off — so the flag has to stand on its own.
    expect(deriveStage({ ...blank(), contacted: true }, NOW).stage).toBe('CONTACTED')
  })

  it('CODE_SENT once a code exists, even for a lead nobody rang', () => {
    /*
      Not a contradiction to fix. A code issued to somebody who came in through
      an introduction, without the "contacted" box ever being ticked, is a lead
      further along than CONTACTED — and reporting CONTACTED because a checkbox
      is unticked would understate it.
    */
    const { stage, because } = deriveStage(
      { ...blank(), codesIssued: 1, lastCodeIssuedAt: at(-4) },
      NOW,
    )
    expect(stage).toBe('CODE_SENT')
    expect(because).toContain('never used')
  })

  it('TOURED once one is redeemed', () => {
    const { stage, because } = deriveStage(
      { ...blank(), codesIssued: 2, codesRedeemed: 1 },
      NOW,
    )
    expect(stage).toBe('TOURED')
    expect(because).toBe('1 tour code redeemed')
  })

  it('WALKTHROUGH_BOOKED for a future booking', () => {
    const { stage, because } = deriveStage({ ...blank(), walkthroughAt: at(2) }, NOW)
    expect(stage).toBe('WALKTHROUGH_BOOKED')
    expect(because).toBe('booked for 2026-08-22')
  })

  it('WALKTHROUGH_DONE once somebody says it happened', () => {
    const { stage } = deriveStage(
      { ...blank(), walkthroughAt: at(-2), walkthroughDoneAt: at(-2) },
      NOW,
    )
    expect(stage).toBe('WALKTHROUGH_DONE')
  })

  it('PROVISIONED once there is an organisation', () => {
    const { stage, because } = deriveStage({ ...blank(), provisionedOrgId: 'org-1' }, NOW)
    expect(stage).toBe('PROVISIONED')
    expect(because).toContain('administrator invited')
  })

  it('LIVE once a menu has been presented', () => {
    const { stage, because } = deriveStage(
      { ...blank(), provisionedOrgId: 'org-1', firstMenuAt: at(-1) },
      NOW,
    )
    expect(stage).toBe('LIVE')
    expect(because).toContain('first menu presented')
  })
})

describe('a booking whose time has passed', () => {
  /*
    The scope note put "future" beside WALKTHROUGH_BOOKED, and taken literally
    it means a lead sliding back to TOURED the moment its appointment time
    passes — a card moving backwards on its own, which is the single thing
    deriving the stage exists to prevent. The clock changes the sentence, not
    the stage.
  */
  it('still reads as booked, not as a regression', () => {
    const facts = { ...blank(), codesIssued: 1, codesRedeemed: 1, walkthroughAt: at(-1) }
    expect(deriveStage(facts, NOW).stage).toBe('WALKTHROUGH_BOOKED')
  })

  it('says to mark it done rather than pretending it happened', () => {
    const { because } = deriveStage({ ...blank(), walkthroughAt: at(-1) }, NOW)
    expect(because).toContain('mark it done')
  })

  it('does not read as done, because nothing observed that', () => {
    expect(deriveStage({ ...blank(), walkthroughAt: at(-30) }, NOW).stage)
      .not.toBe('WALKTHROUGH_DONE')
  })

  it('crosses the boundary on the clock alone', () => {
    const facts = { ...blank(), walkthroughAt: at(1) }
    expect(deriveStage(facts, NOW).because).toContain('booked for')
    expect(deriveStage(facts, at(2)).because).toContain('mark it done')
  })
})

describe('LOST beats everything', () => {
  it('outranks a live customer', () => {
    /*
      Deliberately not "unless they are already live". A dealership that
      signed, went live and then walked is the most important row on the page,
      and a green LIVE chip is how a churn goes unnoticed for a month.
    */
    const { stage, because } = deriveStage(
      {
        ...blank(),
        contacted: true,
        codesIssued: 2,
        codesRedeemed: 2,
        walkthroughAt: at(-20),
        walkthroughDoneAt: at(-20),
        provisionedOrgId: 'org-1',
        firstMenuAt: at(-10),
        lostAt: at(-1),
        lostReason: 'Went with Xtime.',
      },
      NOW,
    )
    expect(stage).toBe('LOST')
    expect(because).toContain('Went with Xtime.')
  })

  it('outranks nothing at all, on a lead nobody ever rang', () => {
    expect(deriveStage({ ...blank(), lostAt: at(-5) }, NOW).stage).toBe('LOST')
  })

  it('reads without a reason rather than throwing', () => {
    // The action demands one, but 0035 does not, and a row inserted by hand
    // during support must not take the console down.
    const { because } = deriveStage({ ...blank(), lostAt: at(-5) }, NOW)
    expect(because).toBe('lost 2026-08-15')
  })
})

describe('facts that skip a rung', () => {
  it('PROVISIONED with no tour code ever issued', () => {
    /*
      The regression worth pinning. Codes are optional — a dealership Dan met
      at a conference can sign without ever walking the demo — and an
      implementation that walked the ladder rung by rung would stall such a
      lead at CONTACTED while its organisation existed.
    */
    const { stage } = deriveStage(
      { ...blank(), contacted: true, provisionedOrgId: 'org-1' },
      NOW,
    )
    expect(stage).toBe('PROVISIONED')
  })

  it('PROVISIONED with nothing before it at all', () => {
    expect(deriveStage({ ...blank(), provisionedOrgId: 'org-1' }, NOW).stage).toBe('PROVISIONED')
  })

  it('LIVE without a walkthrough or a code', () => {
    expect(deriveStage({ ...blank(), provisionedOrgId: 'o', firstMenuAt: at(-2) }, NOW).stage)
      .toBe('LIVE')
  })

  it('WALKTHROUGH_DONE without a code, for a demo done over a screen share', () => {
    expect(deriveStage({ ...blank(), walkthroughDoneAt: at(-1) }, NOW).stage)
      .toBe('WALKTHROUGH_DONE')
  })

  it('stays CODE_SENT when the only code was withdrawn', () => {
    /*
      Deliberate, and the alternative is worse. `liveCodeExpiresAt` is null
      here — every code on this lead is revoked or expired — and the tempting
      reading is that the lead has fallen back to CONTACTED because there is
      nothing they can use. But the fact that proves CODE_SENT is that a code
      was sent, and that happened; un-sending it is not something the world
      can do. Withdrawing a code would otherwise move a card backwards, which
      is the one motion this whole design exists to make impossible.

      What changes is the nag, not the stage — see `nextStep` below.
    */
    const facts = { ...blank(), codesIssued: 1, lastCodeIssuedAt: at(-6), liveCodeExpiresAt: null }
    expect(deriveStage(facts, NOW).stage).toBe('CODE_SENT')
  })

  it('stays CODE_SENT when the only code quietly expired', () => {
    const facts = { ...blank(), codesIssued: 1, lastCodeIssuedAt: at(-9), liveCodeExpiresAt: null }
    expect(deriveStage(facts, NOW).stage).toBe('CODE_SENT')
  })
})

describe('the furthest fact wins, whatever order they arrived in', () => {
  /*
    The property the whole design rests on: "nobody drags cards backwards,
    because the facts do not move backwards."

    Tested over every arrival order rather than the tidy one. A single
    left-to-right walk only ever exercises the sequence a well-behaved deal
    follows, and real ones do not behave — a code gets issued after the
    walkthrough, a tenant is provisioned before anybody ticks "contacted", a
    demo is held for somebody who never touched a tour code. Seven facts is
    5,040 orders, which is nothing to brute-force and considerably more
    convincing than one.
  */
  const STEPS: [string, Partial<LeadFacts>][] = [
    ['contacted', { contacted: true, contactedAt: at(-10) }],
    ['code issued', { codesIssued: 1, lastCodeIssuedAt: at(-9), liveCodeExpiresAt: at(-2) }],
    ['code redeemed', { codesRedeemed: 1 }],
    ['walkthrough booked', { walkthroughAt: at(-5) }],
    ['walkthrough held', { walkthroughDoneAt: at(-5) }],
    ['provisioned', { provisionedOrgId: 'org-1' }],
    ['first menu', { firstMenuAt: at(-1) }],
  ]

  function permutations<T>(items: T[]): T[][] {
    if (items.length <= 1) return [items]
    return items.flatMap((item, i) =>
      permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]))
  }

  it('never regresses, in any of the 5,040 orders the facts can arrive in', () => {
    const orders = permutations(STEPS)
    // Guards the guard: a generator that returned one order would make the
    // assertion below pass while checking the same walk it replaced.
    expect(orders).toHaveLength(5_040)

    for (const order of orders) {
      let facts = blank()
      let previous = -1
      const applied: string[] = []

      for (const [label, delta] of order) {
        facts = { ...facts, ...delta }
        applied.push(label)
        const rung = stageOrder(deriveStage(facts, NOW).stage)
        // Greater than *or equal*: adding a fact behind one already recorded
        // must hold the stage still rather than pull it back. Issuing a code
        // for somebody who already toured changes nothing, and should not.
        expect(rung, applied.join(' → ')).toBeGreaterThanOrEqual(previous)
        previous = rung
      }

      // However they arrived, all seven facts mean the same thing at the end.
      expect(previous, order.map(([l]) => l).join(' → ')).toBe(LEAD_STAGES.length - 1)
    }
  })

  it('reaches a strictly further rung on the natural order', () => {
    // The complement of the permutation test: monotonicity alone is satisfied
    // by a function that never moves at all, so one walk still has to prove
    // every fact is load-bearing.
    let facts = blank()
    let previous = -1
    for (const [label, delta] of STEPS) {
      facts = { ...facts, ...delta }
      const rung = stageOrder(deriveStage(facts, NOW).stage)
      expect(rung, label).toBeGreaterThan(previous)
      previous = rung
    }
  })

  it('reaches every stage on the road', () => {
    // Guards the guard: a ladder with a rung nothing can reach is a tab that
    // is always empty and nobody notices.
    const reached = new Set<string>()
    const cases: Partial<LeadFacts>[] = [
      {},
      { contacted: true },
      { codesIssued: 1 },
      { codesRedeemed: 1 },
      { walkthroughAt: at(1) },
      { walkthroughDoneAt: at(-1) },
      { provisionedOrgId: 'o' },
      { firstMenuAt: at(-1) },
      { lostAt: at(-1) },
    ]
    for (const c of cases) reached.add(deriveStage({ ...blank(), ...c }, NOW).stage)
    expect([...ALL_LEAD_STAGES].every((s) => reached.has(s))).toBe(true)
  })
})

describe('stageOrder', () => {
  it('orders the road', () => {
    expect(stageOrder('NEW')).toBe(0)
    expect(stageOrder('LIVE')).toBe(LEAD_STAGES.length - 1)
  })

  it('puts LOST off the end rather than in the middle', () => {
    // It is not further along than anything — it is terminal. A lead lost
    // before the first call and one lost after a walkthrough are equally lost.
    expect(stageOrder('LOST')).toBe(LEAD_STAGES.length)
  })
})

describe('STAGE_LABEL', () => {
  it('names every stage', () => {
    for (const stage of ALL_LEAD_STAGES) {
      expect(STAGE_LABEL[stage]?.length ?? 0).toBeGreaterThan(2)
    }
  })
})

describe('nextStep', () => {
  it('says nothing about a lost lead', () => {
    expect(nextStep({ ...blank(), lostAt: at(-1) }, NOW)).toBeNull()
  })

  it('says nothing about a live one', () => {
    expect(nextStep({ ...blank(), provisionedOrgId: 'o', firstMenuAt: at(-1) }, NOW)).toBeNull()
  })

  it('stays quiet on a walkthrough that has not happened yet', () => {
    // The next move is the prospect's. A hint on every row is a hint nobody
    // reads, so this one only speaks when somebody here has to act.
    expect(nextStep({ ...blank(), walkthroughAt: at(2) }, NOW)).toBeNull()
  })

  it('chases a walkthrough whose time has passed', () => {
    expect(nextStep({ ...blank(), walkthroughAt: at(-1) }, NOW)).toContain('Mark it done')
  })

  it('counts the days on a code nobody opened', () => {
    const hint = nextStep(
      { ...blank(), codesIssued: 1, lastCodeIssuedAt: at(-3), liveCodeExpiresAt: at(4) },
      NOW,
    )
    expect(hint).toBe('Code issued 3d ago, never used.')
  })

  it('does not nag about a code Dan withdrew himself', () => {
    /*
      `liveCodeExpiresAt` is null once every code on the lead is revoked or
      run out. Telling him a code he pulled is "never used" reads as the
      console not having noticed, and the move it implies — chase them about
      it — is one that cannot work, because the code no longer opens anything.
    */
    const hint = nextStep(
      { ...blank(), codesIssued: 1, lastCodeIssuedAt: at(-3), liveCodeExpiresAt: null },
      NOW,
    )
    expect(hint).not.toContain('never used')
    expect(hint).toContain('issue another')
  })

  it('says the same thing about one that quietly expired', () => {
    // Withdrawn and expired differ in how the code died and not at all in
    // what happens next, and the facts cannot tell them apart anyway.
    const hint = nextStep(
      { ...blank(), codesIssued: 2, lastCodeIssuedAt: at(-9), liveCodeExpiresAt: null },
      NOW,
    )
    expect(hint).toContain('issue another')
  })

  it('escalates through the same predicate the tile counts with', () => {
    const hint = nextStep(
      { ...blank(), codesIssued: 1, lastCodeIssuedAt: at(-5), liveCodeExpiresAt: at(2) },
      NOW,
    )
    expect(hint).toContain('expires within three days')
  })

  it('does not escalate a code with a week left on it', () => {
    const hint = nextStep(
      { ...blank(), codesIssued: 1, lastCodeIssuedAt: at(-1), liveCodeExpiresAt: at(6) },
      NOW,
    )
    expect(hint).not.toContain('expires')
  })

  it('asks for a booking once they have walked the tour', () => {
    expect(nextStep({ ...blank(), codesIssued: 1, codesRedeemed: 1 }, NOW))
      .toContain('Book the walkthrough')
  })

  it('names the obvious about a lead nobody rang', () => {
    expect(nextStep(blank(), NOW)).toBe('Nobody has rung them.')
  })

  it('nudges a provisioned tenant that has never presented', () => {
    expect(nextStep({ ...blank(), provisionedOrgId: 'o' }, NOW)).toContain('no menu presented')
  })

  it('reports silence on a contacted lead nothing has happened to', () => {
    const hint = nextStep(
      { ...blank(), contacted: true, contactedAt: at(-9), lastActivityAt: at(-9) },
      NOW,
    )
    expect(hint).toBe('Nothing has happened for 9 days.')
  })

  it('stays quiet inside the window', () => {
    expect(nextStep({ ...blank(), contacted: true, contactedAt: at(-2) }, NOW)).toBeNull()
  })
})

describe('the morning read agrees with the page each tile links to', () => {
  /*
    ---------------------------------------------------------------------------
    THE INVARIANT
    ---------------------------------------------------------------------------
    Every tile on /admin is a count with a link under it, and a count that
    names leads its own destination does not show is a lie you only discover
    by clicking. Three of them were exactly that before this suite existed: an
    inline expiring-code condition with no lost or provisioned exclusion, a
    `contacted = false` aggregate under a link to the derived NEW tab, and a
    UTC calendar day under a link to a stage tab.

    So the tile predicates are asserted against the tab predicate over every
    combination of the facts that could plausibly disagree — 2^6 of them,
    enumerated rather than sampled. Sampling would find the common cases,
    which are not the ones that were broken.
  */
  const AXES: Partial<LeadFacts>[] = [
    { contacted: true, contactedAt: at(-20) },
    { codesIssued: 1, lastCodeIssuedAt: at(-2), liveCodeExpiresAt: at(1) },
    { codesRedeemed: 1 },
    { walkthroughAt: at(3) },
    { provisionedOrgId: 'org-1' },
    { lostAt: at(-1), lostReason: 'Went with Xtime.' },
  ]

  /** Every subset of the axes above, as a lead. */
  const universe: LeadFacts[] = Array.from({ length: 1 << AXES.length }, (_, mask) =>
    AXES.reduce<LeadFacts>(
      (facts, axis, i) => ((mask >> i) & 1 ? { ...facts, ...axis } : facts),
      blank(),
    ))

  it('enumerated the whole space, not a corner of it', () => {
    expect(universe).toHaveLength(64)
    // And it genuinely spans the funnel, or the assertions below prove little.
    expect(new Set(universe.map((f) => deriveStage(f, NOW).stage)).size).toBeGreaterThan(4)
  })

  it('the new-leads tile counts exactly the NEW tab', () => {
    // Equality, not containment. This tile is the stage, so anything the tab
    // shows and the tile misses is a lead nobody is being told about.
    const tile = universe.filter((f) => isNewLead(f, NOW))
    const tab = universe.filter((f) => deriveStage(f, NOW).stage === 'NEW')
    expect(tile).toEqual(tab)
  })

  it('the expiring-codes tile counts only leads on the CODE_SENT tab', () => {
    for (const facts of universe) {
      if (!hasCodeExpiringUnused(facts, NOW)) continue
      expect(deriveStage(facts, NOW).stage, JSON.stringify(facts)).toBe('CODE_SENT')
    }
  })

  it('never counts a lost lead holding a live code', () => {
    // The concrete defect: LOST beats everything, so this lead is on the LOST
    // tab, and the tile used to send whoever clicked to CODE_SENT to look for
    // a row that could not be there.
    const lostWithCode: LeadFacts = {
      ...blank(),
      contacted: true,
      contactedAt: at(-20),
      codesIssued: 1,
      lastCodeIssuedAt: at(-2),
      liveCodeExpiresAt: at(1),
      lostAt: at(-1),
      lostReason: 'Went with Xtime.',
    }
    expect(deriveStage(lostWithCode, NOW).stage).toBe('LOST')
    expect(hasCodeExpiringUnused(lostWithCode, NOW)).toBe(false)
  })

  it('never counts a provisioned lead holding a live code', () => {
    const provisionedWithCode: LeadFacts = {
      ...blank(),
      codesIssued: 1,
      lastCodeIssuedAt: at(-2),
      liveCodeExpiresAt: at(1),
      provisionedOrgId: 'org-1',
    }
    expect(hasCodeExpiringUnused(provisionedWithCode, NOW)).toBe(false)
  })

  it('never counts an uncontacted lead that already has a code as NEW', () => {
    // The other half of the same failure, from the other direction: the old
    // SQL tile counted this lead (contacted = false) and the NEW tab did not.
    const uncontactedWithCode: LeadFacts = {
      ...blank(), codesIssued: 1, lastCodeIssuedAt: at(-2), liveCodeExpiresAt: at(1),
    }
    expect(uncontactedWithCode.contacted).toBe(false)
    expect(isNewLead(uncontactedWithCode, NOW)).toBe(false)
    expect(deriveStage(uncontactedWithCode, NOW).stage).toBe('CODE_SENT')
  })

  it('counts a code that expires today and not one that expired yesterday', () => {
    const base = { ...blank(), codesIssued: 1, lastCodeIssuedAt: at(-6) }
    expect(hasCodeExpiringUnused({ ...base, liveCodeExpiresAt: at(1) }, NOW)).toBe(true)
    // Already dead is not "expiring": a tile counting those never reaches zero.
    expect(hasCodeExpiringUnused({ ...base, liveCodeExpiresAt: at(-1) }, NOW)).toBe(false)
    // And a week out is not urgent yet.
    expect(hasCodeExpiringUnused({ ...base, liveCodeExpiresAt: at(6) }, NOW)).toBe(false)
  })

  it('the quiet-leads tile never counts anything the other two do', () => {
    /*
      Not an agreement check but the companion to one. Overlapping tiles are
      how a morning read stops shortening as you work it — clearing the new
      leads should visibly move a number, not leave the same rows counted
      twice under a different heading.
    */
    for (const facts of universe) {
      if (!hasGoneQuiet(facts, NOW)) continue
      expect(isNewLead(facts, NOW), JSON.stringify(facts)).toBe(false)
    }
  })
})

describe('hasGoneQuiet', () => {
  it('is true after the window with nothing happening', () => {
    expect(hasGoneQuiet({ ...blank(), contacted: true, contactedAt: at(-QUIET_DAYS) }, NOW))
      .toBe(true)
  })

  it('is false a day inside it', () => {
    expect(hasGoneQuiet({ ...blank(), contacted: true, contactedAt: at(-QUIET_DAYS + 1) }, NOW))
      .toBe(false)
  })

  it('measures from the newest activity, not from the call', () => {
    expect(hasGoneQuiet(
      { ...blank(), contacted: true, contactedAt: at(-30), lastActivityAt: at(-1) },
      NOW,
    )).toBe(false)
  })

  it('never counts a lead nobody has ever rung', () => {
    /*
      That lead is the "Leads not contacted" tile's row. A morning read where
      two counts mean the same lead is one where clearing the first does not
      visibly shorten the second.
    */
    expect(hasGoneQuiet(blank(), NOW)).toBe(false)
  })

  it('never counts a lost, provisioned or live lead', () => {
    const stale = { ...blank(), contacted: true, contactedAt: at(-60) }
    expect(hasGoneQuiet({ ...stale, lostAt: at(-1) }, NOW)).toBe(false)
    expect(hasGoneQuiet({ ...stale, provisionedOrgId: 'o' }, NOW)).toBe(false)
    expect(hasGoneQuiet({ ...stale, firstMenuAt: at(-1) }, NOW)).toBe(false)
  })

  it('never counts a lead with a walkthrough on the books', () => {
    // Waiting for a date three weeks out is not silence, however long the gap
    // since the last call.
    expect(hasGoneQuiet(
      { ...blank(), contacted: true, contactedAt: at(-40), walkthroughAt: at(21) },
      NOW,
    )).toBe(false)
  })

  it('does count one whose walkthrough is already behind them', () => {
    expect(hasGoneQuiet(
      { ...blank(), contacted: true, contactedAt: at(-40), walkthroughAt: at(-21) },
      NOW,
    )).toBe(true)
  })
})
