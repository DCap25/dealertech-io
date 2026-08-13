'use client'

import { useActionState } from 'react'
import { submitDemoRequest, type DemoRequestState } from './actions'

const INITIAL: DemoRequestState = {}

const field =
  'w-full rounded-lg border border-neutral-300 bg-white px-3.5 py-2.5 text-sm text-neutral-900 outline-none transition focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white dark:focus:border-neutral-400'
const label = 'block text-xs font-semibold uppercase tracking-wide text-neutral-500'

const DMS_OPTIONS = ['CDK Global', 'Reynolds & Reynolds', 'Tekion', 'Dealertrack', 'PBS', 'Auto/Mate', 'DealerBuilt', 'Other', 'Not sure']

export function DemoRequestForm({ source = 'homepage' }: { source?: string }) {
  const [state, action, pending] = useActionState(submitDemoRequest, INITIAL)

  if (state.ok) {
    return (
      <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-8 text-center dark:border-emerald-800 dark:bg-emerald-950">
        <p className="text-lg font-bold text-emerald-900 dark:text-emerald-100">
          Got it. We&rsquo;ll be in touch within one business day.
        </p>
        <p className="mt-2 text-sm text-emerald-800 dark:text-emerald-300">
          In the meantime, the coverage engine is live and open — paste any VIN into the{' '}
          <a href="/demo" className="underline">demo</a> and see what it says.
        </p>
      </div>
    )
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="source" value={source} />

      {/* Honeypot — hidden from people, irresistible to bots. */}
      <div aria-hidden className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="company_website">Company website</label>
        <input id="company_website" name="company_website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="name">Your name</label>
          <input id="name" name="name" required className={`mt-1 ${field}`} autoComplete="name" />
          {state.fieldErrors?.name && (
            <p className="mt-1 text-xs text-rose-600">{state.fieldErrors.name}</p>
          )}
        </div>
        <div>
          <label className={label} htmlFor="role">Your role</label>
          <input id="role" name="role" placeholder="Fixed ops director, dealer principal…" className={`mt-1 ${field}`} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required className={`mt-1 ${field}`} autoComplete="email" />
          {state.fieldErrors?.email && (
            <p className="mt-1 text-xs text-rose-600">{state.fieldErrors.email}</p>
          )}
        </div>
        <div>
          <label className={label} htmlFor="phone">Phone</label>
          <input id="phone" name="phone" type="tel" className={`mt-1 ${field}`} autoComplete="tel" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
        <div>
          <label className={label} htmlFor="dealershipName">Dealership or group</label>
          <input id="dealershipName" name="dealershipName" required className={`mt-1 ${field}`} />
          {state.fieldErrors?.dealershipName && (
            <p className="mt-1 text-xs text-rose-600">{state.fieldErrors.dealershipName}</p>
          )}
        </div>
        <div>
          <label className={label} htmlFor="rooftops">Rooftops</label>
          <input id="rooftops" name="rooftops" type="number" min="1" defaultValue="1" className={`mt-1 ${field}`} />
        </div>
      </div>

      <div>
        <label className={label} htmlFor="dms">What DMS do you run?</label>
        <select id="dms" name="dms" defaultValue="" className={`mt-1 ${field}`}>
          <option value="">Select…</option>
          {DMS_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      <div>
        <label className={label} htmlFor="message">
          What&rsquo;s costing you the most right now?
        </label>
        <textarea id="message" name="message" rows={3} className={`mt-1 ${field}`} />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-neutral-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
      >
        {pending ? 'Sending…' : 'Request a walkthrough'}
      </button>

      {state.error && (
        <p className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200">
          {state.error}
        </p>
      )}

      <p className="text-center text-xs text-neutral-500">
        No sales sequence, no drip campaign. One person replies.
      </p>
    </form>
  )
}
