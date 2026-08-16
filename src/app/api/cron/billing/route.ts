import { NextResponse, type NextRequest } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { runBillingReconciliation } from '@/lib/billing/run'

/**
 * The nightly billing job, triggered on a schedule.
 *
 * Same shape and the same guard as `/api/cron/pricing`: a shared secret in a
 * header, compared in constant time, refusing outright when `CRON_SECRET` is
 * unset. A cron endpoint that works when misconfigured is one anybody can run,
 * and this one moves tenants between commercial states.
 *
 * What it does is in src/lib/billing/run.ts — advancing the trial and dunning
 * clocks, and reconciling against Stripe. Notably it cannot suspend anybody:
 * the lifecycle engine refuses that from any automatic actor.
 */

export const dynamic = 'force-dynamic'
// Every tenant, one at a time, against a rate-limited API.
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
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const results = await runBillingReconciliation()
  const attention = results.filter((r) => r.status === 'ATTENTION' || r.status === 'FAILED')
  const moved = results.filter((r) => r.status === 'MOVED')

  /*
    200 even when tenants need attention.

    The job ran and did the right thing; a dealership needing a decision is a
    correct outcome, not a failure of the endpoint. The body carries what
    needs a human so a scheduler can alert on `needsAttention` rather than on
    a status code that would also fire for a deploy blip.
  */
  return NextResponse.json({
    ok: true,
    tenants: results.length,
    moved: moved.length,
    needsAttention: attention.length,
    results,
  })
}
