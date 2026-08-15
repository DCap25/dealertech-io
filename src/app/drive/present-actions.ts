'use server'

import { requireUser, getCurrentStore } from '@/lib/auth/session'
import { loadDriveDay } from '@/lib/prep-sheet/load'
import { buildDeviceSnapshot } from '@/lib/pairing/snapshot'
import { endSession, listDevices, pushToDevice, sessionForAdvisor } from '@/lib/pairing/store'
import { createLinkPresentation } from '@/lib/presentation/link-store'
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

/** What the customer has tapped so far. Polled by the advisor's screen. */
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

export async function takeBackMenu(sessionId: string): Promise<void> {
  const user = await requireUser()
  await endSession(user.storeId, sessionId)
}
