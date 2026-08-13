import type { OpenRecall } from '@/lib/coverage'
import { resolveComponentGroups } from '@/lib/taxonomy'

/**
 * Recall lookup via NHTSA.
 *
 * CRITICAL LIMITATION — read before showing any of this to an advisor.
 *
 * NHTSA's public recall API searches by MAKE / MODEL / MODEL YEAR only. There
 * is no free VIN-level endpoint, and no remedy status: whether a specific
 * vehicle has had a given campaign performed lives with the manufacturer.
 *
 * Everything this module returns is therefore a CANDIDATE — a campaign that
 * exists for this make/model/year and may or may not still be open on this VIN.
 * Every result is flagged `isCandidate: true`, and the coverage engine
 * downgrades confidence and emits a "verify in the OEM portal" action when it
 * relies on one. Never present these as confirmed open recalls.
 */

const RECALLS_BASE = 'https://api.nhtsa.gov/recalls/recallsByVehicle'

interface NhtsaRecallRow {
  NHTSACampaignNumber?: string
  Component?: string
  Summary?: string
  Consequence?: string
  Remedy?: string
  ReportReceivedDate?: string
  Manufacturer?: string
  parkIt?: boolean
  parkOutSide?: boolean
}

export interface CandidateRecall extends OpenRecall {
  component: string
  consequence?: string
  remedy?: string
  reportReceivedDate?: string
  manufacturer?: string
  /** NHTSA "do not drive" advisory — the customer should not take the car. */
  parkIt: boolean
  /** NHTSA "park outside" advisory — fire risk while parked. */
  parkOutside: boolean
}

export interface RecallLookupResult {
  recalls: CandidateRecall[]
  errors: string[]
  /** Always populated. Callers must surface this rather than implying certainty. */
  caveat: string
}

const CAVEAT =
  'NHTSA publishes recalls by make/model/year only — not by VIN, and without remedy status. These campaigns MAY apply to this vehicle. Confirm in the OEM portal before telling the customer anything is open.'

/**
 * Minimum resolver score for a recall→component mapping.
 *
 * A recall match makes the engine declare the repair OEM-funded, so a weak
 * match here hands the advisor a free repair that does not exist. Real case:
 * campaign 16V345000 is "SERVICE BRAKES, HYDRAULIC:FLUID", and the bare word
 * "brakes" (score 6) matched Brake Pads & Shoes — turning a $600 customer-pay
 * brake job into a phantom recall.
 *
 * 10 admits specific terms like "transmission" (12) and "air bag" (19) while
 * rejecting generic system words like "brakes" (6) and "engine" (6).
 */
const MIN_RECALL_MATCH_SCORE = 10

/**
 * Maps a recall's free-text component field onto our taxonomy.
 * NHTSA components look like "POWER TRAIN:AUTOMATIC TRANSMISSION".
 *
 * Returns an empty array when nothing matches strongly enough. That is the
 * correct outcome: the campaign still shows in the recall list for the advisor
 * to read, it just does not claim to cover the operation being quoted.
 */
export function componentGroupsForRecall(component: string, summary = ''): string[] {
  const text = `${component.replace(/:/g, ' ')} ${summary}`
  return resolveComponentGroups(text, 3)
    .filter((m) => m.score >= MIN_RECALL_MATCH_SCORE)
    .map((m) => m.group.key)
}

export async function lookupCandidateRecalls(
  make: string,
  model: string,
  modelYear: number,
  fetchImpl: typeof fetch = fetch,
): Promise<RecallLookupResult> {
  const errors: string[] = []

  if (!make || !model || !modelYear) {
    return {
      recalls: [],
      errors: ['Make, model and model year are all required for a recall lookup.'],
      caveat: CAVEAT,
    }
  }

  const params = new URLSearchParams({
    make: make.toLowerCase(),
    model: model.toLowerCase(),
    modelYear: String(modelYear),
  })

  let payload: { results?: NhtsaRecallRow[] }
  try {
    const response = await fetchImpl(`${RECALLS_BASE}?${params.toString()}`)
    if (!response.ok) {
      return {
        recalls: [],
        errors: [`NHTSA recall lookup failed with HTTP ${response.status}.`],
        caveat: CAVEAT,
      }
    }
    payload = (await response.json()) as { results?: NhtsaRecallRow[] }
  } catch (cause) {
    return {
      recalls: [],
      errors: [
        `Could not reach the NHTSA recall service (${cause instanceof Error ? cause.message : 'network error'}).`,
      ],
      caveat: CAVEAT,
    }
  }

  const recalls: CandidateRecall[] = (payload.results ?? []).map((row) => {
    const component = row.Component ?? 'UNKNOWN'
    const summary = row.Summary ?? ''
    return {
      campaignNumber: row.NHTSACampaignNumber ?? 'UNKNOWN',
      componentGroupKeys: componentGroupsForRecall(component, summary),
      description: summary,
      // Never anything else. See the module comment.
      isCandidate: true,
      component,
      consequence: row.Consequence,
      remedy: row.Remedy,
      reportReceivedDate: row.ReportReceivedDate,
      manufacturer: row.Manufacturer,
      parkIt: row.parkIt === true,
      parkOutside: row.parkOutSide === true,
    }
  })

  // Do-not-drive advisories first — those change what the advisor says at the podium.
  recalls.sort((a, b) => Number(b.parkIt) - Number(a.parkIt) || Number(b.parkOutside) - Number(a.parkOutside))

  return { recalls, errors, caveat: CAVEAT }
}
