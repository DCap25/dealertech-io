import type {
  DateRange, DmsCapabilities, DmsDriveBundle, DmsId, DmsPriceBookEntry, DmsPushResult,
  DmsVehicleDetail, FollowUpOutcomePayload, HandOffPayload,
} from './types'

/**
 * The DMS contract.
 *
 * Every DealerTech surface talks to this interface and never to a vendor SDK.
 * That is the whole point: swapping CDK for Tekion should be one new file and
 * one env var, not a migration.
 *
 * ---------------------------------------------------------------------------
 * ADDING A REAL ADAPTER
 * ---------------------------------------------------------------------------
 * 1. Create `src/lib/dms/<vendor>/adapter.ts` exporting a `DmsAdapter`.
 * 2. Translate vendor payloads into the shapes in `./types`. Do the translation
 *    at the edge — never let a vendor field name past this boundary, or the
 *    second integration will have to reproduce the first one's quirks.
 * 3. Declare honest `capabilities`. If the integration cannot write, say so;
 *    the UI degrades gracefully rather than offering a button that fails.
 * 4. Register it in `./registry.ts` behind its `DMS_ADAPTER` value.
 * 5. Everything else in the app keeps working untouched.
 *
 * Practical notes learned from how these systems actually behave:
 *
 * - Pulls are batched by design. `pullDriveBundle` exists instead of a dozen
 *   per-entity calls because a 40-RO Saturday would otherwise be several
 *   hundred requests against a rate-limited, frequently slow API.
 * - Pushes must not throw on rejection. Return `ok: false` with a message.
 *   An advisor mid-drive should see "couldn't send, here's the text" rather
 *   than a crashed page.
 * - Reads must tolerate missing data. In-service dates, odometers and
 *   original-owner flags are routinely absent in real DMS records, and every
 *   engine downstream already handles nulls. Do not invent values to fill them.
 */
export interface DmsAdapter {
  readonly capabilities: DmsCapabilities

  /**
   * Everything needed to build a day of prep sheets.
   *
   * Returns an empty bundle rather than throwing when the day has no
   * appointments — a quiet Monday is not an error.
   */
  pullDriveBundle(storeId: string, range: DateRange): Promise<DmsDriveBundle>

  /** One vehicle in full, for a record page rather than a drive. */
  pullVehicleDetail(storeId: string, vehicleId: DmsId): Promise<DmsVehicleDetail | null>

  /**
   * The dealership's priced operation list, for the morning sync.
   *
   * Return `null` — not an empty array — when the integration has no price
   * book endpoint. The two mean opposite things: an empty array says "this
   * dealership prices nothing", which is what an expired credential also looks
   * like, and the sync refuses to act on it. `null` says "do not ask me this",
   * and the sync skips the store without raising anything.
   */
  pullPriceBook(storeId: string): Promise<DmsPriceBookEntry[] | null>

  /**
   * Purchased protection products for a vehicle.
   *
   * Separate from the bundle because it is the one pull worth re-running on
   * demand: a customer who bought a contract this morning should not have to
   * wait for tomorrow's sync before the drive knows about it.
   */
  pullCoverages(storeId: string, vehicleId: DmsId): Promise<DmsDriveBundle['coverages']>

  /**
   * Push the hand-off for a visit.
   *
   * Implementations should write whatever the target system genuinely
   * supports — an RO comment, a recommendation record, a customer note — and
   * report which in the result message. Nothing here assumes we can create
   * priced lines.
   */
  pushHandOff(storeId: string, payload: HandOffPayload): Promise<DmsPushResult>

  /** Close the loop on a follow-up call, where the DMS tracks such things. */
  pushFollowUpOutcome(storeId: string, payload: FollowUpOutcomePayload): Promise<DmsPushResult>
}

/**
 * A push result for an adapter that does not support the operation.
 *
 * Shared so every adapter refuses the same way, and the UI has one shape to
 * render regardless of which DMS is behind it.
 */
export function unsupported(operation: string, vendor: string): DmsPushResult {
  return {
    ok: false,
    externalRef: null,
    message: `${vendor} integration does not support ${operation}. The hand-off text is still available to copy.`,
  }
}
