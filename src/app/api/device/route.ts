import { NextResponse } from 'next/server'
import {
  activeSessionForDevice, deviceFromToken, enrollDevice, recordDeviceDecisions,
} from '@/lib/pairing/store'

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
