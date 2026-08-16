/**
 * Deciding when two records are the same record.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ITS OWN FILE
 * ---------------------------------------------------------------------------
 * These two decisions carry more consequence than their size suggests, and
 * both belong under test — which means they cannot live in `persist.ts`, which
 * is marked `server-only` and throws on import outside a server component.
 * That is not a hypothetical: the billing store hit exactly that and its CLI
 * entry point died on import while the route kept working.
 *
 * Pure and I/O-free.
 */

/**
 * The natural key that makes re-running an import safe.
 *
 * Somebody will import the same export twice — the first run half failed, or
 * the file was re-sent, or nobody remembered. Two copies of every decline
 * would show a customer the same $618 of brakes twice on one menu, which is
 * the exact credibility failure this product exists to prevent.
 *
 * Deliberately excludes the amount. The same work re-quoted at a new price is
 * still the same declined job, and including the figure would let a re-export
 * with updated pricing insert a second copy of everything.
 *
 * Day precision, not timestamp: exports vary in whether they carry a time, and
 * midnight versus 09:14 on the same date is not two declines.
 */
export function declineKey(vehicleId: string, declinedAt: Date, description: string): string {
  const day = declinedAt.toISOString().slice(0, 10)
  const normalised = description.trim().toLowerCase().replace(/\s+/g, ' ')
  return `${vehicleId}|${day}|${normalised}`
}

export interface NameParts {
  firstName: string | null
  lastName: string
}

/**
 * Split a name the way a DMS wrote it.
 *
 * `SMITH, JOHN` is far more common in an export than `John Smith`, and reading
 * it the wrong way round files every customer under their first name — which
 * makes the roster unsearchable by the one thing staff actually know.
 *
 * Last name is never null because it is what the customer list sorts and
 * searches on. A single word is taken as the surname for the same reason:
 * "Rodriguez" alone is far more likely to be a surname than a given name in a
 * dealership's records.
 */
export function nameParts(full: string): NameParts {
  const trimmed = full.trim().replace(/\s+/g, ' ')
  if (trimmed === '') return { firstName: null, lastName: 'Unknown' }

  if (trimmed.includes(',')) {
    const [last, first] = trimmed.split(',', 2)
    const lastName = (last ?? '').trim()
    const firstName = (first ?? '').trim()
    // A trailing comma with nothing after it is still just a surname.
    return {
      lastName: lastName === '' ? 'Unknown' : lastName,
      firstName: firstName === '' ? null : firstName,
    }
  }

  const words = trimmed.split(' ')
  if (words.length === 1) return { firstName: null, lastName: words[0]! }
  return {
    firstName: words.slice(0, -1).join(' '),
    lastName: words[words.length - 1]!,
  }
}
