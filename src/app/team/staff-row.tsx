'use client'

import { useActionState, useEffect, useState } from 'react'
import { changeRole, removeStaff, restoreStaff, type RosterState } from './actions'
import { INVITABLE_ROLES } from '@/lib/invites/invite'

const INITIAL: RosterState = {}

export interface StaffMember {
  userId: string
  name: string
  email: string
  role: string
  isActive: boolean
  /** The signed-in manager, so the row can say "you" instead of a name. */
  isSelf: boolean
}

/**
 * One person on the roster, with the two things a manager actually does to
 * them: change what they are, or take them off.
 *
 * Each row owns its own action state so a refusal lands next to the person it
 * is about. A single banner at the top of the page would leave a manager
 * hunting for which of eleven advisors it referred to.
 */
export function StaffRow({ member }: { member: StaffMember }) {
  const [roleState, roleAction, rolePending] = useActionState(changeRole, INITIAL)
  const [removeState, removeAction, removePending] = useActionState(removeStaff, INITIAL)
  const [restoreState, restoreAction, restorePending] = useActionState(restoreStaff, INITIAL)
  const [confirming, setConfirming] = useState(false)

  const error = roleState.error ?? removeState.error ?? restoreState.error

  /*
    Drop the confirmation when the row changes side.

    React keeps this component mounted across a remove and a later put-back,
    so without this the restored row would come back already asking whether to
    remove them again.
  */
  useEffect(() => { setConfirming(false) }, [member.isActive])

  return (
    <li className="p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className={`text-sm font-medium ${member.isActive ? '' : 'text-neutral-500 line-through'}`}>
            {member.name}
            {member.isSelf && <span className="ml-2 text-xs font-normal text-neutral-500">you</span>}
          </p>
          <p className="text-xs text-neutral-500">{member.email}</p>
        </div>

        {member.isActive ? (
          <div className="flex items-center gap-2">
            <form action={roleAction} className="flex items-center gap-1.5">
              <input type="hidden" name="userId" value={member.userId} />
              <label className="sr-only" htmlFor={`role-${member.userId}`}>Role</label>
              <select
                id={`role-${member.userId}`}
                name="role"
                defaultValue={member.role}
                className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-950"
              >
                {/* The current role appears even if it is not one we hand out,
                    so a DISPATCHER or PARTS account does not silently look
                    like an advisor in the dropdown. */}
                {!INVITABLE_ROLES.some((r) => r.code === member.role) && (
                  <option value={member.role}>{member.role}</option>
                )}
                {INVITABLE_ROLES.map((r) => (
                  <option key={r.code} value={r.code}>{r.label}</option>
                ))}
              </select>
              <button
                type="submit"
                disabled={rolePending}
                className="rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium transition hover:border-neutral-900 disabled:opacity-50 dark:border-neutral-700 dark:hover:border-neutral-300"
              >
                {rolePending ? '…' : 'Save'}
              </button>
            </form>

            {/*
              Two steps, and the second one names them.

              A native confirm() would block the page and could only say "are
              you sure?" — which is the least useful question available. The
              risk being guarded against is not hesitation, it is clicking the
              row above the one you meant, and only a name catches that.
            */}
            {!confirming ? (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium transition hover:border-rose-500 hover:text-rose-700 dark:border-neutral-700 dark:hover:border-rose-500 dark:hover:text-rose-400"
              >
                Remove
              </button>
            ) : (
              <form action={removeAction} className="flex items-center gap-1.5">
                <input type="hidden" name="userId" value={member.userId} />
                <button
                  type="submit"
                  disabled={removePending}
                  className="rounded-md bg-rose-700 px-2 py-1 text-xs font-semibold text-white transition hover:bg-rose-600 disabled:opacity-50"
                >
                  {removePending ? 'Removing…' : `Yes, remove ${member.isSelf ? 'me' : member.name.split(' ')[0]}`}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium dark:border-neutral-700"
                >
                  Cancel
                </button>
              </form>
            )}
          </div>
        ) : (
          <form action={restoreAction} className="flex items-center gap-2">
            <input type="hidden" name="userId" value={member.userId} />
            <span className="text-xs text-neutral-500">no longer here</span>
            <button
              type="submit"
              disabled={restorePending}
              className="rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium transition hover:border-neutral-900 disabled:opacity-50 dark:border-neutral-700 dark:hover:border-neutral-300"
            >
              {restorePending ? '…' : 'Put back'}
            </button>
          </form>
        )}
      </div>

      {confirming && !error && (
        <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-400">
          {member.isSelf
            ? 'You will lose access to this dealership immediately. Work already on a repair order stays in your name, and another manager can put you back.'
            : `${member.name} loses access immediately. Work already on a repair order stays in their name, and you can put them back.`}
        </p>
      )}

      {error && (
        <p className="mt-2 rounded-md border border-rose-300 bg-rose-50 p-2 text-xs text-rose-900 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-100">
          {error}
        </p>
      )}
    </li>
  )
}
