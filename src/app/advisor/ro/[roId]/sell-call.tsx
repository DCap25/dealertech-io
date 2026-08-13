'use client'

import { useActionState, useState } from 'react'
import { addRecommendation, closeRepairOrder, recordLineDecision, type ActionState } from '../../actions'
import type { RepairOrderLine } from '@/lib/advisor/load'

const INITIAL: ActionState = {}

const DECLINE_REASONS = ['Not today', 'Cost', 'Doing it elsewhere', 'Will think about it', 'Selling the car']

function money(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

const PAYER_LABEL: Record<string, string> = {
  OEM_RECALL: 'Recall — OEM pays',
  PPM: 'Prepaid plan',
  TIRE_WHEEL: 'Tire & wheel',
  OEM_WARRANTY: 'Factory warranty',
  VSC: 'Service contract',
  GOODWILL: 'Goodwill',
  CUSTOMER_PAY: 'Customer pay',
}

/** Coverage decides the pay type. Mapping it here keeps the RO honest. */
function payTypeFor(payer: string | undefined): 'CUSTOMER_PAY' | 'WARRANTY' | 'INTERNAL' {
  if (payer === 'OEM_WARRANTY' || payer === 'OEM_RECALL') return 'WARRANTY'
  if (payer === 'PPM' || payer === 'GOODWILL') return 'INTERNAL'
  return 'CUSTOMER_PAY'
}

export function PendingLine({ line }: { line: RepairOrderLine }) {
  const [state, action, pending] = useActionState(recordLineDecision, INITIAL)
  const [reason, setReason] = useState(DECLINE_REASONS[0]!)

  const coverage = line.coverage
  const covered = coverage && coverage.payer !== 'CUSTOMER_PAY'
  const owed = coverage?.customerOutOfPocket ?? line.total

  if (state.ok) {
    return (
      <li className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
        Recorded. Refresh to see it move.
      </li>
    )
  }

  return (
    <li className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">{line.description}</p>
          {coverage && (
            <p className="mt-0.5 text-sm">
              <span
                className={
                  covered
                    ? 'font-medium text-emerald-700 dark:text-emerald-400'
                    : 'text-neutral-600 dark:text-neutral-400'
                }
              >
                {PAYER_LABEL[coverage.payer] ?? coverage.payer}
              </span>
              {covered && (
                <span className="ml-1 text-neutral-600 dark:text-neutral-400">
                  — customer pays {money(owed)} of {money(line.total)}
                </span>
              )}
            </p>
          )}
          {coverage?.requiredActions.slice(0, 1).map((a, i) => (
            <p
              key={i}
              className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200"
            >
              {a}
            </p>
          ))}
        </div>
        <p className="shrink-0 text-lg font-bold tabular-nums">{money(line.total)}</p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <form action={action}>
          <input type="hidden" name="lineId" value={line.id} />
          <input type="hidden" name="decision" value="APPROVE" />
          <input type="hidden" name="customerAmount" value={owed} />
          <input type="hidden" name="payType" value={payTypeFor(coverage?.payer)} />
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            Approved
          </button>
        </form>

        <form action={action} className="flex items-center gap-2">
          <input type="hidden" name="lineId" value={line.id} />
          <input type="hidden" name="decision" value="DECLINE" />
          <input type="hidden" name="reason" value={reason} />
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-xs outline-none dark:border-neutral-700 dark:bg-neutral-950"
          >
            {DECLINE_REASONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold transition hover:border-rose-500 hover:text-rose-600 disabled:opacity-50 dark:border-neutral-700"
          >
            Declined
          </button>
        </form>
      </div>

      {state.error && <p className="mt-2 text-sm text-rose-600">{state.error}</p>}
    </li>
  )
}

export function AddRecommendation({
  repairOrderId,
  opCodes,
}: {
  repairOrderId: string
  opCodes: { id: string; code: string; description: string; laborAmount: number; partsAmount: number }[]
}) {
  const [state, action, pending] = useActionState(addRecommendation, INITIAL)
  const [opCodeId, setOpCodeId] = useState(opCodes[0]?.id ?? '')

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="repairOrderId" value={repairOrderId} />
      <select
        name="opCodeId"
        value={opCodeId}
        onChange={(e) => setOpCodeId(e.target.value)}
        className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950"
      >
        {opCodes.map((o) => (
          <option key={o.id} value={o.id}>
            {o.description} — {money(o.laborAmount + o.partsAmount)}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium transition hover:border-neutral-900 disabled:opacity-50 dark:border-neutral-700 dark:hover:border-neutral-300"
      >
        {pending ? 'Adding…' : 'Add tech recommendation'}
      </button>
      {state.error && <p className="w-full text-sm text-rose-600">{state.error}</p>}
    </form>
  )
}

export function CloseRoButton({ repairOrderId }: { repairOrderId: string }) {
  const [state, action, pending] = useActionState(closeRepairOrder, INITIAL)

  if (state.ok) {
    return <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Closed.</p>
  }

  return (
    <form action={action}>
      <input type="hidden" name="repairOrderId" value={repairOrderId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
      >
        {pending ? 'Closing…' : 'Close & deliver'}
      </button>
      {state.error && <p className="mt-1 text-sm text-rose-600">{state.error}</p>}
    </form>
  )
}
