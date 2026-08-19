/**
 * How a menu reached the customer.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A MODULE AND NOT A STRING LITERAL EACH TIME
 * ---------------------------------------------------------------------------
 * `presentation_sessions.channel` is text by design — "the set of ways a
 * dealership can put a menu in front of somebody is not finished, and an enum
 * makes every future one a migration" (migration 0018). That freedom has a
 * price: a text column invites four files to each hold their own idea of what
 * the values are, and the readers that *branch* on it are the ones that decide
 * whether a customer's answer reaches an advisor at all.
 *
 * So the vocabulary lives here, once, with the questions the branching readers
 * actually ask — "can somebody answer on this?", "did they answer it alone?" —
 * as functions rather than as a `Set` re-declared per file. Adding the next
 * channel is then a case here plus two phrases (`timeline/frozen.ts` for the
 * event sentence, `dms/authorization-note.ts` for the permanent record), and
 * the compiler finds the rest.
 *
 * Pure and I/O-free.
 */

/**
 * A menu on a tablet with the advisor standing next to it.
 *
 * The original and still the default: the tablet has no submit because the
 * conversation ends when the advisor takes it back.
 */
export const CHANNEL_TABLET = 'TABLET'

/**
 * The same tablet, handed over.
 *
 * A distinct value rather than a flag beside `TABLET`, because every reader
 * that branches on channel has a different answer for the two. It is still a
 * tablet and still answerable, but the customer worked through it alone and
 * finished it themselves — which is a fact about who was in the room, and the
 * permanent record has to be able to say so.
 *
 * Deliberately *not* folded into `LINK` either, even though it borrows the
 * link's finish. `linkAnswersForVisit` reads `LINK` rows to catch up on answers
 * given hours ago on somebody's phone; a self-serve tablet's answers arrive
 * live on the advisor's mirror, in the room, and pulling them in a second time
 * through the link read would be two paths writing the same answer.
 */
export const CHANNEL_TABLET_SELF_SERVE = 'TABLET_SELF_SERVE'

export const CHANNEL_LINK = 'LINK'
export const CHANNEL_PRINT = 'PRINT'

export type PresentationChannel =
  | typeof CHANNEL_TABLET
  | typeof CHANNEL_TABLET_SELF_SERVE
  | typeof CHANNEL_LINK
  | typeof CHANNEL_PRINT

/**
 * The channel a push to a tablet writes.
 *
 * One function so the advisor's two buttons cannot end up meaning three
 * things: the mode is a boolean at the surface and a channel value here.
 */
export function tabletChannel(selfServe: boolean): PresentationChannel {
  return selfServe ? CHANNEL_TABLET_SELF_SERVE : CHANNEL_TABLET
}

/**
 * Did the customer work through this one on their own?
 *
 * The question the tablet asks to know whether to render a finish, and the
 * device route asks before it accepts one. An attended session has no confirm
 * bar and must not acquire one because a device posted the action.
 */
export function isSelfServeChannel(channel: string): boolean {
  return channel === CHANNEL_TABLET_SELF_SERVE
}

/** Is this a menu on one of our tablets, attended or not? */
export function isTabletChannel(channel: string): boolean {
  return channel === CHANNEL_TABLET || channel === CHANNEL_TABLET_SELF_SERVE
}

/**
 * Can anything come back from this channel?
 *
 * `PRINT` cannot: a printed menu has an empty `decisions` column by
 * construction, so a reader that treats it as answerable finds nothing and
 * says nothing — but names the assumption rather than leaving the next person
 * to work it out from an empty result.
 */
export function isAnswerableChannel(channel: string): boolean {
  return isTabletChannel(channel) || channel === CHANNEL_LINK
}
