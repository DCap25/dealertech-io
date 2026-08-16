import { runBillingReconciliation } from '../src/lib/billing/run'

/**
 * The nightly billing job, run by hand.
 *
 *   npm run billing:run
 *
 * The same function the scheduled route calls — no second implementation to
 * drift, exactly like `npm run pricing:sync`. Useful for the first run after a
 * deploy, and for seeing what the job would do without waiting until nine in
 * the morning UTC.
 *
 * It advances trial and dunning clocks and reconciles against Stripe. It
 * cannot suspend anybody: the lifecycle engine refuses that from any automatic
 * actor, including this one.
 */
async function main() {
  const results = await runBillingReconciliation()

  for (const r of results) {
    console.log(`${r.status.padEnd(9)} ${r.organizationName} — ${r.summary}`)
    for (const d of r.discrepancies) {
      console.log(`             ${d.autoFixable ? 'fixed' : 'NEEDS A DECISION'}: ${d.detail}`)
    }
  }

  const attention = results.filter((r) => r.status === 'ATTENTION' || r.status === 'FAILED')
  const moved = results.filter((r) => r.status === 'MOVED')

  console.log(
    `\n${results.length} tenant${results.length === 1 ? '' : 's'} · ` +
    `${moved.length} moved · ${attention.length} needing attention`,
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
