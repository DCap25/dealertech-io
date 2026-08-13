import { COMPONENT_GROUPS, type ComponentGroup } from './component-groups'

/**
 * Maps free text onto the component taxonomy.
 *
 * The input is whatever the advisor actually has: a DMS op-code description
 * ("LOF - LUBE OIL FILTER"), a customer's own words ("it makes a grinding noise
 * when I brake"), or a tech's story. None of it is structured.
 *
 * Longer alias matches win, because specificity beats generality — "brake fluid
 * flush" must resolve to the fluid service, not to brake pads.
 */

export interface ResolvedComponentGroup {
  group: ComponentGroup
  /** Higher is better. Only meaningful relative to other results for the same input. */
  score: number
  /** The alias that produced the match — used to explain a decision to an advisor. */
  matchedOn: string
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
}

interface AliasPattern {
  groupKey: string
  alias: string
  pattern: RegExp
  wordCount: number
  charLength: number
  isDtc: boolean
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** OBD-II diagnostic trouble code, e.g. P0420, U0100. */
const DTC_PATTERN = /^[pbcu]\d{4}$/

/**
 * A DTC is the single most specific signal available — it names the fault
 * directly. Without this bonus a five-character code like "p0420" loses to the
 * generic six-character word "engine", which is exactly backwards.
 */
const DTC_SCORE_BONUS = 50

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[/_\-]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Builds a pattern tolerant of singular/plural on the final word, so "brake"
 * and "brakes" both hit. Customers and op codes disagree about plurals
 * constantly and it would otherwise cause silent misses.
 */
function buildPattern(normalizedAlias: string): string {
  const words = normalizedAlias.split(' ').filter(Boolean)
  const last = words[words.length - 1]
  if (!last) return escapeRegExp(normalizedAlias)

  const stem = last.length >= 4 && last.endsWith('s') ? last.slice(0, -1) : last
  const lastPattern = `${escapeRegExp(stem)}s?`

  return [...words.slice(0, -1).map(escapeRegExp), lastPattern].join(' ')
}

/** Built once at module load — a few hundred aliases, rebuilding per call is wasteful. */
const ALIAS_PATTERNS: readonly AliasPattern[] = COMPONENT_GROUPS.flatMap((g) => {
  const terms = [...g.aliases, g.label.toLowerCase()]
  return terms.map((alias) => {
    const normalized = normalize(alias)
    return {
      groupKey: g.key,
      alias,
      // Whole-token match so "cat" cannot fire inside "indicate".
      pattern: new RegExp(`(?<![a-z0-9])${buildPattern(normalized)}(?![a-z0-9])`),
      wordCount: normalized.split(' ').filter(Boolean).length,
      charLength: normalized.length,
      isDtc: DTC_PATTERN.test(normalized),
    }
  })
})

const BY_KEY = new Map(COMPONENT_GROUPS.map((g) => [g.key, g]))

/**
 * Ranked candidate groups. Returns an empty array when nothing matches — callers
 * MUST treat that as "unknown", never as "not covered".
 */
export function resolveComponentGroups(text: string, limit = 5): ResolvedComponentGroup[] {
  const haystack = normalize(text)
  if (!haystack) return []

  // Best alias hit per group.
  const best = new Map<string, { alias: string; score: number; wordCount: number }>()

  for (const { groupKey, alias, pattern, wordCount, charLength, isDtc } of ALIAS_PATTERNS) {
    if (!pattern.test(haystack)) continue
    // Specificity: character length, a strong bonus per additional word, and a
    // dominating bonus for an exact diagnostic trouble code.
    const score = charLength + (wordCount - 1) * 12 + (isDtc ? DTC_SCORE_BONUS : 0)
    const current = best.get(groupKey)
    if (!current || score > current.score) {
      best.set(groupKey, { alias, score, wordCount })
    }
  }

  const results: ResolvedComponentGroup[] = []
  for (const [groupKey, { alias, score }] of best) {
    const group = BY_KEY.get(groupKey)
    if (!group) continue
    results.push({ group, score, matchedOn: alias, confidence: 'LOW' })
  }

  results.sort((a, b) => b.score - a.score || a.group.key.localeCompare(b.group.key))

  const top = results[0]
  if (top) {
    const runnerUp = results[1]
    const multiWord = normalize(top.matchedOn).split(' ').length > 1
    if (!runnerUp) {
      // Unambiguous: nothing else in the taxonomy matched at all.
      top.confidence = multiWord ? 'HIGH' : 'MEDIUM'
    } else {
      const margin = top.score - runnerUp.score
      top.confidence = multiWord && margin >= 8 ? 'HIGH' : margin >= 8 ? 'MEDIUM' : 'LOW'
    }
  }

  return results.slice(0, limit)
}

/** Single best match, or undefined when the text resolves to nothing known. */
export function resolveComponentGroup(text: string): ResolvedComponentGroup | undefined {
  return resolveComponentGroups(text, 1)[0]
}
