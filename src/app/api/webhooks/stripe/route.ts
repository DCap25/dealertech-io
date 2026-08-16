import { NextResponse, type NextRequest } from 'next/server'
import { getStripe } from '@/lib/billing/stripe'
import { handleStripeEvent } from '@/lib/billing/webhook'

/**
 * Stripe's side of the conversation.
 *
 * ---------------------------------------------------------------------------
 * PUBLIC IN THE ROUTING SENSE ONLY
 * ---------------------------------------------------------------------------
 * Listed as a public prefix for the same reason `/api/cron` is: Stripe has no
 * session cookie, so deny-by-default would answer every delivery with a
 * redirect to the sign-in page and the integration would silently never work.
 *
 * The signature is the guard, and it fails closed. An unset
 * `STRIPE_WEBHOOK_SECRET` refuses every request rather than accepting
 * unverified JSON — a webhook endpoint that works when misconfigured is an
 * endpoint anybody can use to mark their own dealership as paid.
 *
 * ---------------------------------------------------------------------------
 * THE RAW BODY MATTERS
 * ---------------------------------------------------------------------------
 * Signature verification runs over the exact bytes Stripe sent. `req.json()`
 * would parse and re-serialise, changing key order and whitespace, and every
 * signature would fail for reasons that look like a wrong secret. `req.text()`
 * is not a style choice here.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// A slow database on a busy morning should not cost us a delivery.
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    console.error('[stripe] STRIPE_WEBHOOK_SECRET is not set — refusing every delivery.')
    // Deliberately says nothing about whether the secret is missing or wrong.
    // An operator has the logs; a prober gets one word.
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const signature = req.headers.get('stripe-signature')
  if (!signature) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const raw = await req.text()

  let event
  try {
    event = await getStripe().webhooks.constructEventAsync(raw, signature, secret)
  } catch (cause) {
    /*
      A bad signature is not our problem to retry.

      400 tells Stripe the delivery was rejected and stops it being retried —
      which is right, because a signature that failed once will fail every
      time. Logged so a genuinely misconfigured secret is findable.
    */
    const why = cause instanceof Error ? cause.message : String(cause)
    console.error('[stripe] signature verification failed:', why)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const outcome = await handleStripeEvent({
    id: event.id,
    type: event.type,
    livemode: event.livemode,
    data: { object: event.data.object },
  })

  if (outcome.status === 'failed') {
    /*
      500 so Stripe retries.

      This is the one path that should be retried: we accepted a valid event
      and could not apply it — a database blip, an API timeout. The event is
      already recorded with its error, so a retry that also fails leaves a
      trail rather than repeating silently.
    */
    console.error(`[stripe] could not apply ${event.type} (${event.id}): ${outcome.why}`)
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }

  if (outcome.status === 'ignored') {
    console.warn(`[stripe] ignored ${event.type} (${event.id}): ${outcome.why}`)
  }

  // 200 for duplicate, ignored, noop and applied alike. All four are correct
  // outcomes, and only a genuine failure should be retried.
  return NextResponse.json({ received: true, outcome: outcome.status })
}
