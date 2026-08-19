import { describe, expect, it } from 'vitest'
import {
  CHANNEL_LINK, CHANNEL_PRINT, CHANNEL_TABLET, CHANNEL_TABLET_SELF_SERVE,
  isAnswerableChannel, isSelfServeChannel, isTabletChannel, tabletChannel,
} from './channel'

/*
  The column is text by design, which is right — the set of ways to put a menu
  in front of somebody is not finished — and the cost of that freedom is that
  the *branching* readers have to be pinned. Every question below is one a
  reader somewhere asks to decide whether a customer's answer reaches an
  advisor, or what a permanent record says about who was in the room.
*/

describe('how a menu reached the customer', () => {
  it('turns the advisor s choice into the value that gets written', () => {
    expect(tabletChannel(false)).toBe(CHANNEL_TABLET)
    expect(tabletChannel(true)).toBe(CHANNEL_TABLET_SELF_SERVE)
  })

  it('knows which one the customer worked through alone', () => {
    expect(isSelfServeChannel(CHANNEL_TABLET_SELF_SERVE)).toBe(true)
    // The one that matters: an attended menu has no confirm bar, and a device
    // must not be able to sign one off by posting the action.
    expect(isSelfServeChannel(CHANNEL_TABLET)).toBe(false)
    expect(isSelfServeChannel(CHANNEL_LINK)).toBe(false)
    expect(isSelfServeChannel('')).toBe(false)
  })

  it('counts both kinds of tablet as a tablet', () => {
    expect(isTabletChannel(CHANNEL_TABLET)).toBe(true)
    expect(isTabletChannel(CHANNEL_TABLET_SELF_SERVE)).toBe(true)
    expect(isTabletChannel(CHANNEL_LINK)).toBe(false)
  })

  it('treats a handed-over tablet as something a customer can answer on', () => {
    /*
      The timeline's open threads are built off this. A hand-written set of
      channel literals would have compiled perfectly and silently dropped every
      call-me a customer left on a tablet they were handed — the single
      highest-intent answer on the sheet, from the flow most likely to produce
      one, because nobody is standing over them.
    */
    expect(isAnswerableChannel(CHANNEL_TABLET_SELF_SERVE)).toBe(true)
    expect(isAnswerableChannel(CHANNEL_TABLET)).toBe(true)
    expect(isAnswerableChannel(CHANNEL_LINK)).toBe(true)
    // Nothing comes back from paper.
    expect(isAnswerableChannel(CHANNEL_PRINT)).toBe(false)
    // A value from a version of this that does not exist yet is not assumed
    // answerable: it would be read as silence rather than as a stored answer.
    expect(isAnswerableChannel('SOMETHING_LATER')).toBe(false)
  })
})
