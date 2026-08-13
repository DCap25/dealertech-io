'use server'

// A 'use server' module may only export async functions. Presets, labels and
// builders live in ./scenarios so they actually reach the client.
import { runLookup, type LookupResult } from '@/lib/demo/run-lookup'
import { buildContracts, buildEntitlements, type ScenarioKey } from './scenarios'

export interface DemoState {
  result?: LookupResult
  error?: string
  /** Echoed back so the form keeps what the user typed. */
  submitted?: Record<string, string>
}

function readNumber(formData: FormData, key: string, fallback: number): number {
  const parsed = Number(formData.get(key))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

export async function runDemoAction(
  _previous: DemoState,
  formData: FormData,
): Promise<DemoState> {
  const vin = String(formData.get('vin') ?? '').trim()
  const concern = String(formData.get('concern') ?? '').trim()
  const scenario = String(formData.get('scenario') ?? 'NONE') as ScenarioKey
  const inServiceRaw = String(formData.get('inServiceDate') ?? '')

  const submitted = {
    vin,
    concern,
    scenario,
    inServiceDate: inServiceRaw,
    currentMileage: String(formData.get('currentMileage') ?? ''),
    state: String(formData.get('state') ?? ''),
    laborAmount: String(formData.get('laborAmount') ?? ''),
    partsAmount: String(formData.get('partsAmount') ?? ''),
    isOriginalOwner: formData.get('isOriginalOwner') ? 'on' : '',
  }

  if (!vin) return { error: 'Enter a VIN.', submitted }
  if (!concern) return { error: 'Describe the concern or operation.', submitted }

  const inServiceDate = inServiceRaw ? new Date(inServiceRaw) : new Date()
  if (Number.isNaN(inServiceDate.getTime())) {
    return { error: 'In-service date is not a valid date.', submitted }
  }

  try {
    const result = await runLookup({
      vin,
      concern,
      currentMileage: readNumber(formData, 'currentMileage', 0),
      inServiceDate,
      isOriginalOwner: formData.get('isOriginalOwner') !== null,
      state: String(formData.get('state') ?? 'TX').toUpperCase(),
      laborRate: 185,
      laborAmount: readNumber(formData, 'laborAmount', 0),
      partsAmount: readNumber(formData, 'partsAmount', 0),
      contracts: buildContracts(scenario, inServiceDate, new Date()),
      prepaidEntitlements: buildEntitlements(scenario),
      visitCount: 6,
      lifetimeSpend: 3800,
    })
    return { result, submitted }
  } catch (cause) {
    return {
      error: cause instanceof Error ? cause.message : 'Lookup failed unexpectedly.',
      submitted,
    }
  }
}
