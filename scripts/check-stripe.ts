import { getStripe } from '../src/lib/billing/stripe'
import { BANDS, PRICE_LOOKUP_KEY, stripeTiers } from '../src/lib/billing/plans'

/**
 * Does the price list in Stripe still match the one in the code?
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS WORTH A SCRIPT
 * ---------------------------------------------------------------------------
 * Two copies of the same numbers exist, and they have to agree: the catalog in
 * src/lib/billing/plans.ts is what the application quotes on screen, and the
 * tiers on the Stripe price are what actually appears on an invoice. Nothing
 * enforces that at runtime, because the application deliberately does not ask
 * Stripe what things cost before rendering a page.
 *
 * The failure mode is quiet and expensive: somebody edits a band, ships, and
 * the product now shows a dealership one number while charging them another —
 * which is precisely the sin this whole product exists to stop a service
 * advisor committing. Worth a command that can be run before a release.
 *
 *   npm run check:stripe
 *
 * Read-only. Changes nothing in either place.
 */
async function main() {
  const stripe = getStripe()

  const found = await stripe.prices.list({
    lookup_keys: [PRICE_LOOKUP_KEY],
    active: true,
    limit: 1,
    expand: ['data.tiers'],
  })

  const price = found.data[0]
  if (!price) {
    console.error(`FAIL: no active price with lookup key "${PRICE_LOOKUP_KEY}".`)
    process.exitCode = 1
    return
  }

  console.log(`price      ${price.id}`)
  console.log(`product    ${typeof price.product === 'string' ? price.product : price.product.id}`)
  console.log(`mode       ${price.billing_scheme} / ${price.tiers_mode ?? 'n/a'}`)

  const problems: string[] = []

  if (price.billing_scheme !== 'tiered' || price.tiers_mode !== 'volume') {
    problems.push(
      `Expected a tiered price in volume mode, found ${price.billing_scheme}/${price.tiers_mode}. ` +
      'Graduated mode would charge a growing group the old rate on its first rooftops.',
    )
  }

  if (price.recurring?.interval !== 'month') {
    problems.push(`Expected a monthly interval, found ${price.recurring?.interval ?? 'none'}.`)
  }

  const expected = stripeTiers()
  const actual = price.tiers ?? []

  if (actual.length !== expected.length) {
    problems.push(`Expected ${expected.length} tiers, found ${actual.length}.`)
  } else {
    expected.forEach((want, i) => {
      const got = actual[i]!
      // Stripe returns the unbounded tier's `up_to` as null, not "inf".
      const gotUpTo = got.up_to === null ? 'inf' : got.up_to
      if (gotUpTo !== want.up_to) {
        problems.push(`Tier ${i + 1}: expected up_to ${want.up_to}, found ${gotUpTo}.`)
      }
      if (got.unit_amount !== want.unit_amount) {
        problems.push(
          `Tier ${i + 1}: expected ${want.unit_amount} cents, found ${got.unit_amount} — ` +
          'the app would quote one number and Stripe would bill another.',
        )
      }
    })
  }

  console.log('')
  BANDS.forEach((band, i) => {
    const got = actual[i]
    const cents = got?.unit_amount ?? null
    const ok = cents === band.unitAmountCents
    console.log(
      `  ${ok ? 'OK  ' : 'BAD '} ${band.label.padEnd(16)} code $${band.unitAmountCents / 100}` +
      `  stripe ${cents === null ? '—' : `$${cents / 100}`}`,
    )
  })

  console.log('')
  if (problems.length === 0) {
    console.log('Stripe and the code agree.')
  } else {
    for (const p of problems) console.error(`FAIL: ${p}`)
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
