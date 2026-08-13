import type { CopilotContext, CopilotOpportunityLine, CopilotRequest } from './types'

/**
 * The mock provider's answers.
 *
 * Pure, deterministic, and composed from the same facts a real model would be
 * given — so the UI can be built and demoed with no API key, and so a wrong
 * answer here means the grounding is wrong rather than the model. Kept honest
 * on purpose: it hedges about coverage exactly where the system prompt tells a
 * real model to.
 */

function money(n: number): string {
  return `$${Math.round(n).toLocaleString()}`
}

function firstPending(ctx: CopilotContext): CopilotOpportunityLine | undefined {
  // Opportunities arrive already ranked by the prep sheet engine, so the first
  // one still outstanding is by definition the best thing to present next.
  return ctx.opportunities.find((o) => o.decision === 'PENDING')
}

function explainCoverage(request: CopilotRequest, ctx: CopilotContext): string {
  const coverage = request.coverageKey
    ? ctx.coverage.find((c) => c.key === request.coverageKey)
    : ctx.coverage[0]

  if (!coverage) {
    return `There's no factory warranty or purchased coverage on file for this ${ctx.vehicle}. Anything we recommend today would be customer pay, so lead with what it costs and why it matters.`
  }

  const expired = coverage.status === 'Expired'
  if (expired) {
    return `${coverage.label} has run out on this vehicle. ${coverage.detail} Worth telling them plainly — customers often assume they're still covered, and finding out at the cashier is how you lose one.`
  }

  return `${coverage.label} is still active — ${coverage.status}. ${coverage.detail} Say it as "you've still got coverage on that, and I'll confirm it with them before we touch anything" — that way you're giving them good news without promising something the administrator hasn't approved yet.`
}

function nextStep(ctx: CopilotContext): string {
  const next = firstPending(ctx)
  if (!next) {
    return ctx.opportunities.length === 0
      ? `Nothing outstanding on this ${ctx.vehicle}. Confirm the concern, complete the inspection, and set the next appointment before they leave.`
      : `You've worked every item — ${money(ctx.acceptedValue)} added to the RO. Close it out and book the next visit while they're still standing here.`
  }

  const why =
    next.customerOwes === 0
      ? "it costs them nothing, so it's the easiest yes on the sheet"
      : next.urgency === 'SAFETY'
        ? "it's the safety item, and safety goes first regardless of price"
        : next.easyYes.length > 0
          ? `it's ${next.easyYes[0]!.toLowerCase()}`
          : 'it ranks highest on what this vehicle actually needs'

  const opener =
    next.talkTrack ||
    `While it's here, I want to show you what we found on the ${next.title.toLowerCase()}.`

  return `Present ${next.title} next — ${why}. ${
    next.customerOwes === 0
      ? "Lead with the fact they're not paying for it."
      : `They'd owe ${money(next.customerOwes)}.`
  }\n\nOpen with: "${opener}"`
}

function talkTrack(request: CopilotRequest, ctx: CopilotContext): string {
  const o = request.opportunityId
    ? ctx.opportunities.find((x) => x.id === request.opportunityId)
    : firstPending(ctx)

  if (!o) return 'Pick an item on the prep sheet and I\'ll write you a few ways to present it.'

  const price = o.customerOwes === 0 ? 'no charge to you' : money(o.customerOwes)

  return [
    `**Consultative** — "While we had it up, we checked the ${o.title.toLowerCase()}. ${o.detail} I'm not saying it has to happen today, but I'd rather you hear it from me than find out on the road."`,
    '',
    `**Value** — "${
      o.customerOwes === 0
        ? `This one's covered, so it's ${price}. You already paid for that protection — this is where it earns its keep.`
        : `It's ${price} today. Doing it now while the car's already open saves you a second trip and a second diagnostic.`
    }"`,
    '',
    `**Urgency** — "${
      o.urgency === 'SAFETY'
        ? "This is the one I'd want done before you drive it home. Everything else can wait; this one I'd rather not let leave."
        : `This is only going to get more expensive the longer it waits. Right now it's ${price} — once it takes something else with it, it's a different conversation.`
    }"`,
  ].join('\n')
}

const OBJECTION_RESPONSE: { match: RegExp; reply: (o?: CopilotOpportunityLine) => string }[] = [
  {
    match: /think about it/i,
    reply: (o) =>
      `"Absolutely — it's your car and your money. Can I ask what part you want to think about, the timing or the cost? ${
        o && o.customerOwes === 0
          ? "Because this one's covered, so there's nothing to weigh up on price."
          : "If it's timing, I can get you a price that's good for thirty days so nothing changes while you decide."
      }"`,
  },
  {
    match: /expensive|too much|cost|afford/i,
    reply: (o) =>
      `"I hear you, and I'd rather tell you the real number than a soft one. ${
        o && o.customerOwes < o.price
          ? `The good news is your coverage takes most of it — you're at ${money(o.customerOwes)}, not ${money(o.price)}.`
          : "Let's do it this way: tell me what works today and I'll tell you what genuinely can't wait versus what we can schedule."
      }"`,
  },
  {
    match: /spouse|wife|husband|partner|ask my/i,
    reply: () =>
      `"Of course — I'd do the same. Let me print this up with the photos and the measurements so you're not relying on memory, and I'll hold the price while you talk it through. Want me to text it to you both?"`,
  },
  {
    match: /cheaper|somewhere else|another shop/i,
    reply: () =>
      `"Totally fair, and I won't talk you out of shopping it. Just make sure you're comparing the same parts and the same warranty — and if you do come back, I'll honour today's number."`,
  },
  {
    match: /wait|next time|later/i,
    reply: (o) =>
      `"It can — I'll be straight with you about that. ${
        o?.urgency === 'SAFETY'
          ? "The exception is this one. It's a safety item, and it's the one I'd want handled before you drive it home."
          : "Let me note it on your file with today's measurement so next visit we can see how fast it's moving, and we'll decide then."
      }"`,
  },
]

function objection(request: CopilotRequest, ctx: CopilotContext): string {
  const o = request.opportunityId
    ? ctx.opportunities.find((x) => x.id === request.opportunityId)
    : firstPending(ctx)
  const text = request.objection ?? ''

  const matched = OBJECTION_RESPONSE.find((r) => r.match.test(text))
  if (matched) return matched.reply(o)

  return `"That's fair — help me understand what's behind it and I'll work with you." Then stop talking and let them fill the silence. Most objections you can't place are really about trust or timing, and you can't answer either one until they tell you which.`
}

function freeform(request: CopilotRequest, ctx: CopilotContext): string {
  const q = (request.question ?? '').toLowerCase()

  if (/cover|warrant|contract|vsc/.test(q)) {
    return ctx.coverage.length > 0
      ? `Here's what's on file: ${ctx.coverage
          .map((c) => `${c.label} — ${c.status}`)
          .join('; ')}. Tap any ring on the coverage stack for the engine's full reasoning on that one.`
      : `Nothing on file for this vehicle — no factory coverage and no purchased products. Everything today is customer pay.`
  }

  if (/next|first|start|priority/.test(q)) return nextStep(ctx)

  if (/total|money|how much|gross/.test(q)) {
    return `${money(ctx.remainingValue)} is still on the table and ${money(
      ctx.acceptedValue,
    )} is on the RO. ${
      ctx.opportunities.filter((o) => o.decision === 'PENDING').length
    } items still to present.`
  }

  return `I'm running on the demo provider, so I can only answer from what's on this prep sheet: ${ctx.customerName}'s ${ctx.vehicle} at ${ctx.mileage.toLocaleString()} miles, ${ctx.coverage.length} coverage lines and ${ctx.opportunities.length} opportunities. Connect a model in the environment and I'll answer properly.`
}

export function mockAnswer(request: CopilotRequest, ctx: CopilotContext): string {
  switch (request.intent) {
    case 'EXPLAIN_COVERAGE':
      return explainCoverage(request, ctx)
    case 'NEXT_STEP':
      return nextStep(ctx)
    case 'TALK_TRACK':
      return talkTrack(request, ctx)
    case 'OBJECTION':
      return objection(request, ctx)
    default:
      return freeform(request, ctx)
  }
}
