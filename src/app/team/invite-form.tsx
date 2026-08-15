'use client'

import { useActionState, useState } from 'react'
import { inviteStaff, type InviteState } from './actions'
import { INVITABLE_ROLES } from '@/lib/invites/invite'

const INITIAL: InviteState = {}

export function InviteForm({ origin }: { origin: string }) {
  const [state, formAction, pending] = useActionState(inviteStaff, INITIAL)
  const [copied, setCopied] = useState(false)

  const fullLink = state.link ? `${origin}${state.link}` : null

  return (
    <div>
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <div className="min-w-[16rem] flex-1">
          <label htmlFor="email" className="block text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Work email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            placeholder="advisor@dealership.com"
            className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-300"
          />
        </div>
        <div>
          <label htmlFor="role" className="block text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Role
          </label>
          <select
            id="role"
            name="role"
            defaultValue="ADVISOR"
            className="mt-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-300"
          >
            {INVITABLE_ROLES.map((r) => (
              <option key={r.code} value={r.code}>{r.label}</option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {pending ? 'Creating…' : 'Create invitation'}
        </button>
      </form>

      {state.error && (
        <p className="mt-3 rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-100">
          {state.error}
        </p>
      )}

      {fullLink && (
        <div className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950">
          <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
            Invitation ready for {state.invitedEmail}
          </p>
          {/*
            Shown once, and said so plainly.

            Only the hash is stored, so this really is the only moment the link
            exists on our side. A manager who closes the tab has to revoke and
            re-invite — which is the right behaviour for something that grants
            access, and worth being explicit about rather than discovering.
          */}
          <p className="mt-1 text-xs text-emerald-900/80 dark:text-emerald-200/80">
            Send it to them yourself — we do not email invitations yet. This is the only time it is
            shown; if you lose it, revoke and invite again.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <input
              readOnly
              value={fullLink}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 rounded-md border border-emerald-300 bg-white px-2 py-1.5 font-mono text-xs dark:border-emerald-800 dark:bg-neutral-950"
            />
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(fullLink).then(() => setCopied(true))
              }}
              className="shrink-0 rounded-md bg-emerald-800 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 dark:bg-emerald-200 dark:text-emerald-950"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
