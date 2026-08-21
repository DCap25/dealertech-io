/**
 * One calendar event, as a file.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS FORTY LINES OF STRING BUILDING AND NOT A CALENDAR INTEGRATION
 * ---------------------------------------------------------------------------
 * The alternative was Calendly, or a Google Calendar OAuth flow, to put one
 * booking in one man's diary. Either is a fifth subprocessor, a trust-page
 * change and a token to look after, for a feature whose entire job is making a
 * datetime land in the calendar app that is already open. RFC 5545 is a text
 * format; this writes it.
 *
 * Pure and I/O-free — no clock, no crypto, no database. Everything varying is
 * a parameter, which is what makes the output testable byte for byte.
 *
 * ---------------------------------------------------------------------------
 * THE PARTS THAT ARE EASY TO GET WRONG
 * ---------------------------------------------------------------------------
 * CRLF, always. RFC 5545 §3.1 says lines end with CRLF and enough parsers are
 * strict about it that a file with bare newlines imports as nothing at all,
 * silently, which looks exactly like the download button not working.
 *
 * Escaping. Backslash, semicolon and comma are delimiters inside a property
 * value and a newline is written as a literal `\n`. A dealership called
 * "Hill Country BMW, Austin" would otherwise truncate its own summary at the
 * comma, and the escape of the backslash has to happen first or it doubles the
 * escapes it just added.
 *
 * Folding at 75 octets. Long descriptions are legal only when folded, and the
 * continuation line has to start with a single space. Counted in UTF-8 bytes
 * rather than characters, because the limit is on octets and a name with an
 * accent in it is where that distinction stops being pedantic.
 */

export interface WalkthroughInvite {
  /**
   * Stable across rebookings, so an updated invitation replaces the one
   * already in the calendar instead of leaving two.
   *
   * The lead id is the natural key: one lead has one walkthrough on the books
   * at a time, and rebooking overwrites the datetime on that same row.
   */
  uid: string
  /** When it starts. Written in UTC — see `SEQUENCE` below on timezones. */
  start: Date
  /** How long to block out. */
  durationMinutes: number
  summary: string
  description: string
  /** Written into DTSTAMP: when this file was produced. */
  stamp: Date
  /**
   * Bumped on every rebooking so a calendar accepts the replacement.
   *
   * A calendar client that already holds SEQUENCE:0 for this UID will ignore a
   * second copy at the same sequence — which is exactly what a rebooked
   * walkthrough would look like, and the symptom is a diary still showing
   * Tuesday after somebody moved it to Thursday.
   */
  sequence: number
}

/** RFC 5545 date-time in UTC: 20260820T140000Z. */
export function icsTimestamp(d: Date): string {
  return `${d.toISOString().slice(0, 19).replace(/[-:]/g, '')}Z`
}

/**
 * Escape a text property value.
 *
 * Backslash first. Escaping the delimiters before the backslash would turn the
 * backslash this function just inserted into something it escapes again.
 */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
}

/**
 * Fold a content line to 75 octets, continuation lines prefixed with a space.
 *
 * Measured in UTF-8 bytes and split on whole code points, so a multi-byte
 * character is never cut in half — a broken sequence makes the whole file
 * unparseable in some clients and renders as a replacement character in the
 * rest.
 */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder()
  if (encoder.encode(line).length <= 75) return line

  const out: string[] = []
  let current = ''
  let bytes = 0
  // 74 on continuation lines: the leading space counts toward the 75.
  let limit = 75

  for (const char of line) {
    const size = encoder.encode(char).length
    if (bytes + size > limit) {
      out.push(current)
      current = ''
      bytes = 0
      limit = 74
    }
    current += char
    bytes += size
  }
  if (current) out.push(current)

  return out.map((part, i) => (i === 0 ? part : ` ${part}`)).join('\r\n')
}

/**
 * The whole file.
 *
 * `PRODID` names this application rather than a library, which is the honest
 * answer and also what appears in a calendar's "imported from" line.
 * `METHOD:PUBLISH` rather than `REQUEST`: nobody is being invited, there are no
 * attendees, and a REQUEST with no ORGANIZER is the sort of file that makes
 * Outlook ask questions it has no answer for.
 */
export function buildWalkthroughIcs(invite: WalkthroughInvite): string {
  const end = new Date(invite.start.getTime() + invite.durationMinutes * 60_000)

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//DealerTech//Walkthrough//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${invite.uid}`,
    `SEQUENCE:${invite.sequence}`,
    `DTSTAMP:${icsTimestamp(invite.stamp)}`,
    `DTSTART:${icsTimestamp(invite.start)}`,
    `DTEND:${icsTimestamp(end)}`,
    `SUMMARY:${escapeIcsText(invite.summary)}`,
    `DESCRIPTION:${escapeIcsText(invite.description)}`,
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
  ]

  // Trailing CRLF: the last line is a content line like any other, and a file
  // ending mid-line is rejected by strict parsers.
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`
}

/**
 * A filename a calendar app will not argue with.
 *
 * Everything outside the safe set collapses to a hyphen rather than being
 * dropped, so "Hill Country BMW" does not become "HillCountryBMW" and two
 * different dealerships cannot collide on one name.
 */
export function icsFilename(dealershipName: string): string {
  const base = dealershipName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return `walkthrough-${base || 'dealership'}.ics`
}
