'use client'

import { useActionState, useState } from 'react'
import { signIn, type SignInState } from './actions'

const INITIAL: SignInState = {}

/** Matches scripts/provision-auth-users.ts. Development only. */
const DEMO_PASSWORD = 'dealertech-demo'

export interface DemoUser {
  email: string
  name: string
  role: string
  note: string
}

export function SignInForm({ next, demoUsers }: { next: string; demoUsers: DemoUser[] }) {
  const [state, action, pending] = useActionState(signIn, INITIAL)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  return (
    <>
      <form action={action} className="mt-8 space-y-3">
        <input type="hidden" name="next" value={next} />

        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Email
          </span>
          <input
            name="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3 text-sm outline-none focus:border-neutral-900 dark:focus:border-neutral-300"
          />
        </label>

        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Password
          </span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3 text-sm outline-none focus:border-neutral-900 dark:focus:border-neutral-300"
          />
        </label>

        {state.error && (
          <p className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2.5 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200">
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="touch-target w-full rounded-xl bg-neutral-900 px-4 py-3.5 text-sm font-bold text-white transition active:scale-[0.98] disabled:opacity-60 dark:bg-white dark:text-neutral-900"
        >
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      {demoUsers.length > 0 && (
        <section className="mt-8">
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-neutral-500">
            Demo accounts
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            Development only. Tap one to fill the form, then sign in.
          </p>
          <ul className="mt-2 space-y-2">
            {demoUsers.map((u) => (
              <li key={u.email}>
                <button
                  type="button"
                  onClick={() => {
                    setEmail(u.email)
                    setPassword(DEMO_PASSWORD)
                  }}
                  className="touch-target flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--border)] px-3.5 py-2.5 text-left transition active:scale-[0.98] hover:border-neutral-900 dark:hover:border-neutral-300"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-bold">{u.name}</span>
                    <span className="block truncate text-xs text-neutral-500">{u.note}</span>
                  </span>
                  <span className="shrink-0 rounded-full bg-[var(--surface-muted)] px-2.5 py-1 text-[11px] font-semibold text-neutral-600 dark:text-neutral-400">
                    {u.role}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}
