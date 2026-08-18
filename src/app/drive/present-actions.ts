'use server'

import { requireUser, getCurrentStore } from '@/lib/auth/session'
import { loadDriveDay } from '@/lib/prep-sheet/load'
import { buildDeviceSnapshot } from '@/lib/pairing/snapshot'
import { endSession, listDevices, pushToDevice, sessionForAdvisor } from '@/lib/pairing/store'
import { createLinkPresentation, linkAnswersForVisit } from '@/lib/presentation/link-store'
import type { Decision } from '@/lib/presentation/decisions'
import type { MenuSelection } from '@/lib/menu/selection'
import { demoNow } from '@/lib/demo-day'

/**
 * Sending a menu to a tablet.
 *
 * The client sends an appointment id and which item ids it selected — never
 * the menu itself. The snapshot is rebuilt here from the same prep sheet the
 * advisor saw, so a tampered payload cannot put a price or a coverage claim on
 * a customer's screen that no engine ever produced.
 */

/** Must match the drive page, or the server rebuilds a different day. */
const DAY = () => demoNow()

export interface PushState {
  status: 'IDLE' | 'SENT' | 'ERROR'
  sessionId?: string
  deviceName?: string
  message?: string
}

export async function listPairedDevices() {
  const user = await requireUser()
  return listDevices(user.storeId)
}

export async function sendMenuToDevice(
  appointmentId: string,
  deviceId: string,
  includedIds: string[],
): Promise<PushState> {
  const user = await requireUser()

  const store = await getCurrentStore()
  if (!store) return { status: 'ERROR', message: 'No store configured.' }

  const sheets = await loadDriveDay(store.id, DAY(), DAY())
  const sheet = sheets.find((s) => s.appointment?.id === appointmentId)
  if (!sheet) return { status: 'ERROR', message: 'That appointment is no longer on the drive.' }

  // Only the ids are taken from the client, and only ids that exist on the
  // rebuilt sheet survive buildMenu.
  const selection: MenuSelection = {
    includedIds: includedIds.filter((id) => typeof id === 'string'),
  }

  const devices = await listDevices(user.storeId)
  const device = devices.find((d) => d.id === deviceId)
  if (!device) {
    return { status: 'ERROR', message: 'That tablet is not paired to this store any more.' }
  }

  try {
    const { sessionId } = await pushToDevice({
      storeId: user.storeId,
      deviceId,
      appointmentId,
      advisorId: user.id,
      snapshot: buildDeviceSnapshot(sheet, selection),
    })
    return { status: 'SENT', sessionId, deviceName: device.name ?? 'Tablet' }
  } catch (error) {
    // An advisor standing at a car should get a sentence, not a crashed page —
    // the on-screen menu and the printout both still work.
    const detail = error instanceof Error ? error.message : 'Unknown error'
    return { status: 'ERROR', message: `Could not reach that tablet. ${detail}` }
  }
}

export type LinkState =
  | { status: 'CREATED'; path: string; sequence: number }
  | { status: 'ERROR'; message: string }

/**
 * Send the same menu to the customer's own phone.
 *
 * This is the conversation the tablet cannot have. By the time the technician
 * has finished the inspection the customer is at work, and a device on a desk
 * in the drive is no use to them — but this is where most of the money on a
 * repair order is won or lost.
 *
 * The snapshot is rebuilt here from the same prep sheet, exactly as it is for a
 * tablet: the client sends ids, never prices. A tampered payload cannot put a
 * number on a customer's phone that no engine produced.
 */
export async function sendMenuLink(
  appointmentId: string,
  includedIds: string[],
): Promise<LinkState> {
  const user = await requireUser()

  const store = await getCurrentStore()
  if (!store) return { status: 'ERROR', message: 'No store configured.' }

  const sheets = await loadDriveDay(store.id, DAY(), DAY())
  const sheet = sheets.find((s) => s.appointment?.id === appointmentId)
  if (!sheet) return { status: 'ERROR', message: 'That appointment is no longer on the drive.' }

  const selection: MenuSelection = {
    includedIds: includedIds.filter((id) => typeof id === 'string'),
  }

  try {
    const { token, sequence } = await createLinkPresentation({
      storeId: user.storeId,
      appointmentId,
      advisorId: user.id,
      snapshot: buildDeviceSnapshot(sheet, selection),
      now: new Date(),
    })
    // The path only. The advisor's page builds the absolute URL from the
    // request host, so a custom domain or a proxy produces a link that works.
    return { status: 'CREATED', path: `/m/${token}`, sequence }
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown error'
    return { status: 'ERROR', message: `Could not create the link. ${detail}` }
  }
}

/**
 * What the customer has tapped so far. Polled by the advisor's screen.
 *
 * `active` is the answer as of this instant, not as of the last write:
 * `sessionForAdvisor` applies the tablet's idle window on read and ends a
 * session that has gone quiet, so a menu left on a bench takes the panel down
 * here as surely as pressing "take it back" does. The answers already given
 * still come back with it — the caller drops its mirror, not the decisions.
 */
export async function readSessionDecisions(
  sessionId: string,
): Promise<{ decisions: Record<string, string>; active: boolean } | null> {
  const user = await requireUser()
  const session = await sessionForAdvisor(user.storeId, sessionId)
  if (!session) return null
  return {
    decisions: (session.decisions ?? {}) as Record<string, string>,
    active: session.status === 'ACTIVE',
  }
}

/**
 * What the customer answered on a link, hours after we sent it.
 *
 * The tablet mirror above polls one live session; this reads a visit. A link
 * customer answers at lunchtime from an office, so there is no live session to
 * watch — their answers sit on the presentation row until somebody asks for
 * them, and until this existed nobody ever did.
 *
 * Returns the merged map including any `PENDING` the customer cleared. The
 * caller decides what may land on their own state — `answersToApply` is that
 * decision, and it is pure and tested.
 */
export async function readLinkAnswers(
  appointmentId: string,
): Promise<Record<string, Decision>> {
  const user = await requireUser()
  return linkAnswersForVisit(user.storeId, appointmentId)
}

/**
 * End the tablet conversation, and return the answers it ended with.
 *
 * The decisions come back because the caller's mirror dies with this call. The
 * advisor polls every 1.5 seconds, and pressing "take it back" used to clear
 * the session id in the same click — so anything the customer tapped since the
 * last poll was ended, kept on the row, and never shown to the person who was
 * watching for it. Handing the final map back is what closes that window: the
 * advisor's screen gets one last update from the same call that stops it
 * updating.
 *
 * `endSession` reads them off its own `UPDATE` rather than this doing a second
 * read — see the note there.
 */
export async function takeBackMenu(sessionId: string): Promise<{
  decisions: Record<string, string>
}> {
  const user = await requireUser()
  const ended = await endSession(user.storeId, sessionId)
  // Null means no session of that id in this store — already gone, or never
  // ours. Nothing to mirror, and nothing worth telling the advisor: the menu is
  // off the tablet either way, which is what they asked for.
  return { decisions: ended?.decisions ?? {} }
}
