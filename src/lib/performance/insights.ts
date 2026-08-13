import { captureRate, easyYesCaptureRate, isEasyYes, leftOnTable, visitsWorked, wasPresented } from './metrics'
import type { Insight, OutcomeRecord } from './types'

/**
 * Coaching lines derived from the numbers.
 *
 * Pure logic rather than a model call: these fire on every scorecard load, and
 * an advisor checking their own numbers deserves an instant answer, not a
 * spinner and a bill. The Co-Pilot is still there for the open-ended questions.
 *
 * Tone rules, deliberately: name the behaviour, never the person; give one
 * concrete next action; and celebrate only what was genuinely earned. Praise
 * an advisor for a good week they didn't have and they stop reading the page.
 */

function money(n: number): string {
  return `$${Math.round(n).toLocaleString()}`
}

/** Below this, a capture rate is a habit worth naming. */
const CAPTURE_CONCERN = 70
const CAPTURE_STRONG = 90
/** Skipping a free item is the one miss with no defensible reason. */
const EASY_YES_CONCERN = 85
/** Not worth a coaching line below this — small samples say nothing. */
const MIN_SAMPLE = 5

export function buildInsights(outcomes: OutcomeRecord[]): Insight[] {
  const insights: Insight[] = []
  if (outcomes.length === 0) return insights

  const capture = captureRate(outcomes)
  const easy = outcomes.filter(isEasyYes)
  const easyRate = easyYesCaptureRate(outcomes)
  const skipped = outcomes.filter((o) => o.outcome === 'SKIPPED')
  const visits = visitsWorked(outcomes)

  // Skipped safety work outranks everything else on the page.
  const skippedSafety = skipped.filter((o) => o.urgency === 'SAFETY')
  if (skippedSafety.length > 0) {
    insights.push({
      key: 'skipped-safety',
      tone: 'COACH',
      headline: `${skippedSafety.length} safety item${skippedSafety.length === 1 ? '' : 's'} never raised`,
      detail: `${skippedSafety
        .slice(0, 2)
        .map((o) => o.title)
        .join(', ')}${
        skippedSafety.length > 2 ? ` and ${skippedSafety.length - 2} more` : ''
      }. Safety items are worth mentioning even when you're certain of a no — the record of having raised it protects the customer and the store.`,
      weight: 100,
    })
  }

  const skippedEasy = easy.filter((o) => !wasPresented(o))
  if (skippedEasy.length > 0 && easy.length >= MIN_SAMPLE && easyRate < EASY_YES_CONCERN) {
    const value = skippedEasy.reduce((s, o) => s + o.estimatedAmount, 0)
    insights.push({
      key: 'skipped-easy-yes',
      tone: 'COACH',
      headline: `${skippedEasy.length} covered item${skippedEasy.length === 1 ? '' : 's'} went unmentioned`,
      detail: `Worth ${money(
        value,
      )} of work the customer would have owed little or nothing for. These are the cheapest yes on the drive — the customer already paid for the coverage, and this is where it earns its keep.`,
      weight: 90,
    })
  }

  if (outcomes.length >= MIN_SAMPLE && capture < CAPTURE_CONCERN) {
    const missed = leftOnTable(outcomes)
    insights.push({
      key: 'low-capture',
      tone: 'COACH',
      headline: `You raised ${Math.round(capture)}% of what the sheet surfaced`,
      detail: `${money(
        missed,
      )} was never mentioned across ${visits} visit${visits === 1 ? '' : 's'}. Presenting is not pressuring — a customer who declines still leaves knowing what their car needs, and that decline resurfaces on the follow-up cadence.`,
      weight: 80,
    })
  }

  if (outcomes.length >= MIN_SAMPLE && capture >= CAPTURE_STRONG) {
    insights.push({
      key: 'strong-capture',
      tone: 'CELEBRATE',
      headline: `${Math.round(capture)}% capture across ${visits} visit${visits === 1 ? '' : 's'}`,
      detail:
        'Almost nothing on the sheet went unmentioned. That is the half of this job you fully control, and you are doing it.',
      weight: 70,
    })
  }

  if (easy.length >= MIN_SAMPLE && easyRate === 100) {
    insights.push({
      key: 'perfect-easy-yes',
      tone: 'CELEBRATE',
      headline: 'Every covered item raised',
      detail: `All ${easy.length} items the customer owed little or nothing for were put in front of them. Nobody left money on the table that they had already paid for.`,
      weight: 75,
    })
  }

  // A high decline rate is not a failure — but it is worth naming, because the
  // fix is upstream in how the work is framed rather than in trying harder.
  const presented = outcomes.filter(wasPresented)
  const declined = presented.filter((o) => o.outcome === 'DECLINED')
  if (presented.length >= MIN_SAMPLE && declined.length / presented.length > 0.7) {
    insights.push({
      key: 'high-decline',
      tone: 'NEUTRAL',
      headline: `${Math.round((declined.length / presented.length) * 100)}% of what you raised was declined`,
      detail:
        'You are presenting, which is the hard part. Try leading with what the customer already owns before naming a price — a declined item is worth more once they know their coverage would have taken most of it.',
      weight: 50,
    })
  }

  return insights.sort((a, b) => b.weight - a.weight)
}
