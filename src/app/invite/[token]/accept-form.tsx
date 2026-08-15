'use client'

import { useActionState } from 'react'
import { acceptInvitation, type AcceptState } from './actions'

const INITIAL: AcceptState = {}

export function AcceptForm({ token, email }: { token: string; email: string }) {
  const [state, formAction, pending] = useActionState(acceptInvitation, INITIAL)

  return (
    <form action={formAction} className="mt-6 space-y-4">
      <input type="hidden" name="token" value={token} />

      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Work email
        </label>
        {/*
          Shown, not editable. The invitation was addressed to this account and
          letting it be changed here would turn a forwarded link into a way to
          join a dealership you were never invited to.
        */}
        <p className="mt-1 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-900">
          {email}
        </p>
      </div>

      <div>
        <label htmlFor="fullName" className="block text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Your name
        </label>
        <input
          id="fullName"
          name="fullName"
          type="text"
          required
          autoComplete="name"
          className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-300"
        />
        <p className="mt-1 text-xs text-neutral-500">
          As you want it to appear on repair orders.
        </p>
      </div>

      <div>
        <label htmlFor="password" className="block text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Choose a password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
          className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-300"
        />
        <p className="mt-1 text-xs text-neutral-500">
          At least 10 characters. Length matters more than symbols.
        </p>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
      >
        {pending ? 'Setting up…' : 'Create my account'}
      </button>

      {state.error && (
        <p className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-100">
          {state.error}
        </p>
      )}
    </form>
  )
}
