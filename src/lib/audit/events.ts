/**
 * What the audit log is for, and what it must never become.
 *
 * ---------------------------------------------------------------------------
 * A CLOSED VOCABULARY
 * ---------------------------------------------------------------------------
 * `action` is a text column, which means it would happily accept
 * "role_changed", "ROLE_CHANGE" and "Changed role" as three different things.
 * A log nobody can query is a log nobody reads, so the set is fixed here and
 * the compiler enforces it. Adding an action is a deliberate edit to this
 * list, which is also the moment to decide whether it belongs.
 *
 * ---------------------------------------------------------------------------
 * WHAT GOES IN, AND WHAT MUST NOT
 * ---------------------------------------------------------------------------
 * Enough to answer "who did what, to which record, when, and what changed" —
 * ids and small facts. Not customer contact details, not the contents of a
 * photographed contract, and above all not credentials. This table outlives
 * everything around it: rows are never updated or deleted (see 0020), so
 * anything written here is written permanently, and a bearer token that lands
 * in it stays valid and readable for as long as the log does.
 *
 * Pure and I/O-free. The insert lives in ./record.
 */

export const AUDIT_ACTIONS = [
  /** An advisor accepted an odometer reading below the last one on record. */
  'ODOMETER_ROLLBACK_OVERRIDDEN',
  /** Money changed hands. */
  'REPAIR_ORDER_CLOSED',
  /** What we told the DMS, and whether it took it. */
  'DMS_HANDOFF_PUSHED',
  /** A customer confirmed a menu on their own phone. */
  'MENU_AUTHORISED',
  /** Coverage was added to a vehicle from a photographed document. */
  'CONTRACT_CONFIRMED',
  'STAFF_INVITED',
  'STAFF_INVITE_REVOKED',
  'STAFF_REMOVED',
  'STAFF_RESTORED',
  'STAFF_ROLE_CHANGED',
  /** A dealership moved between commercial states — trialled, comped, suspended. */
  'TENANT_LIFECYCLE_CHANGED',
  /**
   * A subscription was set to end when its paid period does, or that was
   * called off.
   *
   * Separate from `TENANT_LIFECYCLE_CHANGED` because scheduling a cancellation
   * moves no lifecycle status at all — the tenant stays ACTIVE until the
   * period actually runs out. Without its own action, the single most
   * consequential thing anybody does in the console would leave no audit trace
   * until the day it took effect.
   */
  'SUBSCRIPTION_CANCEL_SCHEDULED',
  'SUBSCRIPTION_CANCEL_REVERSED',
  /** Somebody rang a lead back and wrote down what happened. */
  'LEAD_OUTCOME_RECORDED',
  /**
   * DealerTech staff granted themselves a role at a dealership.
   *
   * The single mechanism by which anyone outside a store can reach its
   * customers, so it is audited at the moment of granting rather than only
   * being visible in the roster. The dealership sees it on their own team
   * page too — that is the design, not an oversight.
   */
  'SUPPORT_ACCESS_GRANTED',
  'SUPPORT_ACCESS_REVOKED',
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export interface AuditEvent {
  action: AuditAction
  /** The table the entity lives in, so `entity_type + entity_id` is resolvable. */
  entityType: string
  entityId: string | null
  storeId: string | null
  /**
   * Null when nobody was signed in — a customer authorising a menu from their
   * phone has no account, and pretending the advisor did it would be a lie in
   * the one record that exists to prevent lies.
   */
  userId: string | null
  changes?: Record<string, unknown> | null
}

export interface AuditRow {
  action: string
  entityType: string
  entityId: string | null
  storeId: string | null
  userId: string | null
  changes: string | null
}

/**
 * Keys whose values never belong in a permanent record.
 *
 * Matched on the key name rather than the value, because a token is only
 * recognisable by what it is called. Case- and separator-insensitive so
 * `tokenHash`, `token_hash` and `TOKEN` are all caught.
 */
const FORBIDDEN_KEY_PARTS = [
  'token', 'password', 'secret', 'apikey', 'authorization', 'cookie',
  'imagebase64', 'tokenhash', 'ssn',
]

/** Long enough for a real before/after, short enough that one row cannot bloat the table. */
export const MAX_CHANGES_CHARS = 4_000

function isForbidden(key: string): boolean {
  const flat = key.toLowerCase().replace(/[^a-z0-9]/g, '')
  return FORBIDDEN_KEY_PARTS.some((part) => flat.includes(part))
}

/**
 * Strip anything that must not be kept, at any depth.
 *
 * Redacts rather than drops: a key that was present and removed is itself worth
 * knowing about, and a silent omission reads the same as a field that was never
 * set. Arrays keep their shape so positions still line up.
 */
export function sanitiseChanges(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[too deep]'
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => sanitiseChanges(v, depth + 1))

  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isForbidden(key) ? '[redacted]' : sanitiseChanges(v, depth + 1)
  }
  return out
}

/**
 * The row to insert, or null when there is nothing worth recording.
 *
 * Returns null rather than throwing on an unknown action. This is called from
 * inside the transaction that performs the real work, and an audit helper that
 * can abort a repair order because somebody mistyped a constant would be a
 * worse problem than the gap in the log.
 */
export function buildAuditRow(event: AuditEvent): AuditRow | null {
  if (!AUDIT_ACTIONS.includes(event.action)) return null

  let changes: string | null = null
  if (event.changes && Object.keys(event.changes).length > 0) {
    const safe = sanitiseChanges(event.changes)
    const json = JSON.stringify(safe)
    changes = json.length > MAX_CHANGES_CHARS
      ? `${json.slice(0, MAX_CHANGES_CHARS)}…[truncated]`
      : json
  }

  return {
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    storeId: event.storeId,
    userId: event.userId,
    changes,
  }
}
