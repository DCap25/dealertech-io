'use client'

import { useActionState } from 'react'
import { createDealership, type SignUpState } from './actions'

const INITIAL: SignUpState = {}

const field =
  'mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-300'
const label = 'block text-xs font-semibold uppercase tracking-wide text-neutral-500'

export function SignUpForm({ makes }: { makes: string[] }) {
  const [state, formAction, pending] = useActionState(createDealership, INITIAL)

  return (
    <form action={formAction} className="mt-6 space-y-4">
      <div>
        <label htmlFor="dealershipName" className={label}>Dealership</label>
        <input id="dealershipName" name="dealershipName" required placeholder="Hill Country BMW" className={field} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label htmlFor="franchiseMake" className={label}>Franchise brand</label>
          <select id="franchiseMake" name="franchiseMake" defaultValue="" className={field}>
            <option value="">Independent / multi-brand</option>
            {makes.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <p className="mt-1 text-xs text-neutral-500">
            Sets your default schedule. You still service everything that drives in.
          </p>
        </div>
        <div>
          <label htmlFor="state" className={label}>State</label>
          <input id="state" name="state" maxLength={2} placeholder="TX" className={`${field} uppercase`} />
        </div>
      </div>

      <div>
        <label htmlFor="laborRate" className={label}>Door rate</label>
        <input
          id="laborRate" name="laborRate" type="number" min="1" step="1"
          required placeholder="185" className={field}
        />
        <p className="mt-1 text-xs text-neutral-500">
          Customer-pay labour, per hour. Every estimate is priced from this.
        </p>
      </div>

      <div className="border-t border-neutral-200 pt-4 dark:border-neutral-800">
        <div>
          <label htmlFor="adminName" className={label}>Your name</label>
          <input id="adminName" name="adminName" required autoComplete="name" className={field} />
        </div>
        <div className="mt-4">
          <label htmlFor="adminEmail" className={label}>Work email</label>
          <input id="adminEmail" name="adminEmail" type="email" required autoComplete="email" className={field} />
        </div>
        <div className="mt-4">
          <label htmlFor="password" className={label}>Choose a password</label>
          <input
            id="password" name="password" type="password" required minLength={10}
            autoComplete="new-password" className={field}
          />
          <p className="mt-1 text-xs text-neutral-500">
            At least 10 characters. Length matters more than symbols.
          </p>
        </div>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
      >
        {pending ? 'Setting up…' : 'Create the dealership'}
      </button>

      {state.error && (
        <p className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-100">
          {state.error}
        </p>
      )}
    </form>
  )
}
