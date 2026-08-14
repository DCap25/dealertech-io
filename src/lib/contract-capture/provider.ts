import { emptyExtraction } from './review'
import type { ExtractedContract, ExtractionContext } from './types'

/**
 * Vision extraction, behind an interface for the same reason the Co-Pilot is:
 * so the whole flow — capture, review, confirm, save — can be developed and
 * demonstrated without a key, and so swapping the model is one file.
 */

export interface VisionProvider {
  name: string
  extract(input: {
    /** Raw image bytes, base64 encoded. */
    imageBase64: string
    mediaType: string
    context: ExtractionContext
  }): Promise<ExtractedContract>
}

export type VisionProviderName = 'mock' | 'anthropic'

export function resolveProviderName(): VisionProviderName {
  return process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'mock'
}

/**
 * The mock returns a plausible Tire & Wheel contract for whatever vehicle it
 * is given, with one field deliberately uncertain.
 *
 * Deliberately not perfect. A mock that returns nine HIGH-confidence fields
 * teaches everyone that the review screen is a formality, and the review
 * screen is the entire safety mechanism.
 */
export const mockVisionProvider: VisionProvider = {
  name: 'mock',
  async extract({ context }) {
    await new Promise((r) => setTimeout(r, 700))

    const base = emptyExtraction()
    return {
      ...base,
      productType: { value: 'TIRE_WHEEL', confidence: 'HIGH', sourceText: 'TIRE & WHEEL PROTECTION' },
      adminCompany: { value: 'Safeguard', confidence: 'HIGH', sourceText: 'Safeguard Products International' },
      contractNumber: { value: 'SG-88214', confidence: 'HIGH', sourceText: 'Contract No. SG-88214' },
      purchaseDate: { value: '2023-04-11', confidence: 'MEDIUM', sourceText: 'Purchase Date 04/11/2023' },
      expirationDate: { value: '2028-04-11', confidence: 'MEDIUM', sourceText: 'Expires 04/11/2028' },
      termMonths: { value: 60, confidence: 'HIGH', sourceText: '60 months' },
      termMiles: { value: null, confidence: 'LOW', sourceText: null },
      deductibleAmount: { value: 0, confidence: 'HIGH', sourceText: 'Deductible: $0' },
      vin: { value: context.vehicleVin, confidence: 'HIGH', sourceText: context.vehicleVin },
    }
  },
}

export async function getVisionProvider(): Promise<VisionProvider> {
  if (resolveProviderName() === 'anthropic') {
    // Imported lazily so the SDK never lands in a build that does not use it.
    const { anthropicVisionProvider } = await import('./anthropic-vision')
    return anthropicVisionProvider
  }
  return mockVisionProvider
}
