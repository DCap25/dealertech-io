import { NextResponse } from 'next/server'
import {
  activeSessionForDevice, deviceFromToken, enrollDevice, recordDeviceDecisions,
} from '@/lib/pairing/store'
import { callerKey, FixedWindowLimiter } from '@/lib/rate-limit/window'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The entire surface a customer tablet can reach.
 *
 * One route, three actions, and not one of them takes an identifier from the
 * device. `enroll` creates an unclaimed device. `poll` returns whatever is
 * currently pushed to the device the token belongs to. `decide` records taps
 * against that same session.
 *
 * There is deliberately no endpoint here that accepts a customer id, an
 * appointment id or a search term. A device that cannot ask a question cannot
 * be made to answer the wrong one — which is the property that makes a stolen
 * tablet worth one customer's menu rather than a dealership.
 *
 * Unauthenticated by design: a tablet is not a person. The token is the whole
 * credential, so it is checked on every action and a device with a revoked or
 * unknown token gets 401 and nothing else.
 */

function bearer(req: Request): string {
  const header = req.headers.get('authorization') ?? ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() : ''
}

/** Never cached, by anything, ever. */
const NO_STORE = { 'Cache-Control': 'no-store, private' }

/**
 * Ten enrolments an hour from one address.
 *
 * `enroll` is the one action here that runs before the bearer check, because a
 * tablet being set up has no token yet — which also makes it the one thing
 * anybody can post to. Each call writes a row, so unlimited means a table that
 * grows for as long as somebody keeps asking.
 *
 * Ten is chosen against what a real service drive does, not against what an
 * attacker wants. A store pairs a handful of tablets, ever: the device enrols
 * once and keeps its token in local storage from then on, so this fires when
 * hardware is unboxed or a tablet is wiped, not during a day's work. Ten in an
 * hour is already more tablets than most stores own. The whole drive shares one
 * NAT address, exactly as the sign-in limiter warns, which is why the number is
 * generous rather than tight — a single-digit limit could bite an installer
 * setting up a row of tablets in an afternoon.
 *
 * Keyed on the caller rather than anything on the request, because there is
 * nothing on an enrolment to key on: no account, no store, no device. Read the
 * note in `rate-limit/window` — these counters are per instance and this is a
 * speed bump against the cheap version, but the cheap version is the whole
 * threat here.
 *
 * A tablet that does get refused shows "Connecting…" until somebody reloads it:
 * `boot()` enrols once. That is worth knowing and not worth engineering around
 * at this limit — an automatic retry on a path that creates a row is how you
 * turn one refused tablet into the flood this exists to stop.
 */
const enrollLimiter = new FixedWindowLimiter({ limit: 10, windowMs: 60 * 60_000 })

export async function POST(req: Request) {
  let body: { action?: unknown; decisions?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400, headers: NO_STORE })
  }

  const action = body.action

  // ------------------------------------------------------------- enroll
  if (action === 'enroll') {
    const gate = enrollLimiter.check(callerKey(req.headers), Date.now())
    if (!gate.ok) {
      return NextResponse.json(
        { error: 'Too many tablets have been set up from here. Try again later.' },
        {
          status: 429,
          headers: { ...NO_STORE, 'retry-after': String(gate.retryAfterSeconds) },
        },
      )
    }

    const { token, code } = await enrollDevice(new Date())
    return NextResponse.json({ token, code }, { headers: NO_STORE })
  }

  const token = bearer(req)
  const device = await deviceFromToken(token)
  if (!device) {
    return NextResponse.json(
      { error: 'This tablet is not paired.' },
      { status: 401, headers: NO_STORE },
    )
  }

  // --------------------------------------------------------------- poll
  if (action === 'poll') {
    if (device.status !== 'PAIRED') {
      // Still waiting to be claimed. Says nothing about any store.
      return NextResponse.json({ paired: false }, { headers: NO_STORE })
    }

    const session = await activeSessionForDevice(device.id)
    return NextResponse.json(
      {
        paired: true,
        deviceName: device.name,
        session: session
          ? {
              id: session.id,
              snapshot: session.snapshot,
              decisions: session.decisions,
            }
          : null,
      },
      { headers: NO_STORE },
    )
  }

  // ------------------------------------------------------------- decide
  if (action === 'decide') {
    if (device.status !== 'PAIRED') {
      return NextResponse.json({ error: 'Not paired.' }, { status: 403, headers: NO_STORE })
    }
    const result = await recordDeviceDecisions(device.id, body.decisions)
    if (!result) {
      return NextResponse.json(
        { error: 'Nothing is being presented on this tablet.' },
        { status: 409, headers: NO_STORE },
      )
    }
    return NextResponse.json({ decisions: result.decisions }, { headers: NO_STORE })
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400, headers: NO_STORE })
}
