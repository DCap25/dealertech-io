'use server'

import { loadDriveDay } from '@/lib/prep-sheet/load'
import { buildHandOffPayload } from '@/lib/prep-sheet/command-center'
import type { OpportunityDecision } from '@/lib/prep-sheet/presentation'
import { getDmsAdapter } from '@/lib/dms/registry'
import { demoNow } from '@/lib/demo-day'
import { requireUser, getCurrentStore } from '@/lib/auth/session'
import {
  describeReceipt, provenanceNote, withProvenance,
  type DecisionSource, type HandOffReceipt,
} from '@/lib/dms/handoff-record'
import { existingSuccess, handoffsForAppointment, recordHandOff } from '@/lib/dms/handoff-store'
import type { HandOffPayload } from '@/lib/dms/types'

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
  /** Where each decision came from. Absent entries are treated as the advisor's. */
  sources: Record<string, DecisionSource> = {},
  /** The tablet it was presented on, when it was. */
  deviceName: string | null = null,
): Promise<HandOffPushState> {
  // A server action is a POST endpoint whether or not a page ever rendered,
  // so the guard belongs here rather than only on the surface that calls it.
  const user = await requireUser()

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

    const store = await getCurrentStore()
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

    const safeSources: Record<string, DecisionSource> = {}
    for (const [id, value] of Object.entries(sources)) {
      if (value === 'ADVISOR' || value === 'CUSTOMER') safeSources[id] = value
    }

    const built = buildHandOffPayload(sheet, safeDecisions)

    /**
     * Who chose each line.
     *
     * Now that a customer can tap Yes on a tablet in their own hands, "who
     * approved this" has two answers. On a disputed line, "the customer
     * selected it on Lane 3" is a different conversation from "the advisor
     * recorded it" — so it goes in the note, which is the part that survives
     * in a DMS comment field without our UI.
     */
    const acceptedIds = sheet.opportunities
      .filter((o) => safeDecisions[o.id] === 'ACCEPTED')
      .map((o) => o.id)

    const payload: HandOffPayload = {
      ...built,
      note: withProvenance(built.note, provenanceNote(safeSources, acceptedIds, deviceName)),
    }

    /**
     * Already sent this exact content? Hand back the original receipt.
     *
     * A double-tap, a retry after a timeout, or a reload followed by another
     * push must not create a second repair order. A genuinely changed set of
     * lines hashes differently and is a real second hand-off.
     */
    const already = await existingSuccess(store.id, payload)
    if (already) {
      return {
        status: 'SENT',
        vendor: already.vendor,
        persisted: already.persisted,
        message: `Already sent — ${describeReceipt(already)}`,
        externalRef: already.externalRef,
        acceptedCount: already.acceptedCount,
      }
    }

    const result = await adapter.pushHandOff(store.id, payload)
    const persisted = adapter.capabilities.writesArePersisted && result.ok

    // Recorded whether or not it worked. A failed push that leaves no trace is
    // worse than a red row: the advisor moves on believing it went, and nobody
    // finds out until the customer does.
    await recordHandOff({
      storeId: store.id,
      appointmentId,
      advisorId: user.id,
      payload,
      vendor,
      persisted,
      result,
    })

    return {
      status: result.ok ? 'SENT' : 'FAILED',
      vendor,
      persisted,
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

/**
 * Every push already made for this visit, newest first.
 *
 * The panel reads this on open so a page reload does not lose the answer to
 * "did this reach the DMS?" — which is the question an advisor asks when a
 * customer rings about work that never got done.
 */
export async function handOffHistory(appointmentId: string): Promise<HandOffReceipt[]> {
  const user = await requireUser()
  return handoffsForAppointment(user.storeId, appointmentId)
}
