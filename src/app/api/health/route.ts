import { NextResponse, type NextRequest } from 'next/server'
import { sql } from 'drizzle-orm'
import { getDb } from '@/db/client'

/**
 * Is the service up?
 *
 * ---------------------------------------------------------------------------
 * TWO QUESTIONS, NOT ONE
 * ---------------------------------------------------------------------------
 * A load balancer asks "is this instance alive, should I send it traffic" and
 * asks it every few seconds, forever. A monitor asks "is the system actually
 * working end to end" and asks it occasionally. Answering both the same way
 * makes one of them wrong.
 *
 * The default is liveness: no database, no I/O, just proof that this process
 * accepted a request and produced a response. `?deep=1` adds a single-round-
 * trip database ping for monitoring to call.
 *
 * That split is not fussiness. The connection pool is `max: 1` per instance —
 * see src/db/client.ts, and it is that low deliberately because the pooler is
 * doing the pooling. A health check that touched the database on every probe
 * would spend that one connection competing with the advisor waiting on a prep
 * sheet, and would do it hardest exactly when the database is already slow,
 * which is the moment a probe should be cheapest.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES NOT SAY
 * ---------------------------------------------------------------------------
 * No version, no commit, no environment, no hostname, no error text. This is
 * the one endpoint on the site reachable by anyone with the URL, and the whole
 * value of it is being boring.
 *
 * The error text matters most. A failed connection throws with the connection
 * string in the message, and this codebase has already had one land somewhere
 * it should not — the whole of `assertUsableUrl` in src/db/client.ts exists
 * because a mistyped DATABASE_URL wrote a live password into a hosting
 * provider's log. Returning `err.message` here would publish it. So a database
 * failure is the word "unreachable" and nothing else; the detail goes to the
 * server log where it belongs.
 */

export const dynamic = 'force-dynamic'
// A cached health check reports the health of whenever it was cached.
export const revalidate = 0

/** Long enough for a healthy round trip, short enough to fail a probe fast. */
const DB_TIMEOUT_MS = 2_000

async function pingDatabase(): Promise<'ok' | 'unreachable'> {
  try {
    await Promise.race([
      getDb().execute(sql`SELECT 1`),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), DB_TIMEOUT_MS),
      ),
    ])
    return 'ok'
  } catch (error) {
    // Logged, never returned. See the note above.
    console.error('[health] database ping failed:', error)
    return 'unreachable'
  }
}

export async function GET(request: NextRequest) {
  const time = new Date().toISOString()
  const deep = request.nextUrl.searchParams.get('deep') === '1'

  if (!deep) {
    return NextResponse.json({ status: 'ok', time }, { headers: NO_STORE })
  }

  const database = await pingDatabase()
  return NextResponse.json(
    { status: database === 'ok' ? 'ok' : 'degraded', time, database },
    // 503 so a monitor alerts on the status code rather than having to parse
    // the body. The process is alive either way — that is what plain /api/health
    // is for, and a load balancer reading this one would pull a serving
    // instance out of rotation over a blip it could have ridden out.
    { status: database === 'ok' ? 200 : 503, headers: NO_STORE },
  )
}

/**
 * Nothing between here and the client may keep a copy — not the CDN, not the
 * browser, not a proxy somebody puts in front of it later.
 */
const NO_STORE = { 'cache-control': 'no-store, max-age=0' } as const
