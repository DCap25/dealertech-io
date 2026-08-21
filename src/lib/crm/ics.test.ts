import { describe, expect, it } from 'vitest'
import {
  buildWalkthroughIcs, escapeIcsText, foldIcsLine, icsFilename, icsTimestamp,
} from './ics'

/**
 * A calendar file is a format, and a format is either right or unimportable.
 *
 * There is no browser in this test run and no calendar to try the output in,
 * so the assertions are against RFC 5545 directly: CRLF everywhere, the four
 * escapes, folding measured in octets, and UTC timestamps with no separators.
 * Every one of these has a failure mode where the file imports as nothing at
 * all, silently, which is indistinguishable from the download button being
 * broken.
 */

const START = new Date('2026-08-25T19:00:00.000Z')
const STAMP = new Date('2026-08-20T09:30:15.000Z')

function invite(overrides: Partial<Parameters<typeof buildWalkthroughIcs>[0]> = {}) {
  return buildWalkthroughIcs({
    uid: 'walkthrough-lead-1@dealertech.io',
    start: START,
    durationMinutes: 45,
    summary: 'DealerTech walkthrough — Lone Star Ford',
    description: 'Ray Delgado · ray@lonestar.test',
    stamp: STAMP,
    sequence: 0,
    ...overrides,
  })
}

describe('icsTimestamp', () => {
  it('is UTC with the separators stripped', () => {
    expect(icsTimestamp(START)).toBe('20260825T190000Z')
  })

  it('drops milliseconds, which the format has no field for', () => {
    expect(icsTimestamp(new Date('2026-01-02T03:04:05.678Z'))).toBe('20260102T030405Z')
  })

  it('is exactly sixteen characters, always', () => {
    // A parser reading fixed offsets is entitled to that, and a stray
    // millisecond would push the Z out of position.
    expect(icsTimestamp(new Date('2026-12-31T23:59:59.999Z'))).toHaveLength(16)
  })
})

describe('escapeIcsText', () => {
  it('escapes a comma, which is a delimiter inside a value', () => {
    // Unescaped, a dealership called "Hill Country BMW, Austin" truncates its
    // own summary at the comma.
    expect(escapeIcsText('Hill Country BMW, Austin')).toBe('Hill Country BMW\\, Austin')
  })

  it('escapes a semicolon', () => {
    expect(escapeIcsText('a;b')).toBe('a\\;b')
  })

  it('turns newlines into the literal escape', () => {
    expect(escapeIcsText('one\ntwo')).toBe('one\\ntwo')
    expect(escapeIcsText('one\r\ntwo')).toBe('one\\ntwo')
    expect(escapeIcsText('one\rtwo')).toBe('one\\ntwo')
  })

  it('escapes the backslash first, so it does not double its own escapes', () => {
    /*
      The ordering bug this pins: escaping the delimiters before the backslash
      turns the backslash that step just inserted into `\\,` — two escapes
      where there should be one, and a comma that appears literally in the
      calendar entry.
    */
    expect(escapeIcsText('a\\b,c')).toBe('a\\\\b\\,c')
  })

  it('leaves ordinary text alone, accents included', () => {
    expect(escapeIcsText('Renée — 45 min')).toBe('Renée — 45 min')
  })
})

describe('foldIcsLine', () => {
  it('leaves a short line untouched', () => {
    expect(foldIcsLine('SUMMARY:short')).toBe('SUMMARY:short')
  })

  it('folds at 75 octets with a leading space on the continuation', () => {
    const line = `SUMMARY:${'x'.repeat(200)}`
    const folded = foldIcsLine(line)
    const parts = folded.split('\r\n')

    expect(parts.length).toBeGreaterThan(1)
    expect(parts[0]).toHaveLength(75)
    for (const part of parts.slice(1)) expect(part.startsWith(' ')).toBe(true)
  })

  it('never exceeds the octet limit on any line', () => {
    const encoder = new TextEncoder()
    const folded = foldIcsLine(`DESCRIPTION:${'ü'.repeat(300)}`)
    for (const part of folded.split('\r\n')) {
      expect(encoder.encode(part).length).toBeLessThanOrEqual(75)
    }
  })

  it('counts octets rather than characters', () => {
    /*
      The distinction stops being pedantic the moment a name has an accent in
      it. A limit counted in characters lets a line of two-byte code points run
      to 150 octets, which strict parsers reject.
    */
    const line = `X:${'é'.repeat(60)}`
    expect(line.length).toBeLessThan(75)
    expect(new TextEncoder().encode(line).length).toBeGreaterThan(75)
    expect(foldIcsLine(line)).toContain('\r\n ')
  })

  it('never splits a multi-byte character in half', () => {
    const folded = foldIcsLine(`X:${'é'.repeat(200)}`)
    // A broken sequence survives the round trip as U+FFFD.
    expect(folded).not.toContain('�')
    expect(folded.replace(/\r\n /g, '')).toBe(`X:${'é'.repeat(200)}`)
  })

  it('rejoins to exactly the original', () => {
    const line = `DESCRIPTION:${'word '.repeat(60)}`
    expect(foldIcsLine(line).replace(/\r\n /g, '')).toBe(line)
  })
})

describe('buildWalkthroughIcs', () => {
  it('ends every line with CRLF, including the last', () => {
    /*
      RFC 5545 §3.1. Enough parsers are strict about it that a file with bare
      newlines imports as nothing at all, which looks exactly like the button
      not working.
    */
    const ics = invite()
    expect(ics.endsWith('\r\n')).toBe(true)
    expect(ics.replace(/\r\n/g, '')).not.toContain('\n')
  })

  it('opens and closes the calendar and the event', () => {
    const ics = invite()
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics).toContain('BEGIN:VEVENT\r\n')
    expect(ics).toContain('END:VEVENT\r\n')
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true)
  })

  it('carries the required properties', () => {
    const ics = invite()
    for (const key of ['VERSION:2.0', 'PRODID:', 'UID:', 'DTSTAMP:', 'DTSTART:', 'SUMMARY:']) {
      expect(ics, key).toContain(key)
    }
  })

  it('computes DTEND from the duration', () => {
    expect(invite()).toContain('DTEND:20260825T194500Z')
  })

  it('handles a duration that crosses midnight', () => {
    // Not a walkthrough anybody will book, but the arithmetic must not be
    // same-day arithmetic.
    expect(invite({ start: new Date('2026-08-25T23:30:00.000Z'), durationMinutes: 45 }))
      .toContain('DTEND:20260826T001500Z')
  })

  it('publishes rather than requesting, because nobody is being invited', () => {
    // A REQUEST with no ORGANIZER and no ATTENDEE is the sort of file that
    // makes Outlook ask questions it has no answer for.
    const ics = invite()
    expect(ics).toContain('METHOD:PUBLISH')
    expect(ics).not.toContain('ATTENDEE')
  })

  it('escapes a dealership name with a comma in it', () => {
    const ics = invite({ summary: 'Walkthrough — Hill Country BMW, Austin' })
    expect(ics).toContain('SUMMARY:Walkthrough — Hill Country BMW\\, Austin')
  })

  it('turns a multi-line description into one folded property', () => {
    const ics = invite({ description: 'Ray Delgado\nLead: /admin/leads/abc' })
    expect(ics).toContain('DESCRIPTION:Ray Delgado\\nLead: /admin/leads/abc')
  })

  it('keeps the UID stable so a rebooking replaces the entry', () => {
    const first = invite({ start: new Date('2026-08-25T19:00:00.000Z') })
    const moved = invite({ start: new Date('2026-08-27T15:00:00.000Z') })
    const uid = (s: string) => s.split('\r\n').find((l) => l.startsWith('UID:'))
    expect(uid(first)).toBe(uid(moved))
    expect(first).not.toBe(moved)
  })

  it('is byte-for-byte deterministic for the same input', () => {
    // Nothing in here reads a clock; every varying value is a parameter, which
    // is what makes the output assertable at all.
    expect(invite()).toBe(invite())
  })

  it('stays comfortably inside a server action response', () => {
    expect(invite().length).toBeLessThan(1024)
  })
})

describe('icsFilename', () => {
  it('slugifies the dealership', () => {
    expect(icsFilename('Lone Star Ford')).toBe('walkthrough-lone-star-ford.ics')
  })

  it('collapses punctuation to hyphens rather than dropping it', () => {
    // "Hill Country BMW" and "HillCountryBMW" are two dealerships, and
    // dropping the separators would collide them on one filename.
    expect(icsFilename('Hill Country BMW, Austin')).toBe('walkthrough-hill-country-bmw-austin.ics')
  })

  it('survives a name with nothing usable in it', () => {
    expect(icsFilename('!!!')).toBe('walkthrough-dealership.ics')
    expect(icsFilename('')).toBe('walkthrough-dealership.ics')
  })

  it('does not run away on a very long name', () => {
    expect(icsFilename('a'.repeat(200)).length).toBeLessThan(60)
  })
})
