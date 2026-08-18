import 'server-only'
import { and, desc, eq, isNull, lt, or } from 'drizzle-orm'
import { getDb, schema } from '@/db/client'
// One count for both channels — see the note on `pushToDevice`.
import { nextPresentationSequence } from '@/lib/presentation/sequence'
import {
  generateDeviceToken, generatePairingCode, hashToken, isPairingExpired, normalizePairingCode,
  pairingExpiry,
} from './codes'
import { isSessionIdle, sessionIdleDeadline } from './session'
import { sanitizeDecisions, type DeviceSnapshot } from './snapshot'

/**
 * Everything a device is allowed to do, and nothing else.
 *
 * Every function here that a tablet can reach takes a token and resolves the
 * device from it. None of them take a customer id, an appointment id or a
 * search term — a device cannot ask a question, only receive an answer.
 */

export interface DeviceIdentity {
  id: string
  storeId: string | null
  name: string | null
  status: 'AWAITING_PAIRING' | 'PAIRED' | 'REVOKED'
}

/**
 * How long a dead pairing code is left lying in the table.
 *
 * Twenty-four hours past its ten-minute window, so nobody is ever mid-pairing
 * when their row is swept: a code that stopped working yesterday belongs to a
 * tablet somebody put down and walked away from.
 */
const ABANDONED_ENROLMENT_MS = 24 * 60 * 60_000

/**
 * Attempts at a unique pairing code before an enrolment gives up.
 *
 * Three, and the second effectively never runs. The code space is 32⁶ ≈ 1.07
 * billion against a handful of live codes, so a first-attempt collision is a
 * one-in-hundreds-of-millions event and a third is not a number worth writing
 * down. The bound exists so a *broken* database — the unique index firing for
 * some reason that is not a collision — fails loudly in three round trips
 * rather than spinning forever on an unauthenticated endpoint.
 */
const ENROLMENT_ATTEMPTS = 3

/** Postgres `unique_violation`. The only error worth a second attempt below. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && (error as { code?: unknown }).code === '23505'
}

/**
 * Forget tablets that announced themselves and were never claimed.
 *
 * `enroll` is the one thing here anybody can call without a credential, so
 * without this the table grows for as long as somebody keeps posting to it —
 * which is the actual harm in an unauthenticated endpoint, rather than the
 * guessing attack the code space already rules out. Piggybacked on enrolment
 * instead of a scheduled job: this is the only path that creates the rows, so
 * it is the only path that needs to bound them, and there is nothing to
 * schedule or to notice has stopped running.
 *
 * It is a write on an unauthenticated path, which is worth saying out loud —
 * but it deletes strictly less than the caller is about to create, it is
 * rate-limited at the route, and every row it can reach is provably worthless:
 * `AWAITING_PAIRING` means it belongs to no store, and a code that expired a
 * day ago can no longer be claimed by anyone (`claimDevice` refuses it). The
 * cascade from `presentation_sessions` cannot bite either — a menu is only ever
 * pushed to a device that is already `PAIRED`.
 */
async function sweepAbandonedEnrolments(now: Date): Promise<void> {
  await getDb()
    .delete(schema.pairedDevices)
    .where(
      and(
        eq(schema.pairedDevices.status, 'AWAITING_PAIRING'),
        lt(
          schema.pairedDevices.pairingExpiresAt,
          new Date(now.getTime() - ABANDONED_ENROLMENT_MS),
        ),
      ),
    )
}

/**
 * A tablet announcing itself for the first time.
 *
 * Creates an unclaimed device with a short code. It belongs to no store until
 * an advisor claims it, which is what makes an unclaimed code harmless: there
 * is nothing behind it to reach.
 *
 * Retried on a unique violation because migration 0027 made one possible.
 * `pairing_code` is unique among rows awaiting pairing now, so two tablets that
 * draw the same code no longer both sit there waiting — which used to mean the
 * advisor typing that code claimed whichever row the database happened to
 * return first. Better to hand the second tablet a different code than to leave
 * an arbitrary claim on the table. Both halves of the credential are drawn
 * again on a retry: the code is the one that can realistically collide, but
 * regenerating the token as well costs a `randomBytes` call and makes the retry
 * correct whichever constraint fired.
 *
 * On exhaustion the last violation propagates as it is. A 500 to a tablet that
 * shows "Connecting…" is the honest answer to a database that just refused
 * three unrelated codes; dressing it up as a pairing failure would send whoever
 * reads the log looking at the wrong thing.
 */
export async function enrollDevice(now: Date): Promise<{ token: string; code: string }> {
  await sweepAbandonedEnrolments(now)

  let lastViolation: unknown
  for (let attempt = 0; attempt < ENROLMENT_ATTEMPTS; attempt++) {
    const token = generateDeviceToken()
    const code = generatePairingCode()

    try {
      await getDb().insert(schema.pairedDevices).values({
        tokenHash: hashToken(token),
        pairingCode: code,
        pairingExpiresAt: pairingExpiry(now),
        status: 'AWAITING_PAIRING',
      })
      return { token, code }
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      lastViolation = error
    }
  }

  throw lastViolation
}

/** Resolve a bearer token to a device, or nothing. */
export async function deviceFromToken(token: string): Promise<DeviceIdentity | null> {
  if (!token) return null

  const [row] = await getDb()
    .select({
      id: schema.pairedDevices.id,
      storeId: schema.pairedDevices.storeId,
      name: schema.pairedDevices.name,
      status: schema.pairedDevices.status,
      revokedAt: schema.pairedDevices.revokedAt,
    })
    .from(schema.pairedDevices)
    // Looked up by hash, so the raw token is never compared in the database.
    .where(eq(schema.pairedDevices.tokenHash, hashToken(token)))
    .limit(1)

  if (!row || row.revokedAt) return null

  await getDb()
    .update(schema.pairedDevices)
    .set({ lastSeenAt: new Date() })
    .where(eq(schema.pairedDevices.id, row.id))

  return {
    id: row.id,
    storeId: row.storeId,
    name: row.name,
    status: row.status as DeviceIdentity['status'],
  }
}

/**
 * An advisor claims a tablet by typing the code off its screen.
 *
 * The code is single use and expires: it is cleared here whether or not the
 * pairing succeeds on the first attempt, so a code read over someone's
 * shoulder is worth nothing a minute later.
 */
export async function claimDevice(input: {
  code: string
  name: string
  storeId: string
  userId: string
  now: Date
}): Promise<{ ok: true; deviceId: string } | { ok: false; reason: string }> {
  const db = getDb()
  const code = normalizePairingCode(input.code)

  const [device] = await db
    .select()
    .from(schema.pairedDevices)
    .where(
      and(
        eq(schema.pairedDevices.pairingCode, code),
        eq(schema.pairedDevices.status, 'AWAITING_PAIRING'),
      ),
    )
    .limit(1)

  if (!device) {
    return { ok: false, reason: 'No tablet is showing that code. Check it and try again.' }
  }
  if (device.pairingExpiresAt && isPairingExpired(device.pairingExpiresAt, input.now)) {
    return { ok: false, reason: 'That code has expired. Reload the tablet for a fresh one.' }
  }

  await db
    .update(schema.pairedDevices)
    .set({
      storeId: input.storeId,
      name: input.name.trim() || 'Tablet',
      status: 'PAIRED',
      pairedByUserId: input.userId,
      pairedAt: input.now,
      // Single use. Cleared the moment it works.
      pairingCode: null,
      pairingExpiresAt: null,
    })
    .where(eq(schema.pairedDevices.id, device.id))

  return { ok: true, deviceId: device.id }
}

export async function listDevices(storeId: string) {
  return getDb()
    .select({
      id: schema.pairedDevices.id,
      name: schema.pairedDevices.name,
      status: schema.pairedDevices.status,
      lastSeenAt: schema.pairedDevices.lastSeenAt,
      pairedAt: schema.pairedDevices.pairedAt,
    })
    .from(schema.pairedDevices)
    .where(
      and(
        eq(schema.pairedDevices.storeId, storeId),
        eq(schema.pairedDevices.status, 'PAIRED'),
        isNull(schema.pairedDevices.revokedAt),
      ),
    )
    .orderBy(schema.pairedDevices.name)
}

/**
 * Unpair a tablet.
 *
 * Kills the token and the menu together. Revoking alone was enough to stop the
 * device reading anything — `deviceFromToken` refuses a revoked row and the
 * tablet 401s within a poll — but it left the session `ACTIVE`, so the advisor's
 * panel went on reporting the menu as live on a tablet that no longer exists,
 * with a "take it back" button pointed at nothing. One transaction, because a
 * device revoked without its session ended is exactly the state that produced
 * that lie.
 */
export async function revokeDevice(storeId: string, deviceId: string): Promise<void> {
  const now = new Date()

  await getDb().transaction(async (tx) => {
    await tx
      .update(schema.pairedDevices)
      .set({ status: 'REVOKED', revokedAt: now })
      .where(
        and(eq(schema.pairedDevices.id, deviceId), eq(schema.pairedDevices.storeId, storeId)),
      )

    await tx
      .update(schema.presentationSessions)
      .set({ status: 'ENDED', endedAt: now })
      .where(
        and(
          eq(schema.presentationSessions.deviceId, deviceId),
          eq(schema.presentationSessions.storeId, storeId),
          eq(schema.presentationSessions.status, 'ACTIVE'),
        ),
      )
  })
}

/**
 * Push a menu to a tablet.
 *
 * Ends whatever was on it first. A device showing one customer's menu while
 * another is being pushed is the single worst failure this feature could have,
 * so there is never more than one active session per device.
 *
 * `expiresAt` is deliberately left null, unlike a link's. A link dies at a fixed
 * hour and the column states it; a tablet dies thirty minutes after the last
 * tap, and that deadline moves every time the customer answers something. A
 * stamped column would be wrong within seconds of being written and would read
 * as a second, disagreeing mechanism. The one clock is `lastActivityAt`, checked
 * on read below.
 *
 * `sequence` is counted, not defaulted. It used to be left off the insert and
 * take the schema's default of 1, so every tablet menu on a visit claimed to be
 * the first conversation while links counted properly — the one fact migration
 * 0018 exists to record, wrong for one of the two channels (F10). The count is
 * shared with the link path rather than repeated here.
 */
export async function pushToDevice(input: {
  storeId: string
  deviceId: string
  appointmentId: string | null
  advisorId: string
  snapshot: DeviceSnapshot
}): Promise<{ sessionId: string }> {
  const db = getDb()

  await db
    .update(schema.presentationSessions)
    .set({ status: 'ENDED', endedAt: new Date() })
    .where(
      and(
        eq(schema.presentationSessions.deviceId, input.deviceId),
        eq(schema.presentationSessions.status, 'ACTIVE'),
      ),
    )

  const sequence = await nextPresentationSequence(input.appointmentId)

  const [row] = await db
    .insert(schema.presentationSessions)
    .values({
      storeId: input.storeId,
      deviceId: input.deviceId,
      appointmentId: input.appointmentId,
      advisorId: input.advisorId,
      sequence,
      snapshot: input.snapshot,
      decisions: {},
      status: 'ACTIVE',
    })
    .returning({ id: schema.presentationSessions.id })

  return { sessionId: row!.id }
}

/**
 * Close a session the clock has already closed.
 *
 * `endedAt` is the deadline — the last tap plus the idle window — not the
 * moment somebody happened to read the row. The session ended when the customer
 * stopped touching it; stamping `now` on a row nobody looked at until the next
 * morning would claim a conversation ran all night, and it would give two
 * readers racing on the same stale row two different answers. Guarded on
 * `ACTIVE` so it can never overwrite the `endedAt` of a real take-back.
 */
async function endIdleSession(sessionId: string, lastActivityAt: Date): Promise<void> {
  await getDb()
    .update(schema.presentationSessions)
    .set({ status: 'ENDED', endedAt: sessionIdleDeadline(lastActivityAt) })
    .where(
      and(
        eq(schema.presentationSessions.id, sessionId),
        eq(schema.presentationSessions.status, 'ACTIVE'),
      ),
    )
}

/**
 * What is currently on a device. Null when it is idle.
 *
 * The idle window is enforced here rather than at push time, because this is
 * the one function every device read goes through: the poll that paints the
 * screen and the tap that records an answer both resolve the session this way.
 * A menu left on a bench therefore stops being readable at the deadline whoever
 * forgot to take it back, and the row is ended in the same call so no later
 * reader — the advisor's mirror included — is left believing it is live. No
 * background job, and nothing to schedule.
 */
export async function activeSessionForDevice(deviceId: string, now: Date = new Date()) {
  const [row] = await getDb()
    .select()
    .from(schema.presentationSessions)
    .where(
      and(
        eq(schema.presentationSessions.deviceId, deviceId),
        eq(schema.presentationSessions.status, 'ACTIVE'),
      ),
    )
    .orderBy(desc(schema.presentationSessions.startedAt))
    .limit(1)

  if (!row) return null

  if (isSessionIdle(row.lastActivityAt, now)) {
    await endIdleSession(row.id, row.lastActivityAt)
    return null
  }

  return row
}

/**
 * A customer tap.
 *
 * The session is resolved from the device's own token, never from an id the
 * device sends, and the decisions are filtered against the snapshot it was
 * actually given.
 */
export async function recordDeviceDecisions(
  deviceId: string,
  incoming: unknown,
): Promise<{ decisions: Record<string, string> } | null> {
  // One clock for both halves: the tap is judged against the same instant it is
  // then stamped with, so an answer given on the boundary cannot be rejected as
  // idle and recorded as activity at the same time.
  const now = new Date()

  const session = await activeSessionForDevice(deviceId, now)
  if (!session) return null

  const snapshot = session.snapshot as DeviceSnapshot
  const merged = {
    ...(session.decisions as Record<string, string>),
    ...sanitizeDecisions(snapshot, incoming),
  }

  await getDb()
    .update(schema.presentationSessions)
    .set({ decisions: merged, lastActivityAt: now })
    .where(eq(schema.presentationSessions.id, session.id))

  return { decisions: merged }
}

/**
 * The advisor watching what the customer is doing.
 *
 * Runs the same idle check as the device's own read, and for the same reason it
 * cannot be left to that one: the advisor polls every 1.5 seconds while the
 * tablet may have been asleep, dropped in a drawer or switched off since the
 * last tap, so this is often the only reader left. Without it the mirror would
 * keep saying "on Lane 3" against a session the next device poll is going to
 * end — one reader believing a menu the other has already closed, which is the
 * disagreement this whole check exists to prevent.
 *
 * Scoped to tablet sessions. A link has its own clock (`linkStatus`) and a
 * customer answering it at lunchtime has been idle for hours entirely
 * legitimately; expiring one on thirty minutes' silence would close the
 * conversation this product most wants to keep open.
 */
export async function sessionForAdvisor(storeId: string, sessionId: string, now: Date = new Date()) {
  const [row] = await getDb()
    .select()
    .from(schema.presentationSessions)
    .where(
      and(
        eq(schema.presentationSessions.id, sessionId),
        eq(schema.presentationSessions.storeId, storeId),
      ),
    )
    .limit(1)

  if (!row) return null

  if (row.deviceId && row.status === 'ACTIVE' && isSessionIdle(row.lastActivityAt, now)) {
    await endIdleSession(row.id, row.lastActivityAt)
    // Answer with what the row now says, not what it said a moment ago. The
    // decisions the customer did give are still here and still returned — the
    // menu is over, not the answers.
    return { ...row, status: 'ENDED' as const, endedAt: sessionIdleDeadline(row.lastActivityAt) }
  }

  return row
}

/**
 * Take the menu back, and hand back what the customer had answered.
 *
 * The decisions come from the statement that ends the session rather than a
 * read after it. The advisor's mirror stops the moment this returns, so the
 * last polling interval's answers only reach their screen if this call carries
 * them — and taking them off the same `UPDATE` means what comes back is the row
 * as it stood at the instant it was closed. A second `SELECT` would be answered
 * by `sessionForAdvisor`, which has its own opinion about idle sessions, for a
 * row this call has just settled.
 *
 * Nothing is cleared: `decisions` survives on an ended row, and this is only
 * the end of the conversation, not of the record.
 */
export async function endSession(
  storeId: string,
  sessionId: string,
): Promise<{ decisions: Record<string, string> } | null> {
  const [row] = await getDb()
    .update(schema.presentationSessions)
    .set({ status: 'ENDED', endedAt: new Date() })
    .where(
      and(
        eq(schema.presentationSessions.id, sessionId),
        eq(schema.presentationSessions.storeId, storeId),
        or(
          eq(schema.presentationSessions.status, 'ACTIVE'),
          eq(schema.presentationSessions.status, 'ENDED'),
        ),
      ),
    )
    .returning({ decisions: schema.presentationSessions.decisions })

  if (!row) return null
  return { decisions: (row.decisions ?? {}) as Record<string, string> }
}
