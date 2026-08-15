import { NextResponse, type NextRequest } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { syncAllStorePricing } from '@/lib/pricing/run'

/**
 * The morning price sync, triggered on a schedule.
 *
 * ---------------------------------------------------------------------------
 * WHY A SECRET AND NOT A SESSION
 * ---------------------------------------------------------------------------
 * There is nobody signed in at six in the morning, so this cannot sit behind
 * the usual guard. It is authenticated by a shared secret in a header instead,
 * which is what every scheduler — Netlify, GitHub Actions, cron on a box —
 * can actually send.
 *
 * `/api/cron` is listed as a public prefix, which sounds worse than it is: a
 * scheduler has no session cookie, so leaving it to deny-by-default meant the
 * job got a redirect to the sign-in page and silently never ran. The secret is
 * the guard, and it fails closed — an unset CRON_SECRET refuses every request
 * rather than falling open. A cron endpoint that works when misconfigured is a
 * cron endpoint anybody can run.
 */

export const dynamic = 'force-dynamic'
// Twenty rooftops against a rate-limited vendor API is not a ten-second job.
export const maxDuration = 300

function authorised(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) return false

  const header = request.headers.get('authorization') ?? ''
  const offered = header.startsWith('Bearer ') ? header.slice(7) : header

  const a = Buffer.from(offered, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export async function POST(request: NextRequest) {
  if (!authorised(request)) {
    // Deliberately says nothing about whether the secret is set, wrong, or
    // missing. A scheduler operator has the logs; a prober gets one word.
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const results = await syncAllStorePricing()
  const attention = results.filter((r) => r.status !== 'OK' || r.quarantined > 0)

  /*
    200 even when a store refused.

    The job ran and did the right thing; a refusal is a correct outcome, not a
    failure of the endpoint. The body carries what needs a human, so a
    scheduler can alert on `needsAttention` rather than on a status code that
    would also fire for a deploy blip.
  */
  return NextResponse.json({
    ok: true,
    stores: results.length,
    needsAttention: attention.length,
    results,
  })
}
