import { describe, expect, it } from 'vitest'
import {
  buildMenu, defaultSelection, excludeAll, includeAll, isIncluded, menuWarnings, move,
  presentableItems, tierOf, toggle,
} from './selection'
import type { Opportunity } from '@/lib/prep-sheet'

function opp(over: Partial<Opportunity> = {}): Opportunity {
  return {
    id: 'o1',
    type: 'MAINTENANCE_DUE',
    title: 'Oil & filter change',
    detail: 'Due at 60k.',
    estimatedAmount: 84,
    customerOutOfPocket: 84,
    likelyPayer: 'CUSTOMER_PAY',
    urgency: 'MEDIUM',
    closeProbability: 0.5,
    priorityScore: 50,
    talkTrack: 'Say the thing.',
    ...over,
  }
}

const SAFETY = opp({ id: 'safety', title: 'Front brakes at 3mm', urgency: 'SAFETY', priorityScore: 99 })
const HIGH = opp({ id: 'high', title: 'Tyres approaching', urgency: 'HIGH', priorityScore: 80 })
const HIGH_2 = opp({ id: 'high2', title: 'Transmission service', urgency: 'HIGH', priorityScore: 70 })
const LOW = opp({ id: 'low', title: 'Cabin filter', urgency: 'LOW', priorityScore: 10 })

const ALL = [SAFETY, HIGH, HIGH_2, LOW]

describe('tierOf', () => {
  it('maps measured urgency onto the three tiers', () => {
    expect(tierOf(SAFETY)).toBe('NOW')
    expect(tierOf(HIGH)).toBe('SOON')
    expect(tierOf(LOW)).toBe('PLANNED')
    expect(tierOf(opp({ urgency: 'MEDIUM' }))).toBe('PLANNED')
  })
})

describe('defaultSelection', () => {
  it('includes everything presentable, most urgent first', () => {
    // Opt-out, not opt-in. An advisor who taps straight through gets the menu
    // the product produced before this step existed.
    const selection = defaultSelection(ALL)
    expect(selection.includedIds).toEqual(['safety', 'high', 'high2', 'low'])
  })

  it('leaves out anything already skipped in the advisor view', () => {
    const selection = defaultSelection(ALL, ['high'])
    expect(selection.includedIds).toEqual(['safety', 'high2', 'low'])
  })

  it('ranks by priority within a tier', () => {
    const selection = defaultSelection([HIGH_2, HIGH])
    expect(selection.includedIds).toEqual(['high', 'high2'])
  })

  it('leaves unverified interval services off the customer menu', () => {
    // "We have no record of this" and "you are due for this" are different
    // statements. An old car with no history carries half a dozen of the
    // former, and defaulting them on hands the customer a page of guesses.
    const unverified = opp({ id: 'guess', urgency: 'LOW', unverified: true })
    const selection = defaultSelection([...ALL, unverified])
    expect(selection.includedIds).not.toContain('guess')
    expect(selection.includedIds).toEqual(['safety', 'high', 'high2', 'low'])
  })

  it('keeps a price the dealership cannot bill off the customer menu', () => {
    // The reason the price book is pulled every morning: quoting $84 and
    // invoicing $106 is the argument this product exists to prevent, and it
    // does not matter that our estimate was reasonable.
    const unpriced = opp({ id: 'guessed', urgency: 'HIGH', priceSource: 'ESTIMATE' })
    const selection = defaultSelection([...ALL, unpriced])
    expect(selection.includedIds).not.toContain('guessed')
  })

  it('keeps a price that came from the store', () => {
    const priced = opp({ id: 'real', urgency: 'HIGH', priceSource: 'STORE' })
    expect(defaultSelection([priced]).includedIds).toContain('real')
  })

  it('does not exclude items from an integration with no price book at all', () => {
    // priceSource is absent when nothing was resolved either way. Treating
    // that as "unpriced" would empty the menu on every integration that has
    // no price book endpoint.
    const noBook = opp({ id: 'nobook', urgency: 'HIGH' })
    expect(defaultSelection([noBook]).includedIds).toContain('nobook')
  })

  it('still offers them in the builder for the advisor to tick', () => {
    // Off by default is not hidden. The advisor sees it, asks the customer,
    // and adds it — which is the conversation the flag exists to force.
    const unverified = opp({ id: 'guess', urgency: 'LOW', unverified: true })
    const all = presentableItems([...ALL, unverified])
    expect(all.map((i) => i.opportunity.id)).toContain('guess')

    const menu = buildMenu([...ALL, unverified], toggle(defaultSelection([...ALL, unverified]), 'guess'))
    expect(menu.items.map((i) => i.opportunity.id)).toContain('guess')
  })
})

describe('toggle', () => {
  it('removes and restores an item', () => {
    const start = defaultSelection(ALL)
    const without = toggle(start, 'high')
    expect(isIncluded(without, 'high')).toBe(false)
    expect(isIncluded(toggle(without, 'high'), 'high')).toBe(true)
  })
})

describe('move', () => {
  const items = presentableItems(ALL)

  it('reorders within a tier', () => {
    const start = defaultSelection(ALL)
    const moved = move(start, items, 'high2', -1)
    expect(moved.includedIds).toEqual(['safety', 'high2', 'high', 'low'])
  })

  it('refuses to cross a tier boundary', () => {
    // Tier comes from a measurement. An advisor who could promote an item
    // into "needs attention now" would empty that tier of meaning, and the
    // customer would be right to stop believing it.
    const start = defaultSelection(ALL)
    const attempted = move(start, items, 'high', -1)
    expect(attempted.includedIds).toEqual(start.includedIds)
  })

  it('does nothing at the ends of the list', () => {
    const start = defaultSelection(ALL)
    expect(move(start, items, 'safety', -1).includedIds).toEqual(start.includedIds)
    expect(move(start, items, 'low', 1).includedIds).toEqual(start.includedIds)
  })

  it('ignores an id that is not in the selection', () => {
    const start = excludeAll()
    expect(move(start, items, 'high', -1)).toEqual(start)
  })
})

describe('buildMenu', () => {
  it('groups by tier and keeps the advisor’s order inside each', () => {
    const selection = move(defaultSelection(ALL), presentableItems(ALL), 'high2', -1)
    const menu = buildMenu(ALL, selection)

    expect(menu.tiers.map((t) => t.tier)).toEqual(['NOW', 'SOON', 'PLANNED'])
    expect(menu.tiers[1]!.items.map((i) => i.opportunity.id)).toEqual(['high2', 'high'])
  })

  it('drops a tier with nothing in it rather than printing an empty heading', () => {
    const menu = buildMenu(ALL, { includedIds: ['low'] })
    expect(menu.tiers.map((t) => t.tier)).toEqual(['PLANNED'])
  })

  it('reports what was left off', () => {
    const menu = buildMenu(ALL, { includedIds: ['safety'] })
    expect(menu.excluded.map((i) => i.opportunity.id)).toEqual(['high', 'high2', 'low'])
  })

  it('totals only what is on the menu', () => {
    const covered = opp({ id: 'covered', estimatedAmount: 200, customerOutOfPocket: 0 })
    const menu = buildMenu([...ALL, covered], { includedIds: ['low', 'covered'] })
    expect(menu.customerTotal).toBe(84)
    expect(menu.coveredTotal).toBe(200)
  })

  it('survives a selection referring to something no longer on the sheet', () => {
    // A prep sheet can be rebuilt underneath a stale selection.
    const menu = buildMenu(ALL, { includedIds: ['safety', 'deleted-item'] })
    expect(menu.items.map((i) => i.opportunity.id)).toEqual(['safety'])
  })

  it('says when there is nothing to present', () => {
    const menu = buildMenu(ALL, excludeAll())
    expect(menu.isEmpty).toBe(true)
    expect(buildMenu(ALL, includeAll(presentableItems(ALL))).isEmpty).toBe(false)
  })
})

describe('menuWarnings', () => {
  it('says so when a safety item was left off', () => {
    const menu = buildMenu(ALL, { includedIds: ['low'] })
    expect(menuWarnings(menu).join(' ')).toMatch(/Front brakes at 3mm is a safety item/)
  })

  it('says so when something free to the customer was left off', () => {
    const covered = opp({ id: 'covered', customerOutOfPocket: 0, title: 'Prepaid oil change' })
    const menu = buildMenu([...ALL, covered], { includedIds: ['safety'] })
    expect(menuWarnings(menu).join(' ')).toMatch(/owes nothing for/)
  })

  it('stays quiet on a complete menu', () => {
    const menu = buildMenu(ALL, defaultSelection(ALL))
    expect(menuWarnings(menu)).toEqual([])
  })

  it('warns rather than blocks', () => {
    // An advisor has reasons we do not know about — already declined in the
    // lane, going on a different visit. A system that refuses to proceed
    // teaches them to work around it.
    const menu = buildMenu(ALL, { includedIds: [] })
    expect(menuWarnings(menu).length).toBeGreaterThan(0)
    expect(menu.isEmpty).toBe(true)
  })
})
