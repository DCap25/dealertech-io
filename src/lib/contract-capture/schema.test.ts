import { describe, expect, it } from 'vitest'
import { extractionSchema, extractionSystemPrompt } from './schema'
import { EXTRACTED_FIELDS } from './types'
import { PRODUCT_TYPES, TIER_TYPES, DEDUCTIBLE_TYPES, PRODUCT_VOCABULARY } from './vocabulary'
import { productTypeEnum } from '@/db/schema/enums'

/**
 * The drift guard.
 *
 * The extraction call itself cannot be tested here — it costs money and needs
 * a key. What can be tested is the thing most likely to rot silently: a
 * product added to the coverage engine and never mentioned to the model, or a
 * field added to the review form that the schema never asks for. Both fail
 * quietly in production — an empty field on an obviously labelled contract,
 * and nobody finds out why.
 */

const schema = extractionSchema()
const properties = schema.properties as Record<string, { properties: Record<string, unknown> }>

describe('the schema covers what the form shows', () => {
  it('asks for every field the review form renders', () => {
    expect(Object.keys(properties).sort()).toEqual([...EXTRACTED_FIELDS].sort())
  })

  it('requires every one of them, so a field is never simply absent', () => {
    // A missing key and a null value mean different things to the normaliser's
    // caller; requiring all of them means the model must state "not found"
    // rather than quietly omitting a field it did not look for.
    expect([...schema.required].sort()).toEqual([...EXTRACTED_FIELDS].sort())
  })

  it('gives every field the confidence and source text the review depends on', () => {
    for (const name of EXTRACTED_FIELDS) {
      const field = properties[name]!
      expect(Object.keys(field.properties).sort()).toEqual(['confidence', 'sourceText', 'value'])
    }
  })

  it('forbids extra properties, so an invented field cannot arrive', () => {
    expect(schema.additionalProperties).toBe(false)
  })
})

describe('the closed vocabularies match the engine', () => {
  function enumOf(field: string): unknown[] {
    const value = properties[field]!.properties.value as { enum?: unknown[] }
    return value.enum ?? []
  }

  it('offers exactly the product types the database column holds', () => {
    // If these drift, the model returns a value the normaliser drops and the
    // advisor sees an empty Product field on a clearly labelled contract.
    expect([...PRODUCT_TYPES].sort()).toEqual([...productTypeEnum.enumValues].sort())
    expect(enumOf('productType')).toEqual([...PRODUCT_TYPES, null])
  })

  it('offers the tier and deductible vocabularies, plus null', () => {
    expect(enumOf('tierType')).toEqual([...TIER_TYPES, null])
    expect(enumOf('deductibleType')).toEqual([...DEDUCTIBLE_TYPES, null])
  })

  it('always allows null, so "I could not tell" is expressible', () => {
    // Without it the model has to pick a member, and a picked member on an
    // unreadable document is exactly the fabrication this flow prevents.
    for (const field of ['productType', 'tierType', 'deductibleType']) {
      expect(enumOf(field)).toContain(null)
    }
  })
})

describe('the system prompt', () => {
  const prompt = extractionSystemPrompt()

  it('gives the model the real-world names for every product', () => {
    // Dealership paperwork almost never says "VSC" — it says whatever the
    // administrator's marketing department called it.
    for (const product of PRODUCT_VOCABULARY) {
      expect(prompt).toContain(product.value)
      expect(prompt).toContain(product.aliases[0])
    }
  })

  it('maps "extended warranty" to VSC rather than leaving it to be guessed', () => {
    expect(prompt).toMatch(/VSC[^\n]*extended warranty/i)
  })

  it('tells the model to return null rather than what is typical', () => {
    expect(prompt).toMatch(/never infer a value from what is typical/i)
  })

  it('says confidence is about legibility, not plausibility', () => {
    expect(prompt).toMatch(/legibility, not plausibility/i)
  })
})
