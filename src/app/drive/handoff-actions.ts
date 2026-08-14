'use server'

import { getDefaultStore, loadDriveDay } from '@/lib/prep-sheet/load'
import { buildHandOffPayload } from '@/lib/prep-sheet/command-center'
import type { OpportunityDecision } from '@/lib/prep-sheet/presentation'
import { getDmsAdapter } from '@/lib/dms/registry'
import { demoNow } from '@/lib/demo-day'
import { requireUser } from '@/lib/auth/session'

/**
 * Push the hand-off to whatever DMS is configured.
 *
 * The client sends an appointment id and its decisions — never the payload.
 * A hand-off becomes part of a customer's permanent record, and a payload
 * assembled in the browser could carry coverage figures nobody's engine ever
 * produced. The server rebuilds it from the same prep sheet the advisor saw.
 */

/** Must match the Drive page, or the server rebuilds a different day. */
const DAY = () => demoNow()

export interface HandOffPushState {
  status: 'IDLE' | 'SENT' | 'FAILED'
  /** Vendor name for display: "Mock", "CDK Global". */
  vendor: string
  /** False on the mock — the UI must not claim a real write happened. */
  persisted: boolean
  message: string
  externalRef: string | null
  acceptedCount: number
}

export async function pushHandOffForVisit(
  appointmentId: string,
  decisions: Record<string, OpportunityDecision>,
): Promise<HandOffPushState> {
  // A server action is a POST endpoint whether or not a page ever rendered,
  // so the guard belongs here rather than only on the surface that calls it.
  await requireUser()

  const adapter = getDmsAdapter()
  const vendor = adapter.capabilities.vendor

  /**
   * Never throws. An advisor standing at a car should get a sentence and a
   * working copy button, not a crashed page — the paste path is always there.
   */
  try {
    if (!adapter.capabilities.canPushHandOff) {
      return {
        status: 'FAILED',
        vendor,
        persisted: false,
        message: `The ${vendor} integration is read-only. Copy the hand-off below and paste it into the RO.`,
        externalRef: null,
        acceptedCount: 0,
      }
    }

    const store = await getDefaultStore()
    if (!store) {
      return failure(vendor, 'No store configured.')
    }

    const sheets = await loadDriveDay(store.id, DAY(), DAY())
    const sheet = sheets.find((s) => s.appointment?.id === appointmentId)
    if (!sheet) {
      return failure(vendor, 'That appointment is no longer on the drive.')
    }

    // Only the enum values are taken from the client; ids and money come from
    // the rebuilt sheet.
    const safeDecisions: Record<string, OpportunityDecision> = {}
    for (const [id, value] of Object.entries(decisions)) {
      if (value === 'ACCEPTED' || value === 'DECLINED' || value === 'SKIPPED') {
        safeDecisions[id] = value
      }
    }

    const payload = buildHandOffPayload(sheet, safeDecisions)
    const result = await adapter.pushHandOff(store.id, payload)

    return {
      status: result.ok ? 'SENT' : 'FAILED',
      vendor,
      persisted: adapter.capabilities.writesArePersisted && result.ok,
      message: result.message,
      externalRef: result.externalRef,
      acceptedCount: payload.accepted.length,
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown error'
    return failure(vendor, `Could not reach ${vendor}: ${detail}`)
  }
}

function failure(vendor: string, message: string): HandOffPushState {
  return {
    status: 'FAILED',
    vendor,
    persisted: false,
    message: `${message} The hand-off text below is still available to copy.`,
    externalRef: null,
    acceptedCount: 0,
  }
}
