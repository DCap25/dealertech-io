/**
 * Fires the nightly billing reconciliation.
 *
 * A Netlify Scheduled Function, which is a separate runtime from the Next
 * application — so it does not import anything from `src/`. It makes one
 * authenticated request to the app's own cron route and reports what came
 * back, exactly like the pricing sync alongside it. Keeping the work in the
 * app means the scheduled path and a manual run execute identical code.
 *
 * Requires CRON_SECRET to be set on the site, the same value the route checks.
 * Without it the route answers 401 and this logs a failure rather than
 * silently doing nothing — which for this job would mean trials that never
 * expire and dunning that never escalates, with no symptom at all.
 */

const billingReconcile = async () => {
  const base = process.env.URL ?? process.env.DEPLOY_PRIME_URL
  const secret = process.env.CRON_SECRET

  if (!base || !secret) {
    console.error('billing reconciliation skipped: URL or CRON_SECRET is not set on this site')
    return new Response('not configured', { status: 500 })
  }

  const response = await fetch(`${base}/api/cron/billing`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}` },
  })

  const body = await response.text()
  if (!response.ok) {
    console.error(`billing reconciliation failed: ${response.status} ${body}`)
    return new Response(body, { status: response.status })
  }

  console.log(`billing reconciliation: ${body}`)
  return new Response(body, { status: 200 })
}

export default billingReconcile

/**
 * 09:00 UTC — two hours before the price sync, and deliberately not at the
 * same time.
 *
 * Both jobs walk every tenant against a rate-limited API, and running them
 * together would double the burst for no benefit. This one goes first because
 * its output is what somebody reads with their coffee: a tenant that lapsed
 * overnight should already be on the console when the day starts.
 */
export const config = {
  schedule: '0 9 * * *',
}
