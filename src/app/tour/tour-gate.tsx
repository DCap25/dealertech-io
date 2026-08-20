'use client'

import { useActionState } from 'react'
import { unlockTour, startTour, type TourGateState, type TourStartState } from './actions'

const UNLOCK_INITIAL: TourGateState = {}
const START_INITIAL: TourStartState = {}

interface RoleChoice {
  code: string
  label: string
  sees: string
}

/**
 * Two steps in one component: the code box, then the role picker.
 *
 * ---------------------------------------------------------------------------
 * WHY THE VALIDATED CODE LIVES IN A HIDDEN FIELD
 * ---------------------------------------------------------------------------
 * The alternative is a short-lived cookie holding "this browser has proved a
 * code", which is what most gates do. It would make `/legal/cookies` false —
 * that page promises an anonymous visitor receives zero cookies and that
 * signing in is the first one — and the fix would be a paragraph of exception
 * rather than a promise anybody can check.
 *
 * The hidden field is not a security control and is not doing any work as one.
 * `startTour` re-validates the code against the database on every submission,
 * so what is in this form is a convenience for the visitor who typed it, not
 * evidence of anything. See the note at the top of ./actions.
 */
export function TourGate({ roles }: { roles: RoleChoice[] }) {
  const [gate, unlockAction, unlocking] = useActionState(unlockTour, UNLOCK_INITIAL)
  const [start, startAction, starting] = useActionState(startTour, START_INITIAL)

  if (gate.unlocked) {
    return (
      <div>
        <div className="rounded-2xl border border-emerald-300 bg-emerald-50/60 p-4 dark:border-emerald-800 dark:bg-emerald-950/40">
          <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
            Code accepted — {gate.unlocked.label}
          </p>
          <p className="mt-1 text-sm text-emerald-900/80 dark:text-emerald-200/80">
            Pick who you want to be. You can come back and pick another one; the code keeps working
            until it expires.
          </p>
        </div>

        <h2 className="mt-8 text-xl font-bold tracking-tight">Who do you want to be?</h2>

        <form action={startAction} className="mt-4 space-y-3">
          <input type="hidden" name="code" value={gate.unlocked.code} />
          {roles.map((role) => (
            <button
              key={role.code}
              type="submit"
              name="role"
              value={role.code}
              disabled={starting}
              className="touch-target group block w-full rounded-2xl border border-[var(--rule)] p-4 text-left transition hover:border-[var(--ink)] disabled:opacity-50"
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="text-base font-bold tracking-tight">{role.label}</span>
                <span className="shrink-0 text-xs font-semibold text-[var(--ink-soft)] transition group-hover:text-[var(--ink)]">
                  {starting ? 'Opening…' : 'Start →'}
                </span>
              </span>
              <span className="mt-1 block text-sm text-neutral-600 dark:text-neutral-400">
                {role.sees}
              </span>
            </button>
          ))}
        </form>

        {start.error && <Problem>{start.error}</Problem>}
      </div>
    )
  }

  return (
    <form action={unlockAction} className="max-w-md">
      <label
        htmlFor="tour-code"
        className="block text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--ink-soft)]"
      >
        Access code
      </label>
      <div className="mt-2 flex gap-2">
        <input
          id="tour-code"
          name="code"
          required
          autoFocus
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          // 12 rather than 10: the code is printed with a hyphen in the middle
          // and a prospect pastes what they were sent. The normaliser strips
          // it, but an input that refuses the last character of what is on
          // their screen looks broken before it can explain itself.
          maxLength={12}
          placeholder="FKMT9-PQR34"
          className="min-w-0 flex-1 rounded-xl border border-[var(--rule)] bg-transparent px-4 py-3 font-mono text-lg uppercase tracking-[0.2em] outline-none transition placeholder:tracking-normal placeholder:text-neutral-400 focus:border-[var(--ink)]"
        />
        <button
          type="submit"
          disabled={unlocking}
          className="touch-target shrink-0 rounded-xl bg-[var(--ink)] px-5 py-3 text-sm font-semibold text-[var(--paper)] transition hover:opacity-85 disabled:opacity-50"
        >
          {unlocking ? 'Checking…' : 'Unlock'}
        </button>
      </div>

      {gate.error && <Problem>{gate.error}</Problem>}
    </form>
  )
}

function Problem({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="mt-3 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-100"
    >
      {children}
    </p>
  )
}
