import 'server-only'
import type { DmsAdapter } from './adapter'
import { MockDmsAdapter } from './mock/adapter'

/**
 * Adapter selection.
 *
 * One env var, one switch statement. Adding CDK means writing the adapter and
 * adding a case here — nothing else in the application changes, because
 * nothing else in the application knows a concrete adapter exists.
 *
 *   DMS_ADAPTER=mock   (default)
 *   DMS_ADAPTER=cdk    (not yet implemented)
 *
 * Coverage scenarios for the mock are selected separately with
 * DMS_MOCK_SCENARIO — see ./mock/scenarios.ts.
 */

export type DmsAdapterName = 'mock'

let cached: DmsAdapter | null = null

export function resolveAdapterName(env: NodeJS.ProcessEnv = process.env): DmsAdapterName {
  const requested = env.DMS_ADAPTER?.trim().toLowerCase()
  // Unknown values fall back to the mock rather than throwing at request time.
  // A typo in an env var should not take the drive down mid-shift.
  if (!requested || requested === 'mock') return 'mock'
  return 'mock'
}

/**
 * The active adapter.
 *
 * Cached per process: adapters are stateless request handlers, and rebuilding
 * one per call would mean re-reading configuration on every prep sheet.
 */
export function getDmsAdapter(): DmsAdapter {
  if (cached) return cached
  switch (resolveAdapterName()) {
    case 'mock':
    default:
      cached = new MockDmsAdapter()
      return cached
  }
}

/** Test seam — lets a suite install a fake without touching the environment. */
export function setDmsAdapter(adapter: DmsAdapter | null): void {
  cached = adapter
}
