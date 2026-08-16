'use client'

import { useActionState, useState } from 'react'
import { signIn, type SignInState } from './actions'

const INITIAL: SignInState = {}

/**
 * The demo password, if this machine has been told it.
 *
 * It used to be the literal string, matching the committed default in
 * provision-auth-users.ts. That made the one-tap cards work and also meant the
 * password to six live accounts was sitting in a source file — and the moment
 * those accounts were rotated, the cards silently filled the wrong one and
 * "sign in" started failing for no visible reason.
 *
 * Read from the environment instead, and absent by default. Set it in
 * .env.local alongside the rest of your local config and one-tap works as
 * before; leave it unset and the cards fill the address only, which is still
 * most of the typing. Either way nothing that opens a real account is in the
 * repository.
 *
 * NEXT_PUBLIC_ because the fill happens in the browser. That is safe here and
 * only here: the cards render solely outside production, and a value that is
 * never set on the deployed site cannot be inlined into its bundle.
 */
const DEMO_PASSWORD = process.env.NEXT_PUBLIC_DEMO_PASSWORD ?? ''

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
            {DEMO_PASSWORD
              ? 'Development only. Tap one to fill the form, then sign in.'
              : 'Development only. Tap one to fill the address — set NEXT_PUBLIC_DEMO_PASSWORD in .env.local to fill the password too.'}
          </p>
          <ul className="mt-2 space-y-2">
            {demoUsers.map((u) => (
              <li key={u.email}>
                <button
                  type="button"
                  onClick={() => {
                    setEmail(u.email)
                    // Only when this machine knows it. Overwriting a password
                    // the developer just typed with an empty string would be
                    // worse than leaving the field alone.
                    if (DEMO_PASSWORD) setPassword(DEMO_PASSWORD)
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
