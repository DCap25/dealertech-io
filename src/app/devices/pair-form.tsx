'use client'

import { useActionState } from 'react'
import { pairDevice, unpairDevice, type PairState } from './actions'

export function PairForm() {
  const [state, action, pending] = useActionState<PairState, FormData>(pairDevice, {
    status: 'IDLE',
  })

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr]">
        <div>
          <label htmlFor="code" className="text-sm font-semibold">
            Code on the tablet
          </label>
          <input
            id="code"
            name="code"
            required
            maxLength={8}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="7K2QW4"
            className="mt-1.5 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 font-mono text-lg uppercase tracking-widest"
          />
        </div>
        <div>
          <label htmlFor="name" className="text-sm font-semibold">
            Call it
          </label>
          <input
            id="name"
            name="name"
            required
            maxLength={40}
            placeholder="Lane 3"
            className="mt-1.5 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="touch-target w-full rounded-xl bg-neutral-900 px-4 py-3 text-sm font-bold text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
      >
        {pending ? 'Pairing…' : 'Pair this tablet'}
      </button>

      {state.message && (
        <p
          className={`rounded-xl px-3 py-2 text-sm ${
            state.status === 'ERROR'
              ? 'bg-rose-50 text-rose-800 dark:bg-rose-950 dark:text-rose-200'
              : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
          }`}
        >
          {state.message}
        </p>
      )}
    </form>
  )
}

export function UnpairButton({ deviceId, name }: { deviceId: string; name: string }) {
  const [, action, pending] = useActionState<PairState, FormData>(unpairDevice, { status: 'IDLE' })

  return (
    <form action={action}>
      <input type="hidden" name="deviceId" value={deviceId} />
      <button
        type="submit"
        disabled={pending}
        aria-label={`Unpair ${name}`}
        className="touch-target rounded-xl border border-[var(--border)] px-3.5 py-2 text-xs font-semibold text-neutral-600 transition hover:border-rose-500 hover:text-rose-700 disabled:opacity-50 dark:text-neutral-400"
      >
        {pending ? 'Unpairing…' : 'Unpair'}
      </button>
    </form>
  )
}
