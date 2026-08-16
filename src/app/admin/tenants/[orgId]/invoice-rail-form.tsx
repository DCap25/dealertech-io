'use client'

import { useActionState, useState } from 'react'
import { setInvoiceRail, type TenantActionState } from '../actions'

const INITIAL: TenantActionState = {}

const field =
  'mt-1 w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-300'
const label = 'block text-xs font-semibold uppercase tracking-wide text-neutral-500'

/**
 * Moving a dealer group onto invoiced billing.
 *
 * The fields here are not administrative trivia — each one is a way an invoice
 * fails silently if it is wrong. The wrong email means it lands with the
 * person who signed rather than the department that pays. A missing PO number
 * means AP rejects it without telling anybody, and the account ages into
 * past-due for a reason nobody can see from our side.
 *
 * So each carries the consequence rather than just a name.
 */
export function InvoiceRailForm({
  organizationId,
  currentMode,
  defaultEmail,
  defaultRooftops,
}: {
  organizationId: string
  currentMode: string | null
  defaultEmail: string
  defaultRooftops: number
}) {
  const [state, formAction, pending] = useActionState(setInvoiceRail, INITIAL)
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="touch-target rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-semibold hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
      >
        {currentMode === 'INVOICE' ? 'Update invoicing terms' : 'Switch to invoiced billing'}
      </button>
    )
  }

  return (
    <form action={formAction} className="w-full rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <input type="hidden" name="organizationId" value={organizationId} />

      <p className="text-sm font-semibold">Invoiced billing</p>
      <p className="mt-0.5 text-xs text-neutral-500">
        Stripe emails an invoice with a due date instead of charging a card. The
        dealership pays it by ACH or card from the hosted page. Same subscription,
        same lifecycle — only the collection method changes.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={label} htmlFor="billingEmail">Accounts payable email</label>
          <input
            id="billingEmail" name="billingEmail" type="email" required
            defaultValue={defaultEmail} className={field}
          />
          <p className="mt-0.5 text-[11px] text-neutral-500">
            Where invoices go. Not the person who signed — a bill sitting in a service
            manager&rsquo;s inbox is a bill nobody pays.
          </p>
        </div>

        <div>
          <label className={label} htmlFor="billingName">Legal entity</label>
          <input id="billingName" name="billingName" className={field} placeholder="Optional" />
          <p className="mt-0.5 text-[11px] text-neutral-500">
            If it differs from the trading name.
          </p>
        </div>

        <div>
          <label className={label} htmlFor="poNumber">PO number</label>
          <input id="poNumber" name="poNumber" className={field} placeholder="Optional" />
          <p className="mt-0.5 text-[11px] text-neutral-500">
            AP rejects an invoice without the PO they raised, and the rejection arrives
            as silence.
          </p>
        </div>

        <div>
          <label className={label} htmlFor="netTermsDays">Terms</label>
          <select id="netTermsDays" name="netTermsDays" className={field} defaultValue="30">
            <option value="30">Net 30</option>
            <option value="45">Net 45</option>
            <option value="60">Net 60</option>
          </select>
        </div>

        <div>
          <label className={label} htmlFor="rooftops">Rooftops</label>
          <input
            id="rooftops" name="rooftops" type="number" min={1} max={500}
            defaultValue={defaultRooftops} className={field}
          />
        </div>
      </div>

      <label className={`${label} mt-3`} htmlFor="rail-reason">What was agreed, and with whom</label>
      <input id="rail-reason" name="reason" className={field} required />

      <div className="mt-3 flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="touch-target rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
        >
          {pending ? 'Setting up…' : 'Apply'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="touch-target rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-semibold hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          Cancel
        </button>
      </div>

      {state.error && (
        <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:bg-rose-950 dark:text-rose-200">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p className="mt-2 break-all rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          {state.ok}
        </p>
      )}
    </form>
  )
}
