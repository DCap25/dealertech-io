'use client'

import { useActionState, useState } from 'react'
import { provisionFromLead, type ProvisionState } from './actions'

const INITIAL: ProvisionState = {}

const field =
  'mt-1 w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-300'
const label = 'block text-xs font-semibold uppercase tracking-wide text-neutral-500'

/**
 * Stand up a dealership from a lead.
 *
 * Collapsed until asked for. This sits under every lead in the list, and a
 * dozen open forms would turn a list you scan into a wall you scroll past.
 */
export function ProvisionForm({
  leadId,
  dealershipName,
  email,
  makes,
  origin,
}: {
  leadId: string
  dealershipName: string
  email: string
  makes: string[]
  origin: string
}) {
  const [state, formAction, pending] = useActionState(provisionFromLead, INITIAL)
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const fullLink = state.link ? `${origin}${state.link}` : null

  if (fullLink) {
    return (
      <div className="mt-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950">
        <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
          {state.dealershipName} is set up — invite {state.invitedEmail}
        </p>
        <p className="mt-1 text-xs text-emerald-900/80 dark:text-emerald-200/80">
          Send them this yourself; we do not email invitations yet. It is shown once, expires in
          seven days, and lets them choose their own password.
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
            onClick={() => { void navigator.clipboard.writeText(fullLink).then(() => setCopied(true)) }}
            // Primary-button treatment rather than a deep tint of the panel
            // colour, which has twice rendered as invisible white-on-pale.
            className="shrink-0 rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white dark:bg-white dark:text-neutral-900"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium transition hover:border-neutral-900 dark:border-neutral-700 dark:hover:border-neutral-300"
      >
        Set up their dealership
      </button>
    )
  }

  return (
    <form action={formAction} className="mt-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <input type="hidden" name="leadId" value={leadId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor={`name-${leadId}`}>Dealership</label>
          <input id={`name-${leadId}`} name="dealershipName" required defaultValue={dealershipName} className={field} />
        </div>
        <div>
          <label className={label} htmlFor={`email-${leadId}`}>Invite as administrator</label>
          <input id={`email-${leadId}`} name="adminEmail" type="email" required defaultValue={email} className={field} />
        </div>
        <div>
          <label className={label} htmlFor={`make-${leadId}`}>Franchise brand</label>
          <select id={`make-${leadId}`} name="franchiseMake" defaultValue="" className={field}>
            <option value="">Independent / multi-brand</option>
            {makes.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label} htmlFor={`state-${leadId}`}>State</label>
            <input id={`state-${leadId}`} name="state" maxLength={2} placeholder="TX" className={`${field} uppercase`} />
          </div>
          <div>
            <label className={label} htmlFor={`rate-${leadId}`}>Door rate</label>
            <input id={`rate-${leadId}`} name="laborRate" type="number" min="1" step="1" required placeholder="185" className={field} />
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
        >
          {pending ? 'Creating…' : 'Create and invite'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700"
        >
          Cancel
        </button>
      </div>

      {state.error && (
        <p className="mt-2 rounded-lg border border-rose-300 bg-rose-50 p-2 text-xs text-rose-900 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-100">
          {state.error}
        </p>
      )}
    </form>
  )
}
