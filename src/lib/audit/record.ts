import 'server-only'
import { schema } from '@/db/client'
import type { ScopedDb } from '@/db/scoped'
import { buildAuditRow, type AuditEvent } from './events'

/**
 * Write one audit row on the caller's connection.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS TAKES A `db` AND DOES NOT FETCH ITS OWN
 * ---------------------------------------------------------------------------
 * Every caller is already inside a transaction — the actions that are worth
 * auditing are exactly the ones doing several writes at once. Passing the
 * handle in means the audit row commits with the work it describes, and that
 * cuts both ways: a repair order that rolls back leaves no record claiming it
 * closed, and a close that succeeds cannot end up unlogged.
 *
 * The alternative — firing the write off separately so it never delays the
 * advisor — sounds attractive and is wrong here. It buys perhaps a
 * millisecond, and pays for it with a log that disagrees with the database it
 * describes. An audit trail is worth having precisely when something went
 * wrong, which is the moment a fire-and-forget write is most likely to be the
 * thing that was lost. It would also deadlock: the pool is `max: 1` behind a
 * pooler, so "separately" means a second connection while the first is held.
 *
 * One INSERT alongside the five or six the action already performs is the
 * lightweight option, not the expensive one.
 *
 * ---------------------------------------------------------------------------
 * AND WHY IT NEVER THROWS
 * ---------------------------------------------------------------------------
 * Auditing is a record of the work, not a precondition for it. If this insert
 * fails — a constraint nobody anticipated, a column that moved — an advisor
 * mid-drive should not lose a repair order over it. The failure is logged
 * server-side where it can be found and fixed.
 *
 * That is a deliberate asymmetry and worth being clear-eyed about: it means
 * the log can have gaps. It cannot have lies, which is the property that
 * matters. A record that says something happened is trustworthy; the absence
 * of one is not proof it did not.
 */
export async function recordAudit(db: ScopedDb, event: AuditEvent): Promise<void> {
  const row = buildAuditRow(event)
  if (!row) return

  try {
    await db.insert(schema.auditLog).values(row)
  } catch (error) {
    console.error(`[audit] could not record ${event.action}:`, error)
  }
}
