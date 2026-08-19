import type { HandOffPayload } from './types'

/**
 * The authorisation line that goes into the DMS comment.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ITS OWN THING
 * ---------------------------------------------------------------------------
 * The note is the part of a hand-off that survives without our software. It
 * lands in a comment field and is what somebody reads two months later during
 * a dispute, on a screen that has never heard of DealerTech.
 *
 * So the wording has to be exact about what is being claimed, and exact about
 * what is not. "The customer authorised this" and "the advisor recorded the
 * customer's answer" are different statements, and a permanent record that
 * blurs them is worse than one that says nothing — it invites somebody to rely
 * on it and then falls apart under the one question that matters.
 *
 * Pure and I/O-free.
 */

/**
 * How the answers were given, in words rather than an enum.
 *
 * Names the actual thing that happened, because "TABLET" means nothing to
 * whoever reads this in the DMS.
 */
function channelPhrase(channel: string): string {
  switch (channel.toUpperCase()) {
    case 'TABLET': return 'on a tablet at the dealership'
    /*
      Said apart from the attended tablet, in the record that has to survive a
      dispute.

      "The advisor went through the menu with them" and "they read it and
      answered it on their own" are different accounts of the same hour, and the
      difference is exactly what somebody two months later is trying to
      establish. The default below — "on a device we provided" — is true of this
      case and says nothing about the part that matters.
    */
    case 'TABLET_SELF_SERVE': return 'on a tablet at the dealership, working through it on their own'
    case 'LINK': return 'on their own phone, from a link we sent'
    case 'PRINT': return 'on a printed menu'
    default: return 'on a device we provided'
  }
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString()}`
}

/**
 * The authorisation block, or null when there is nothing honest to say.
 *
 * Null when the advisor recorded the answers themselves. That is the ordinary
 * case and it is not a lesser one — it is simply a different claim, already
 * covered by the provenance line, and dressing it up as a customer
 * authorisation would be the record asserting something that did not happen.
 */
export function authorizationNote(
  authorization: HandOffPayload['authorization'],
): string | null {
  if (!authorization) return null

  const when = authorization.at.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  return [
    'CUSTOMER AUTHORISATION',
    `  Confirmed by ${authorization.name} ${channelPhrase(authorization.channel)}.`,
    `  ${when} · ${money(authorization.authorisedAmount)} approved at the prices shown.`,
    /*
      The limitation, stated in the record itself.

      Without this line somebody will eventually treat a DealerTech
      authorisation as the dealership's written estimate. It is not: it is a
      record of what was displayed and what was answered, and the repair order
      remains the document that authorises the work.
    */
    '  This records what was shown and what the customer answered. It does not',
    '  replace the repair order authorisation.',
  ].join('\n')
}

/**
 * The block that goes on when the price moved after they agreed.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS REPLACES THE AUTHORISATION RATHER THAN JOINING IT
 * ---------------------------------------------------------------------------
 * An authorisation block saying "$84 approved" on a ticket that now totals $95
 * is not a partial truth, it is a false one — and it is false in the permanent
 * record, in the customer's favour to dispute and the dealership's to lose. So
 * when prices have drifted past what the store allows, the claim comes off
 * entirely and this goes on instead.
 *
 * The hand-off itself still sends. An advisor needs to record the work
 * somewhere, and refusing the whole push would leave them with nothing and a
 * customer waiting.
 */
export function repriceWarningNote(input: {
  authorisedTotal: number
  currentTotal: number
  increase: number
  worst: { title: string; was: number; now: number } | null
}): string {
  return [
    'PRICE CHANGED SINCE THE CUSTOMER AGREED — do not start this work',
    `  They authorised ${money(input.authorisedTotal)}. It now totals ${money(input.currentTotal)},`,
    `  an increase of ${money(input.increase)}.`,
    ...(input.worst
      ? [`  Largest movement: ${input.worst.title}, ${money(input.worst.was)} to ${money(input.worst.now)}.`]
      : []),
    '  The earlier authorisation does not cover this amount. Speak to the customer',
    '  and record their answer before the work is carried out.',
  ].join('\n')
}

/** Appends the authorisation block to a note, if there is one. */
export function withAuthorization(
  note: string,
  authorization: HandOffPayload['authorization'],
): string {
  const block = authorizationNote(authorization)
  return block ? `${note}\n\n${block}` : note
}
