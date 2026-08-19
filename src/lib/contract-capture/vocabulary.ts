import type { ProductType, TierType, DeductibleType } from '@/lib/coverage'

/**
 * The words the coverage engine knows, and what they look like on paper.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ONE FILE AND NOT THREE LISTS
 * ---------------------------------------------------------------------------
 * The same vocabulary has to reach three places that would otherwise drift:
 *
 *   * the extraction prompt, which has to tell the model that "extended
 *     warranty", "vehicle service agreement" and "mechanical breakdown
 *     protection" are all VSC — otherwise it invents a label, and an invented
 *     label is a contract the engine cannot arbitrate on;
 *   * the normaliser, which rejects anything outside the list;
 *   * the review form's dropdowns, which is where an advisor fixes a miss.
 *
 * When those three disagree, the failure is quiet: the model returns a term
 * the normaliser drops, the advisor sees an empty field on an obviously
 * labelled contract, and nobody finds out why. So they read from here.
 *
 * The `aliases` are the load-bearing part. A dealership's paperwork almost
 * never says "VSC" — it says whatever the administrator's marketing department
 * called it. Telling the model the real-world names is the difference between
 * mapping a document and guessing at one.
 *
 * Pure data. No imports beyond the engine's own types.
 */

export const PRODUCT_TYPES: readonly ProductType[] = [
  'VSC', 'PPM', 'TIRE_WHEEL', 'KEY', 'DENT', 'WINDSHIELD', 'APPEARANCE', 'THEFT',
]

export const TIER_TYPES: readonly TierType[] = ['EXCLUSIONARY', 'INCLUSIONARY']

export const DEDUCTIBLE_TYPES: readonly DeductibleType[] = ['PER_VISIT', 'PER_REPAIR', 'NONE']

export interface ProductVocabulary {
  value: ProductType
  /** What the review form's dropdown says. */
  label: string
  /** What the document is likely to say. Fed to the model verbatim. */
  aliases: string[]
}

export const PRODUCT_VOCABULARY: ProductVocabulary[] = [
  {
    value: 'VSC',
    label: 'Vehicle service contract',
    aliases: [
      'vehicle service contract', 'extended warranty', 'extended service plan',
      'mechanical breakdown protection', 'vehicle service agreement',
      'powertrain coverage', 'exclusionary coverage',
    ],
  },
  {
    value: 'PPM',
    label: 'Prepaid maintenance',
    aliases: [
      'prepaid maintenance', 'maintenance plan', 'scheduled maintenance',
      'oil change plan', 'care plan',
    ],
  },
  {
    value: 'TIRE_WHEEL',
    label: 'Tire & wheel / road hazard',
    aliases: ['tire and wheel', 'tire & wheel protection', 'road hazard', 'wheel protection'],
  },
  {
    value: 'DENT',
    label: 'Dent & ding / PDR',
    aliases: ['dent and ding', 'paintless dent repair', 'PDR', 'ding protection'],
  },
  {
    value: 'APPEARANCE',
    label: 'Cosmetic / alloy wheel / appearance',
    aliases: [
      'appearance protection', 'cosmetic care', 'alloy wheel protection',
      'interior protection', 'exterior protection', 'paint and fabric',
    ],
  },
  {
    value: 'WINDSHIELD',
    label: 'Windshield / glass',
    aliases: ['windshield protection', 'glass coverage', 'auto glass'],
  },
  {
    value: 'KEY',
    label: 'Key replacement',
    aliases: ['key replacement', 'key fob protection', 'lost key'],
  },
  {
    value: 'THEFT',
    label: 'Theft / etch',
    aliases: ['theft protection', 'VIN etch', 'anti-theft', 'etch guarantee'],
  },
]

/**
 * The product vocabulary as a block of prompt text.
 *
 * Built rather than hand-written so a product added to the engine cannot be
 * silently missing from what the model is told to look for.
 */
export function productVocabularyPrompt(): string {
  return PRODUCT_VOCABULARY.map(
    (p) => `- ${p.value} — ${p.label}. Printed as: ${p.aliases.join('; ')}.`,
  ).join('\n')
}
