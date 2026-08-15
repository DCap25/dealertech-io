// Not `server-only`: the customer-facing route is a plain page and this is
// reached from it as well as from advisor actions. It still cannot leave the
// server — it imports the privileged database client.
import { and, desc, eq, sql } from 'drizzle-orm'
import { getDb, schema } from '@/db/client'
import { sanitizeDecisions, type Decision } from './decisions'
import {
  createLinkToken, hashLinkToken, linkExpiryFrom, linkStatus,
  type LinkStatus,
} from './link'
import type { DeviceSnapshot } from '@/lib/pairing/snapshot'

/**
 * Menu links: creating them, reading them, and recording what came back.
 *
 * Runs privileged rather than under row-level security, and for once that is
 * not a shortcut. The person opening the link has no account and never will —
 * they are a customer, not a user — so there is no session for a policy to
 * resolve. The token is the entire authority, which is why it is 32 random
 * bytes, hashed at rest, short-lived, and scoped to exactly one visit.
 */

export interface LinkSession {
  id: string
  storeId: string
  appointmentId: string | null
  sequence: number
  snapshot: DeviceSnapshot
  decisions: Record<string, Decision>
  status: LinkStatus
  authorizedAt: Date | null
  authorizedName: string | null
}

/**
 * Send a menu to a customer's phone.
 *
 * The snapshot is frozen at this moment, exactly as it is for a tablet: what
 * the customer sees must not change under them because an advisor edited
 * something on their own screen half an hour later.
 */
export async function createLinkPresentation(input: {
  storeId: string
  appointmentId: string | null
  advisorId: string | null
  snapshot: DeviceSnapshot
  now: Date
}): Promise<{ token: string; sessionId: string; sequence: number }> {
  const db = getDb()
  const { token, tokenHash } = createLinkToken()

  /*
    Which conversation on this visit this is.

    Counted from what already exists rather than assumed to be the second: a
    busy day can produce three, and a visit where the tablet was never used
    should still call the first link "1".
  */
  const [prior] = await db
    .select({ n: sql<number>`coalesce(max(${schema.presentationSessions.sequence}), 0)::int` })
    .from(schema.presentationSessions)
    .where(input.appointmentId
      ? eq(schema.presentationSessions.appointmentId, input.appointmentId)
      : sql`false`)

  const sequence = (prior?.n ?? 0) + 1

  const [row] = await db.insert(schema.presentationSessions).values({
    storeId: input.storeId,
    deviceId: null,
    appointmentId: input.appointmentId,
    advisorId: input.advisorId,
    channel: 'LINK',
    sequence,
    accessTokenHash: tokenHash,
    expiresAt: linkExpiryFrom(input.now),
    snapshot: input.snapshot,
    decisions: {},
  }).returning({ id: schema.presentationSessions.id })

  if (!row) throw new Error('could not create the presentation')
  return { token, sessionId: row.id, sequence }
}

/** Look a session up by the raw token from the URL. */
export async function linkSessionFromToken(
  token: string,
  now: Date,
): Promise<LinkSession | null> {
  if (!token) return null

  const [row] = await getDb()
    .select()
    .from(schema.presentationSessions)
    .where(eq(schema.presentationSessions.accessTokenHash, hashLinkToken(token)))
    .limit(1)

  if (!row) return null

  return {
    id: row.id,
    storeId: row.storeId,
    appointmentId: row.appointmentId,
    sequence: row.sequence,
    snapshot: row.snapshot as DeviceSnapshot,
    decisions: (row.decisions ?? {}) as Record<string, Decision>,
    status: linkStatus(row, now),
    authorizedAt: row.authorizedAt,
    authorizedName: row.authorizedName,
  }
}

/**
 * Record what the customer tapped.
 *
 * Merged rather than replaced, and only for items that were actually on the
 * snapshot — a client posting an id it was never sent gets it dropped. Refuses
 * once authorised: the whole point of the authorisation record is that it
 * stops moving.
 */
export async function recordLinkDecisions(
  token: string,
  incoming: unknown,
  now: Date,
): Promise<LinkSession | null> {
  const session = await linkSessionFromToken(token, now)
  if (!session || session.status !== 'OPEN') return session

  const presented = session.snapshot.tiers.flatMap((t) => t.items.map((i) => i.id))
  const clean = sanitizeDecisions(presented, incoming)
  if (Object.keys(clean).length === 0) return session

  const merged = { ...session.decisions, ...clean }

  await getDb().update(schema.presentationSessions)
    .set({ decisions: merged, lastActivityAt: now })
    .where(eq(schema.presentationSessions.id, session.id))

  return { ...session, decisions: merged }
}

/**
 * Freeze the answers as an authorisation.
 *
 * Writes the snapshot AND the decisions together, because the record has to
 * survive the prices moving afterwards. "They agreed to £618 of brakes" is
 * only meaningful alongside the fact that £618 is what the screen said.
 */
export async function authoriseLinkSession(
  token: string,
  name: string,
  now: Date,
): Promise<LinkSession | null> {
  const session = await linkSessionFromToken(token, now)
  if (!session || session.status !== 'OPEN') return session

  await getDb().update(schema.presentationSessions)
    .set({
      authorizedAt: now,
      authorizedName: name.trim(),
      authorizedSnapshot: {
        snapshot: session.snapshot,
        decisions: session.decisions,
        authorizedName: name.trim(),
        authorizedAt: now.toISOString(),
      },
      lastActivityAt: now,
    })
    .where(eq(schema.presentationSessions.id, session.id))

  return { ...session, status: 'AUTHORIZED', authorizedAt: now, authorizedName: name.trim() }
}

/** Every presentation on a visit, oldest first. What the advisor view reads. */
export async function presentationsForVisit(storeId: string, appointmentId: string) {
  return getDb()
    .select({
      id: schema.presentationSessions.id,
      sequence: schema.presentationSessions.sequence,
      channel: schema.presentationSessions.channel,
      decisions: schema.presentationSessions.decisions,
      snapshot: schema.presentationSessions.snapshot,
      startedAt: schema.presentationSessions.startedAt,
      authorizedAt: schema.presentationSessions.authorizedAt,
      authorizedName: schema.presentationSessions.authorizedName,
      expiresAt: schema.presentationSessions.expiresAt,
      endedAt: schema.presentationSessions.endedAt,
    })
    .from(schema.presentationSessions)
    .where(and(
      eq(schema.presentationSessions.storeId, storeId),
      eq(schema.presentationSessions.appointmentId, appointmentId),
    ))
    .orderBy(desc(schema.presentationSessions.sequence))
}
