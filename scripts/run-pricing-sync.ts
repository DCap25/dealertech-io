/**
 * The morning price sync, run by hand.
 *
 *   npm run pricing:sync
 *
 * The same code the scheduled trigger calls. Safe to run repeatedly: a second
 * run finds nothing moved and says so.
 *
 * To watch it do something against the mock DMS, set DMS_PRICE_DRIFT=1, which
 * nudges every fifth price by 4%.
 */
import { syncAllStorePricing } from '@/lib/pricing/run'

async function main() {
  const results = await syncAllStorePricing()

  if (results.length === 0) {
    console.log('No active stores.')
    process.exit(0)
  }

  let needsAttention = 0
  for (const r of results) {
    const flag = r.status === 'OK' ? (r.quarantined > 0 ? '!' : ' ') : '!'
    if (flag === '!') needsAttention++
    console.log(`${flag} ${r.storeName} — ${r.status}: ${r.summary}`)
  }

  console.log('')
  console.log(
    needsAttention === 0
      ? `${results.length} store${results.length === 1 ? '' : 's'} synced cleanly.`
      : `${needsAttention} of ${results.length} need a look — see the lines marked !`,
  )

  // Non-zero so a scheduler surfaces it rather than reporting a green run that
  // silently changed nothing.
  process.exit(needsAttention === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
