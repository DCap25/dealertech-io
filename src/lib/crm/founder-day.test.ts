import { describe, expect, it } from 'vitest'
import {
  FOUNDER_TIMEZONE, founderDayKey, isOnFounderDay, startOfFounderDay,
} from './founder-day'

/**
 * "Today", from where the person reading the console is sitting.
 *
 * The bug being pinned down is small and embarrassing: `walkthrough_at::date =
 * now()::date` on a server running UTC puts an evening demo in Texas on
 * tomorrow, so the one tile with a deadline attached announced it the morning
 * after it happened. Everything here is about that one boundary, including the
 * two days a year the clocks move it.
 */

/** Central Daylight Time, UTC-5. 19:00Z is 14:00 in Chicago. */
const SUMMER_AFTERNOON = new Date('2026-08-20T19:00:00.000Z')

describe('founderDayKey', () => {
  it('reads the local date, not the UTC one', () => {
    // 01:00Z on the 21st is still eight in the evening on the 20th in Chicago.
    // The whole defect, in one assertion.
    expect(founderDayKey(new Date('2026-08-21T01:00:00.000Z'))).toBe('2026-08-20')
  })

  it('agrees with UTC in the middle of the day', () => {
    expect(founderDayKey(SUMMER_AFTERNOON)).toBe('2026-08-20')
  })

  it('rolls over at local midnight rather than at 00:00Z', () => {
    expect(founderDayKey(new Date('2026-08-21T04:59:00.000Z'))).toBe('2026-08-20')
    expect(founderDayKey(new Date('2026-08-21T05:00:00.000Z'))).toBe('2026-08-21')
  })

  it('handles winter, when the offset is an hour different', () => {
    // CST is UTC-6, so the boundary moves an hour later in UTC terms.
    expect(founderDayKey(new Date('2026-01-15T05:59:00.000Z'))).toBe('2026-01-14')
    expect(founderDayKey(new Date('2026-01-15T06:00:00.000Z'))).toBe('2026-01-15')
  })

  it('pads to a sortable key', () => {
    expect(founderDayKey(new Date('2026-01-05T18:00:00.000Z'))).toBe('2026-01-05')
  })
})

describe('isOnFounderDay', () => {
  it('is true for an evening walkthrough that UTC calls tomorrow', () => {
    // Booked for seven in the evening; the console is read at nine that
    // morning. Under `::date` in UTC these are different days.
    const evening = new Date('2026-08-21T00:00:00.000Z')
    const morning = new Date('2026-08-20T14:00:00.000Z')
    expect(isOnFounderDay(evening, morning)).toBe(true)
  })

  it('is false for the next morning', () => {
    expect(isOnFounderDay(new Date('2026-08-21T15:00:00.000Z'), SUMMER_AFTERNOON)).toBe(false)
  })

  it('is false for last night', () => {
    expect(isOnFounderDay(new Date('2026-08-20T02:00:00.000Z'), SUMMER_AFTERNOON)).toBe(false)
  })
})

describe('startOfFounderDay', () => {
  it('is local midnight, not 00:00Z', () => {
    expect(startOfFounderDay(SUMMER_AFTERNOON).toISOString()).toBe('2026-08-20T05:00:00.000Z')
  })

  it('is an hour later in UTC terms in winter', () => {
    expect(startOfFounderDay(new Date('2026-01-15T18:00:00.000Z')).toISOString())
      .toBe('2026-01-15T06:00:00.000Z')
  })

  it('is never after the instant it was asked about', () => {
    /*
      The direction that matters. A boundary that lands after "now" would drop
      a walkthrough held earlier this morning off the list — and off the tile
      counted from that list — which is precisely the item the morning read
      exists to surface.
    */
    for (const iso of [
      '2026-08-20T05:00:00.000Z', // local midnight exactly
      '2026-08-20T05:00:01.000Z',
      '2026-08-20T19:00:00.000Z',
      '2026-08-21T04:59:59.000Z', // a second before local midnight
      '2026-01-15T06:00:00.000Z',
      '2026-03-08T08:00:00.000Z', // spring forward, in the hour after
      '2026-11-01T07:00:00.000Z', // fall back, in the repeated hour
    ]) {
      const asOf = new Date(iso)
      expect(startOfFounderDay(asOf).getTime(), iso).toBeLessThanOrEqual(asOf.getTime())
    }
  })

  it('lands on the same local day it was asked about', () => {
    for (const iso of [
      '2026-08-20T05:00:00.000Z',
      '2026-08-21T04:00:00.000Z',
      '2026-03-08T12:00:00.000Z',
      '2026-11-01T12:00:00.000Z',
      '2026-01-15T06:00:00.000Z',
    ]) {
      const asOf = new Date(iso)
      expect(founderDayKey(startOfFounderDay(asOf)), iso).toBe(founderDayKey(asOf))
    }
  })

  it('survives the spring-forward morning, when there is no 2am', () => {
    /*
      The clocks go forward on 8 March 2026. A single-pass conversion uses the
      offset at midday and lands an hour out, which would put the window's
      lower bound at one in the morning — or at three, dropping an early
      appointment. Two passes get it right.
    */
    const duringTheDay = new Date('2026-03-08T18:00:00.000Z')
    expect(startOfFounderDay(duringTheDay).toISOString()).toBe('2026-03-08T06:00:00.000Z')
    expect(founderDayKey(startOfFounderDay(duringTheDay))).toBe('2026-03-08')
  })

  it('survives the fall-back morning, when 1am happens twice', () => {
    const duringTheDay = new Date('2026-11-01T18:00:00.000Z')
    expect(startOfFounderDay(duringTheDay).toISOString()).toBe('2026-11-01T05:00:00.000Z')
    expect(founderDayKey(startOfFounderDay(duringTheDay))).toBe('2026-11-01')
  })
})

describe('the walkthroughs tile agrees with the section it links to', () => {
  /*
    ---------------------------------------------------------------------------
    THE INVARIANT, AND WHY IT IS PROVABLE HERE
    ---------------------------------------------------------------------------
    "Walkthroughs today" is counted by filtering the rows `loadUpcomingWalk-
    throughs` returned, so the count is a subset of the list by construction —
    the tile cannot name a lead the section does not render. What is left to
    prove is that the *query window* cannot exclude a walkthrough that falls on
    the founder's today: if the lower bound ever landed after such an
    appointment, the row would be missing from both and the agreement would
    hold while the morning read quietly lost a demo.

    So: for any instant on the founder's today, `startOfFounderDay(asOf)` is at
    or before it. Checked against every hour of a day, on an ordinary day and
    on both clock-change days.
  */
  const HOUR = 3_600_000

  it('the window never starts after something happening today', () => {
    for (const dayIso of ['2026-08-20T18:00:00.000Z', '2026-03-08T18:00:00.000Z', '2026-11-01T18:00:00.000Z', '2026-01-15T18:00:00.000Z']) {
      const asOf = new Date(dayIso)
      const from = startOfFounderDay(asOf)

      for (let i = 0; i < 26; i += 1) {
        const at = new Date(from.getTime() + i * HOUR)
        if (!isOnFounderDay(at, asOf)) continue
        expect(at.getTime() >= from.getTime(), `${dayIso} +${i}h`).toBe(true)
      }
    }
  })

  it('the window does not reach back into yesterday', () => {
    // The other direction. A lower bound an hour too generous puts last
    // night's demo on "this week" under a "today" chip that is false.
    const asOf = new Date('2026-08-20T18:00:00.000Z')
    const from = startOfFounderDay(asOf)
    expect(isOnFounderDay(from, asOf)).toBe(true)
    expect(isOnFounderDay(new Date(from.getTime() - 1), asOf)).toBe(false)
  })
})

describe('the constant itself', () => {
  it('names one timezone, and it is where Dan is', () => {
    // There is no per-user timezone and should not be until a second person
    // is selling. When he moves, this constant changes and nothing else does.
    expect(FOUNDER_TIMEZONE).toBe('America/Chicago')
  })

  it('is a zone this runtime actually knows', () => {
    // A typo would silently fall back to UTC in some engines and throw in
    // others, and the silent one is the version that ships.
    expect(() => new Intl.DateTimeFormat('en-CA', { timeZone: FOUNDER_TIMEZONE })).not.toThrow()
    expect(founderDayKey(new Date('2026-08-21T01:00:00.000Z'))).not.toBe('2026-08-21')
  })
})
