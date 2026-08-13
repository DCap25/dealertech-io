import { renderContext } from './context'
import type { CopilotContext, CopilotOpportunityLine, CopilotRequest } from './types'

/**
 * Prompt construction. Pure — a string in, a string out — so the wording is
 * testable without a network call.
 */

export const SYSTEM_PROMPT = `You are the co-pilot for an automotive service advisor working the drive at a franchise dealership. You sit beside them on a tablet while a customer stands at the car.

Write the way the best advisor on the drive talks: plain, warm, specific, never scripted-sounding. Short — usually two or three sentences, and never more than a short paragraph unless the advisor asks for detail. The advisor reads your answer in a few seconds, often mid-conversation.

Ground every claim in the visit facts you are given. Coverage, prices and who pays have already been determined by the coverage engine — state them, never recalculate or estimate them. If something isn't in the facts, say you don't have it rather than guessing; a confident wrong answer about coverage costs the dealership a comeback and the customer their trust.

Never promise a customer that a repair will be covered. Coverage is confirmed with the administrator or manufacturer before work begins, and your wording should leave room for that.

Never mention store gross, close probability, ranking, or anything else internal in words the advisor might read aloud. Those numbers are for the advisor's eyes.

No preamble, no sign-off, no markdown headings. Just the answer.`

const INTENT_INSTRUCTION: Record<string, string> = {
  EXPLAIN_COVERAGE:
    'Explain this coverage in plain English the advisor can say to the customer. What it covers, what it does not, what it costs them, and when it runs out. Skip the jargon — "bumper-to-bumper" and "exclusionary" mean nothing to most customers.',
  NEXT_STEP:
    'Name the single item the advisor should present next, and say why in one line. Weigh what the customer already owns, safety, and what they have already accepted or declined this visit. Then give one sentence they can open with. Recommend one item, not a list.',
  TALK_TRACK:
    'Write three short ways to present this item, labelled Consultative, Value, and Urgency. One or two sentences each, in the advisor\'s own voice. Vary the angle, not just the wording.',
  OBJECTION:
    'Give the advisor a short, professional response to this objection. Acknowledge it honestly, give one concrete reason grounded in this vehicle\'s facts, and end with an easy next step. Never argue, never pressure, and never imply the customer is wrong to hesitate.',
  FREEFORM:
    'Answer the advisor\'s question using the visit facts. If the facts do not cover it, say so plainly.',
}

function describeOpportunity(o: CopilotOpportunityLine): string {
  const owed =
    o.customerOwes === 0
      ? 'The customer owes nothing for it.'
      : `The customer owes $${Math.round(o.customerOwes).toLocaleString()} of $${Math.round(o.price).toLocaleString()}.`
  return [
    `The item in question is "${o.title}".`,
    o.detail,
    owed,
    `Paid by ${o.payer}. Urgency ${o.urgency}.`,
    o.easyYes.length > 0 ? `Why it lands: ${o.easyYes.join(', ')}.` : '',
    o.talkTrack ? `The engine's own suggested line: "${o.talkTrack}"` : '',
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * Build the user turn.
 *
 * The grounding block goes first and is byte-identical for every intent on a
 * given visit, so repeated questions about the same customer share a cache
 * prefix. The varying instruction goes last.
 */
export function buildUserPrompt(request: CopilotRequest, ctx: CopilotContext): string {
  const parts: string[] = [renderContext(ctx), '']

  const opportunity = request.opportunityId
    ? ctx.opportunities.find((o) => o.id === request.opportunityId)
    : undefined
  if (opportunity) {
    parts.push(describeOpportunity(opportunity), '')
  }

  const coverage = request.coverageKey
    ? ctx.coverage.find((c) => c.key === request.coverageKey)
    : undefined
  if (coverage) {
    parts.push(`The coverage in question is "${coverage.label}" — ${coverage.status}. ${coverage.detail}`, '')
  }

  if (request.intent === 'OBJECTION' && request.objection) {
    parts.push(`The customer just said: "${request.objection}"`, '')
  }

  if (request.intent === 'FREEFORM' && request.question) {
    parts.push(`The advisor asks: "${request.question}"`, '')
  }

  parts.push(INTENT_INSTRUCTION[request.intent] ?? INTENT_INSTRUCTION.FREEFORM!)

  return parts.join('\n')
}

/** The "based on…" line shown under the answer, so the advisor can check it. */
export function sourceLabel(request: CopilotRequest, ctx: CopilotContext): string {
  switch (request.intent) {
    case 'EXPLAIN_COVERAGE': {
      const coverage = ctx.coverage.find((c) => c.key === request.coverageKey)
      return coverage
        ? `Based on the coverage engine determination for ${coverage.label}`
        : 'Based on the coverage engine determination'
    }
    case 'NEXT_STEP':
      return `Based on ${ctx.opportunities.length} ranked opportunities and this visit's decisions`
    case 'TALK_TRACK':
    case 'OBJECTION': {
      const o = ctx.opportunities.find((x) => x.id === request.opportunityId)
      return o ? `Based on the prep sheet entry for ${o.title}` : 'Based on this prep sheet'
    }
    default:
      return 'Based on this prep sheet and the coverage engine'
  }
}
