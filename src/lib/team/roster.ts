/**
 * Who may change whose access at a dealership.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS PROTECTING AGAINST
 * ---------------------------------------------------------------------------
 * Two mistakes, both of which end with somebody ringing support:
 *
 *   1. The last manager removes themselves. Nobody left can invite anybody, so
 *      the dealership is locked out of its own staff list and the only way back
 *      in is us reaching into the database.
 *   2. The last manager demotes themselves to advisor, which is the same thing
 *      wearing a different hat and is easier to do by accident.
 *
 * Neither is exotic. A service manager tidying up the roster on their last day
 * before moving stores will do exactly this.
 *
 * ---------------------------------------------------------------------------
 * WHAT "REMOVE" MEANS
 * ---------------------------------------------------------------------------
 * Deactivating the membership, never deleting the person. An advisor who left
 * in March still wrote the repair orders from February, still owns the declined
 * services being followed up, and still appears on last quarter's scorecard.
 * Deleting the row would either orphan that history or cascade it away, and
 * both are worse than a name in a list marked "no longer here".
 *
 * Pure and I/O-free.
 */

export type StaffRole =
  | 'ADVISOR' | 'BDC' | 'TECHNICIAN' | 'DISPATCHER' | 'PARTS' | 'CASHIER'
  | 'SERVICE_MANAGER' | 'FIXED_OPS_DIRECTOR' | 'ADMIN'

export interface RosterMember {
  userId: string
  role: StaffRole
  isActive: boolean
}

/**
 * Roles that can work the staff list.
 *
 * A dealership needs at least one person holding one of these, or nobody can
 * add anybody. FIXED_OPS_DIRECTOR is included because in a group it is often
 * the only such account at a rooftop.
 */
const CAN_MANAGE_STAFF: StaffRole[] = ['SERVICE_MANAGER', 'FIXED_OPS_DIRECTOR', 'ADMIN']

export function canManageStaff(role: StaffRole): boolean {
  return CAN_MANAGE_STAFF.includes(role)
}

export type RosterDecision = { ok: true } | { ok: false; reason: string }

const ALLOWED: RosterDecision = { ok: true }
const deny = (reason: string): RosterDecision => ({ ok: false, reason })

function activeManagers(roster: RosterMember[]): RosterMember[] {
  return roster.filter((m) => m.isActive && canManageStaff(m.role))
}

/**
 * May `actor` remove `targetUserId` from this store?
 *
 * Removing yourself is allowed when somebody else can still manage the list —
 * a manager moving to another rooftop should not need to ask us to tidy up
 * behind them.
 */
export function canRemove(
  roster: RosterMember[],
  actorUserId: string,
  targetUserId: string,
): RosterDecision {
  const target = roster.find((m) => m.userId === targetUserId && m.isActive)
  if (!target) return deny('That person is not on this store’s roster.')

  const actor = roster.find((m) => m.userId === actorUserId && m.isActive)
  if (!actor || !canManageStaff(actor.role)) {
    return deny('Only a service manager or administrator can change the roster.')
  }

  if (canManageStaff(target.role) && activeManagers(roster).length <= 1) {
    return deny(
      targetUserId === actorUserId
        ? 'You are the only person who can manage staff here. Promote somebody else first, or nobody will be able to add advisors.'
        : 'That is the only person who can manage staff here. Promote somebody else first.',
    )
  }

  return ALLOWED
}

/**
 * May `actor` change `targetUserId` to `nextRole`?
 *
 * The same last-manager rule, because demoting the only manager locks the
 * dealership out just as thoroughly as removing them — and is the easier of
 * the two to do without noticing.
 */
export function canChangeRole(
  roster: RosterMember[],
  actorUserId: string,
  targetUserId: string,
  nextRole: StaffRole,
): RosterDecision {
  const target = roster.find((m) => m.userId === targetUserId && m.isActive)
  if (!target) return deny('That person is not on this store’s roster.')

  const actor = roster.find((m) => m.userId === actorUserId && m.isActive)
  if (!actor || !canManageStaff(actor.role)) {
    return deny('Only a service manager or administrator can change the roster.')
  }

  if (target.role === nextRole) return deny('They already hold that role.')

  const losingTheirAuthority = canManageStaff(target.role) && !canManageStaff(nextRole)
  if (losingTheirAuthority && activeManagers(roster).length <= 1) {
    return deny(
      targetUserId === actorUserId
        ? 'You are the only person who can manage staff here. Promote somebody else before stepping down.'
        : 'That is the only person who can manage staff here. Promote somebody else first.',
    )
  }

  return ALLOWED
}

/** Restoring somebody who came back needs no special care beyond authority. */
export function canRestore(
  roster: RosterMember[],
  actorUserId: string,
  targetUserId: string,
): RosterDecision {
  const actor = roster.find((m) => m.userId === actorUserId && m.isActive)
  if (!actor || !canManageStaff(actor.role)) {
    return deny('Only a service manager or administrator can change the roster.')
  }
  const target = roster.find((m) => m.userId === targetUserId && !m.isActive)
  if (!target) return deny('That person is already on the roster.')
  return ALLOWED
}
