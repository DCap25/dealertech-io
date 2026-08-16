'use client'

import { useActionState, useState } from 'react'
import {
  compAccount, extendTrial, grantSupportAccess, reactivateAccount, revokeSupportAccess,
  suspendAccount, winBackAccount, type TenantActionState,
} from '../actions'

const INITIAL: TenantActionState = {}

const field =
  'mt-1 w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-300'
const label = 'block text-xs font-semibold uppercase tracking-wide text-neutral-500'
const button =
  'touch-target rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-semibold hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900'

function Result({ state }: { state: TenantActionState }) {
  if (state.error) {
    return (
      <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:bg-rose-950 dark:text-rose-200">
        {state.error}
      </p>
    )
  }
  if (state.ok) {
    return (
      <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
        {state.ok}
      </p>
    )
  }
  return null
}

/**
 * One collapsed form per lifecycle action.
 *
 * ---------------------------------------------------------------------------
 * WHY EVERY ONE ASKS FOR A REASON BEFORE IT WILL FIRE
 * ---------------------------------------------------------------------------
 * These are the buttons that decide whether a dealership can work. A reason
 * box is a small piece of friction in exactly the place friction is worth
 * having — it is the difference between a lifecycle history somebody can
 * review in six months and a list of state changes with no explanation
 * attached to any of them.
 *
 * The server requires it too. This is a nicety, not the enforcement.
 */
function ActionForm({
  action,
  organizationId,
  title,
  description,
  submitLabel,
  danger = false,
  children,
}: {
  action: (prev: TenantActionState, data: FormData) => Promise<TenantActionState>
  organizationId: string
  title: string
  description: string
  submitLabel: string
  danger?: boolean
  children?: React.ReactNode
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL)
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={button}>
        {title}
      </button>
    )
  }

  return (
    <form action={formAction} className="w-full rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <input type="hidden" name="organizationId" value={organizationId} />
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-0.5 text-xs text-neutral-500">{description}</p>

      {children}

      <label className={`${label} mt-3`} htmlFor={`reason-${title}`}>
        Reason
      </label>
      <input
        id={`reason-${title}`}
        name="reason"
        className={field}
        placeholder="Ticket number, or what was agreed and with whom"
      />

      <div className="mt-3 flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className={`touch-target rounded-lg px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50 ${
            danger ? 'bg-rose-700 hover:bg-rose-800' : 'bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:text-neutral-900'
          }`}
        >
          {pending ? 'Working…' : submitLabel}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={button}>
          Cancel
        </button>
      </div>

      <Result state={state} />
    </form>
  )
}

export function LifecycleActions({
  organizationId,
  status,
}: {
  organizationId: string
  status: string
}) {
  return (
    <div className="flex flex-wrap items-start gap-2 p-4">
      {(status === 'TRIAL' || status === 'EXPIRED') && (
        <ActionForm
          action={extendTrial}
          organizationId={organizationId}
          title="Extend trial"
          description="Measured from today, not from the old deadline — so extending a lapsed trial gives a date in the future."
          submitLabel="Extend"
        >
          <label className={`${label} mt-3`} htmlFor="days">Days</label>
          <input id="days" name="days" type="number" min={1} max={180} defaultValue={30} className={field} />
        </ActionForm>
      )}

      {status !== 'COMPED' && status !== 'CHURNED' && (
        <ActionForm
          action={compAccount}
          organizationId={organizationId}
          title="Comp"
          description="Full access, no subscription, no expiry. Behaves exactly as ACTIVE."
          submitLabel="Comp this account"
        />
      )}

      {status === 'RESTRICTED' && (
        <ActionForm
          action={suspendAccount}
          organizationId={organizationId}
          title="Suspend"
          description="Stops new work. Records stay readable. Only reachable from RESTRICTED, so the grace period has already run."
          submitLabel="Suspend"
          danger
        />
      )}

      {(status === 'SUSPENDED' || status === 'RESTRICTED' || status === 'EXPIRED') && (
        <ActionForm
          action={reactivateAccount}
          organizationId={organizationId}
          title="Reactivate"
          description="Back to ACTIVE immediately."
          submitLabel="Reactivate"
        />
      )}

      {status === 'CHURNED' && (
        <ActionForm
          action={winBackAccount}
          organizationId={organizationId}
          title="Win back"
          description="Starts a fresh 30-day trial. A returning dealership has no subscription behind them any more."
          submitLabel="Start win-back"
        />
      )}
    </div>
  )
}

/**
 * Granting yourself a role at a dealership, with a deadline.
 *
 * The expiry is not optional and cannot be waived from this form. That is the
 * point: the failure mode this replaces is a grant made on a Tuesday that is
 * still live in November.
 */
export function SupportAccess({
  organizationId,
  stores,
  grants,
}: {
  organizationId: string
  stores: { id: string; name: string }[]
  grants: { roleId: string; name: string; storeId: string; expiresAt: string }[]
}) {
  const [state, formAction, pending] = useActionState(grantSupportAccess, INITIAL)
  const [revokeState, revokeAction] = useActionState(revokeSupportAccess, INITIAL)

  return (
    <div className="p-4">
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        The console cannot reach this dealership&rsquo;s customers. Looking at their data means
        holding a role at one of their rooftops — which appears on{' '}
        <span className="font-semibold">their</span> team page, and lapses on its own.
      </p>

      {grants.length > 0 && (
        <ul className="mt-3 divide-y divide-neutral-100 rounded-lg border border-amber-300 dark:divide-neutral-800 dark:border-amber-800">
          {grants.map((g) => (
            <li key={g.roleId} className="flex items-center justify-between gap-3 p-3">
              <p className="text-sm">
                <span className="font-semibold">{g.name}</span>
                <span className="ml-2 text-xs text-neutral-500">
                  until {new Date(g.expiresAt).toISOString().slice(0, 16).replace('T', ' ')}
                </span>
              </p>
              <form action={revokeAction}>
                <input type="hidden" name="organizationId" value={organizationId} />
                <input type="hidden" name="roleId" value={g.roleId} />
                <button type="submit" className={button}>Revoke now</button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <Result state={revokeState} />

      <form action={formAction} className="mt-4 grid gap-3 sm:grid-cols-3">
        <input type="hidden" name="organizationId" value={organizationId} />
        <div>
          <label className={label} htmlFor="storeId">Rooftop</label>
          <select id="storeId" name="storeId" className={field} required>
            <option value="">Choose…</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="hours">Hours</label>
          <input id="hours" name="hours" type="number" min={1} max={72} defaultValue={24} className={field} />
        </div>
        <div>
          <label className={label} htmlFor="support-reason">Ticket / reason</label>
          <input id="support-reason" name="reason" className={field} required />
        </div>
        <div className="sm:col-span-3">
          <button type="submit" disabled={pending} className={button}>
            {pending ? 'Granting…' : 'Grant access'}
          </button>
        </div>
      </form>

      <Result state={state} />
    </div>
  )
}
