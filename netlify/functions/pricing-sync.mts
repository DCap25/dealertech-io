/**
 * Fires the morning price sync.
 *
 * A Netlify Scheduled Function, which is a separate runtime from the Next
 * application — so it does not import anything from `src/`. It makes one
 * authenticated request to the app's own cron route and reports what came
 * back. Keeping the work in the app means the scheduled path and
 * `npm run pricing:sync` run identical code, rather than a second
 * implementation that drifts.
 *
 * Requires CRON_SECRET to be set on the site, the same value the route checks.
 * Without it the route answers 401 and this logs a failure rather than
 * silently doing nothing.
 */

const pricingSync = async () => {
  const base = process.env.URL ?? process.env.DEPLOY_PRIME_URL
  const secret = process.env.CRON_SECRET

  if (!base || !secret) {
    console.error('pricing sync skipped: URL or CRON_SECRET is not set on this site')
    return new Response('not configured', { status: 500 })
  }

  const response = await fetch(`${base}/api/cron/pricing`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}` },
  })

  const body = await response.text()
  if (!response.ok) {
    console.error(`pricing sync failed: ${response.status} ${body}`)
    return new Response(body, { status: response.status })
  }

  // Logged rather than swallowed: a green scheduled run that changed nothing
  // and a green run that repriced four hundred operations should not look the
  // same in the function log.
  console.log(`pricing sync: ${body}`)
  return new Response(body, { status: 200 })
}

export default pricingSync

/**
 * 11:00 UTC — a little after 6am in Central time through the summer, 5am in
 * the winter. Netlify schedules in UTC only, and the point is simply to land
 * before anybody opens the drive rather than to hit a precise local hour.
 */
export const config = {
  schedule: '0 11 * * *',
}
