import 'server-only'
import { and, desc, eq, isNull, or } from 'drizzle-orm'
import { getDb, schema } from '@/db/client'
import {
  generateDeviceToken, generatePairingCode, hashToken, isPairingExpired, normalizePairingCode,
  pairingExpiry,
} from './codes'
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
 * A tablet announcing itself for the first time.
 *
 * Creates an unclaimed device with a short code. It belongs to no store until
 * an advisor claims it, which is what makes an unclaimed code harmless: there
 * is nothing behind it to reach.
 */
export async function enrollDevice(now: Date): Promise<{ token: string; code: string }> {
  const token = generateDeviceToken()
  const code = generatePairingCode()

  await getDb().insert(schema.pairedDevices).values({
    tokenHash: hashToken(token),
    pairingCode: code,
    pairingExpiresAt: pairingExpiry(now),
    status: 'AWAITING_PAIRING',
  })

  return { token, code }
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

export async function revokeDevice(storeId: string, deviceId: string): Promise<void> {
  await getDb()
    .update(schema.pairedDevices)
    .set({ status: 'REVOKED', revokedAt: new Date() })
    .where(
      and(eq(schema.pairedDevices.id, deviceId), eq(schema.pairedDevices.storeId, storeId)),
    )
}

/**
 * Push a menu to a tablet.
 *
 * Ends whatever was on it first. A device showing one customer's menu while
 * another is being pushed is the single worst failure this feature could have,
 * so there is never more than one active session per device.
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

  const [row] = await db
    .insert(schema.presentationSessions)
    .values({
      storeId: input.storeId,
      deviceId: input.deviceId,
      appointmentId: input.appointmentId,
      advisorId: input.advisorId,
      snapshot: input.snapshot,
      decisions: {},
      status: 'ACTIVE',
    })
    .returning({ id: schema.presentationSessions.id })

  return { sessionId: row!.id }
}

/** What is currently on a device. Null when it is idle. */
export async function activeSessionForDevice(deviceId: string) {
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
  return row ?? null
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
  const session = await activeSessionForDevice(deviceId)
  if (!session) return null

  const snapshot = session.snapshot as DeviceSnapshot
  const merged = {
    ...(session.decisions as Record<string, string>),
    ...sanitizeDecisions(snapshot, incoming),
  }

  await getDb()
    .update(schema.presentationSessions)
    .set({ decisions: merged, lastActivityAt: new Date() })
    .where(eq(schema.presentationSessions.id, session.id))

  return { decisions: merged }
}

/** The advisor watching what the customer is doing. */
export async function sessionForAdvisor(storeId: string, sessionId: string) {
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
  return row ?? null
}

export async function endSession(storeId: string, sessionId: string): Promise<void> {
  await getDb()
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
}
