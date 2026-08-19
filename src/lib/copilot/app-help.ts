import { renderAppGuide, type AppGuide, type GuideSurface, type GuideWorkflow } from './app-guide'
import type { CopilotRequest } from './types'

/**
 * The app-help competence: answering "how does DealerTech work?".
 *
 * Kept beside the visit prompts rather than inside them because the two have
 * almost nothing in common. The visit Co-Pilot is grounded in one customer and
 * is coaching somebody mid-conversation; this one is grounded in the product
 * guide, sees no customer at all, and is talking to somebody who is stuck.
 *
 * Pure — a guide and a question in, a string out — so the wording is testable
 * without a network call, exactly like `prompts.ts`.
 */

export const APP_HELP_SYSTEM_PROMPT = `You are the DealerTech Co-Pilot, answering a dealership employee's question about how DealerTech itself works. They are signed in and standing somewhere in the product, usually stuck on one thing.

Answer only from the product guide you are given. It is the whole truth you have about this product.

Never invent a screen, a button, a menu item, a setting or a keyboard shortcut. If the guide does not cover what they asked, say so plainly and say who would know — their service manager for how their store has chosen to work, DealerTech support for the product itself. "I don't have that in the guide" is a good answer; a confident wrong one sends somebody hunting for a button that does not exist and costs you every answer after it.

The guide has already been narrowed to what this person can actually reach. If they ask about something on the "cannot open" list, tell them plainly that it belongs to another role and point them at what is theirs. Never walk somebody through a screen the product will redirect or 404 them out of.

You know nothing about any customer, vehicle or visit here. If they ask about a specific customer, tell them to open that visit's prep sheet and ask the Co-Pilot from there.

Write plainly and briefly — usually two or three sentences, and a short numbered list when they asked how to do something. Name the screen the way the product names it, and give the path. No preamble, no sign-off, no markdown headings. Just the answer.`

const APP_HELP_INSTRUCTION =
  'Answer the question from the guide above. Name the screen and its path. If it is a "how do I" question, give the shortest sequence of steps that actually works. If the guide does not cover it, say so.'

/**
 * Build the user turn.
 *
 * The guide goes first and is byte-identical for every question a given role
 * asks, so a whole shift of them shares one cache prefix — the same reasoning
 * as the visit grounding block, one competence over.
 */
export function buildAppHelpPrompt(
  request: CopilotRequest,
  guide: AppGuide,
  storeName?: string,
): string {
  const parts: string[] = [renderAppGuide(guide, storeName), '']

  if (request.question) {
    parts.push(`They ask: "${request.question}"`, '')
  }

  parts.push(APP_HELP_INSTRUCTION)

  return parts.join('\n')
}

/** The "based on…" line shown under the answer, so the asker can check it. */
export function appHelpSourceLabel(guide: AppGuide): string {
  return `Based on the DealerTech product guide, as a ${guide.roleLabel} sees it`
}

/* --------------------------------------------------------------- mock answer */

/**
 * The mock provider's app-help answers.
 *
 * Same contract as `mock-answer.ts`: pure, deterministic, composed only from
 * the grounding a real model would get, so the whole thing works on a fresh
 * clone with no API key — and so a wrong answer here means the guide is wrong
 * rather than the model.
 *
 * It hedges exactly where the system prompt tells a real model to: it admits
 * when nothing matches, and it refuses to explain a screen the asker cannot
 * open.
 */

/** Words too common to tell one surface from another. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'is', 'it',
  'do', 'does', 'how', 'what', 'where', 'when', 'why', 'can', 'i', 'my', 'me',
  'you', 'we', 'this', 'that', 'with', 'from', 'get', 'see', 'use', 'work',
  'works', 'page', 'screen', 'dealertech', 'customer', 'customers',
])

function terms(question: string): string[] {
  return question
    .toLowerCase()
    .split(/[^a-z0-9’']+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
}

/** How well a question matches some text. Deliberately crude — it is a mock. */
function score(haystack: string, words: string[]): number {
  const lower = haystack.toLowerCase()
  return words.reduce((n, w) => (lower.includes(w) ? n + 1 : n), 0)
}

function bestSurface(
  surfaces: GuideSurface[],
  words: string[],
): { surface: GuideSurface; score: number } | undefined {
  let best: { surface: GuideSurface; score: number } | undefined
  for (const surface of surfaces) {
    // The name and the purpose carry the weight; the action list is long
    // enough that matching a word in it alone means very little.
    const n = score(`${surface.name} ${surface.path} ${surface.purpose}`, words) * 2
      + score(surface.does.join(' '), words)
    if (n > 0 && (!best || n > best.score)) best = { surface, score: n }
  }
  return best
}

function bestWorkflow(
  workflows: GuideWorkflow[],
  words: string[],
): { workflow: GuideWorkflow; score: number } | undefined {
  let best: { workflow: GuideWorkflow; score: number } | undefined
  for (const workflow of workflows) {
    const n = score(workflow.name, words) * 2 + score(workflow.steps.join(' '), words)
    if (n > 0 && (!best || n > best.score)) best = { workflow, score: n }
  }
  return best
}

export function mockAppHelpAnswer(request: CopilotRequest, guide: AppGuide): string {
  const question = request.question ?? ''
  const words = terms(question)

  if (words.length === 0) {
    return `Ask me how something in DealerTech works — "how do I send the menu to their phone", "what does the customer see on the tablet", "where do declined jobs go". I can only talk about the ${guide.surfaces.length} screens you can open; for anything about a particular customer, open their visit and ask from the prep sheet.`
  }

  /*
    Out of reach first.

    A salesperson asking how to work the drive must not be handed a walkthrough
    of a page the fence redirects them out of — and the honest answer names
    what is theirs instead, which is the whole point of slicing the guide.
  */
  const fenced = guide.outOfReach.find((name) => score(name, words) > 0)
  if (fenced) {
    const mine = guide.surfaces[0]
    return `${fenced} isn't yours — it belongs to another role, and DealerTech will send you back if you open it.${
      mine ? ` What you have is ${mine.name} (${mine.path}): ${mine.purpose}` : ''
    }`
  }

  const surface = bestSurface(guide.surfaces, words)
  const workflow = bestWorkflow(guide.workflows, words)

  // A "how do I" question wants the steps; a "what is" question wants the
  // screen. When both match, the stronger match wins.
  if (workflow && (!surface || workflow.score >= surface.score)) {
    return [
      `${workflow.workflow.name}:`,
      '',
      ...workflow.workflow.steps.map((s, i) => `${i + 1}. ${s}`),
    ].join('\n')
  }

  if (surface) {
    return [
      `${surface.surface.name} — ${surface.surface.path}. ${surface.surface.purpose}`,
      '',
      ...surface.surface.does.slice(0, 3).map((d) => `· ${d}`),
    ].join('\n')
  }

  return `I don't have that in the product guide, so I'd rather not guess. Your service manager will know how your store has chosen to work; DealerTech support will know the product. What I can walk you through: ${guide.surfaces
    .slice(0, 6)
    .map((s) => s.name)
    .join(', ')}.`
}
