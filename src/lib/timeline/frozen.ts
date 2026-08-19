import {
  sanitizeDecisions, type Decision, type PresentedItem,
} from '@/lib/presentation/decisions'
import type { TimelinePresentation } from './types'

/**
 * Reading a presentation back off its own row.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS DEFENSIVE
 * ---------------------------------------------------------------------------
 * `snapshot`, `authorized_snapshot` and `decisions` are jsonb. What is in them
 * was written by a version of the snapshot builder that may be months old, and
 * a timeline is precisely the surface that reads the oldest rows in the table.
 * So every field is checked rather than cast — a row from before a field
 * existed renders with less to say instead of throwing on the customer record.
 *
 * ---------------------------------------------------------------------------
 * WHY `authorizedSnapshot` WINS
 * ---------------------------------------------------------------------------
 * `decisions` keeps moving after an authorisation — a customer can reopen the
 * link and tap something else — while `authorized_snapshot` is the frozen copy
 * of what was on the screen at the moment they put their name to it. The
 * timeline's claim is "authorised by Betty Lewis", so it has to be counted from
 * what Betty actually authorised, not from what the row says now. That is the
 * same rule `latestAuthorization` follows for the DMS note, for the same
 * reason, and the two must not be able to disagree.
 *
 * Pure and I/O-free.
 */

export interface FrozenPresentation {
  items: PresentedItem[]
  decisions: Record<string, Decision>
  /** True when the answers were read from the authorisation rather than live. */
  fromAuthorisation: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function money(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * The items a snapshot froze, flattened out of its tiers.
 *
 * Exported because the threads builder needs the same list and must not grow a
 * second, subtly different reader of the same column.
 */
export function itemsOfSnapshot(snapshot: unknown): PresentedItem[] {
  if (!isRecord(snapshot)) return []
  const tiers = snapshot.tiers
  if (!Array.isArray(tiers)) return []

  const items: PresentedItem[] = []
  for (const tier of tiers) {
    if (!isRecord(tier) || !Array.isArray(tier.items)) continue
    for (const raw of tier.items) {
      if (!isRecord(raw)) continue
      const id = str(raw.id)
      const title = str(raw.title)
      // An item with no id cannot be matched to a decision, and one with no
      // title cannot be read out loud. Either way there is nothing to render.
      if (!id || !title) continue
      items.push({
        id,
        title,
        customerOutOfPocket: money(raw.customerOutOfPocket),
        // `!== false` matches every surface that decides what a customer sees:
        // a snapshot written before the field existed showed its price.
        priceConfirmed: raw.priceConfirmed !== false,
      })
    }
  }
  return items
}

export function readPresentation(row: TimelinePresentation): FrozenPresentation {
  const frozen = isRecord(row.authorizedSnapshot) ? row.authorizedSnapshot : null

  const items = itemsOfSnapshot(frozen?.snapshot ?? row.snapshot)
  const rawDecisions = frozen ? frozen.decisions : row.decisions

  return {
    items,
    // Validated against the ids this presentation actually showed, by the same
    // tested function the tablet and the link both post through. A decision
    // against an id that was never on the menu is dropped rather than counted.
    decisions: sanitizeDecisions(items.map((i) => i.id), rawDecisions),
    fromAuthorisation: frozen !== null,
  }
}

/**
 * "on the tablet" · "to their phone" · "on paper", for the event sentence.
 *
 * Shorter than the DMS note's phrasing and deliberately so — this reads inside
 * a line of history an advisor scans, not inside a record somebody litigates —
 * but it draws the same distinction where there is one to draw.
 */
export function channelPhrase(channel: string): string {
  switch (channel) {
    case 'TABLET': return 'on the tablet'
    case 'TABLET_SELF_SERVE': return 'on the tablet, on their own'
    case 'LINK': return 'to their phone'
    case 'PRINT': return 'on paper'
    default: return `via ${channel.toLowerCase()}`
  }
}
