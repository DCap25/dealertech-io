import 'server-only'
import { getDb, schema } from '@/db/client'
import { toPrepSheetInputs, type StoreProfile } from '@/lib/dms'
import { getDmsAdapter } from '@/lib/dms/registry'
import { buildPrepSheet } from './build'
import type { PrepSheet } from './types'

/**
 * The drive, assembled from whatever DMS is configured.
 *
 * This file used to hold the queries; they now live in the adapter, and this
 * is the seam between "what the dealership's system knows" and "what our
 * engines do with it".
 */

/**
 * Store settings the engine needs for pricing and state-specific rules.
 *
 * Hardcoded for the demo store. A real deployment reads these from the store
 * record — labour rate in particular varies by rooftop and drives every
 * estimate on the sheet.
 */
const STORE_PROFILE: StoreProfile = { state: 'TX', laborRate: 185 }

function startOfDay(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

/**
 * A day of prep sheets.
 *
 * Pull from the DMS adapter, map into engine inputs, build. The data access
 * that used to live here moved into `MockDmsAdapter` unchanged, so the output
 * is identical — but the application no longer knows where the appointments
 * came from, which is the point.
 */
export async function loadDriveDay(
  storeId: string,
  day: Date,
  asOf: Date = new Date(),
): Promise<PrepSheet[]> {
  const from = startOfDay(day)
  const to = new Date(from)
  to.setDate(to.getDate() + 1)

  const bundle = await getDmsAdapter().pullDriveBundle(storeId, { from, to })
  return toPrepSheetInputs(bundle, STORE_PROFILE, asOf).map(buildPrepSheet)
}

/** The store to show when no tenant has been selected yet. */
export async function getDefaultStore() {
  const db = getDb()
  const [store] = await db.select().from(schema.stores).limit(1)
  return store
}
