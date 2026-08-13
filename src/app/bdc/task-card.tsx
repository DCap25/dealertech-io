'use client'

import { useActionState, useState } from 'react'
import { logOutcome, snoozeTask, type Outcome, type OutcomeState } from './actions'
import type { WorklistItem } from '@/lib/cadence/worklist'

const OUTCOMES: { value: Outcome; label: string; tone: string }[] = [
  { value: 'APPOINTMENT_SET', label: 'Appointment set', tone: 'bg-emerald-600 hover:bg-emerald-700' },
  { value: 'CALLBACK_REQUESTED', label: 'Callback requested', tone: 'bg-sky-600 hover:bg-sky-700' },
  { value: 'LEFT_VOICEMAIL', label: 'Left voicemail', tone: 'bg-neutral-600 hover:bg-neutral-700' },
  { value: 'NO_ANSWER', label: 'No answer', tone: 'bg-neutral-600 hover:bg-neutral-700' },
  { value: 'NOT_INTERESTED', label: 'Not interested', tone: 'bg-amber-600 hover:bg-amber-700' },
  { value: 'WRONG_NUMBER', label: 'Wrong number', tone: 'bg-amber-600 hover:bg-amber-700' },
  { value: 'DO_NOT_CONTACT', label: 'Do not contact', tone: 'bg-rose-700 hover:bg-rose-800' },
]

const TRIGGER_LABEL: Record<string, string> = {
  DECLINED_SERVICE_FOLLOW_UP: 'Declined work',
  MAINTENANCE_DUE_MILEAGE: 'Maintenance due',
  PPM_EXPIRING: 'Prepaid expiring',
  WARRANTY_EXPIRING: 'Warranty ending',
  POST_VISIT_THANK_YOU: 'Post-visit',
  CSI_PRE_EMPTION: 'CSI check',
  DORMANT_CUSTOMER: 'Win-back',
  OPEN_RECALL: 'Open recall',
}

function money(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function formatPhone(raw: string | null): string {
  if (!raw) return '—'
  const digits = raw.replace(/\D/g, '')
  if (digits.length !== 10) return raw
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

const INITIAL: OutcomeState = {}

export function TaskCard({ item }: { item: WorklistItem }) {
  const [outcomeState, outcomeAction, outcomePending] = useActionState(logOutcome, INITIAL)
  const [, snoozeAction, snoozePending] = useActionState(snoozeTask, INITIAL)
  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState('')

  const overdueDays = Math.floor((Date.now() - item.dueAt.getTime()) / 86_400_000)

  if (outcomeState.ok) {
    return (
      <li className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
        Logged for <strong>{item.customerName}</strong>. It will drop off the list on refresh.
      </li>
    )
  }

  return (
    <li className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-neutral-900 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white dark:bg-white dark:text-neutral-900">
              {TRIGGER_LABEL[item.trigger] ?? item.trigger.replace(/_/g, ' ').toLowerCase()}
            </span>
            <span className="font-semibold">{item.title}</span>
            {overdueDays > 0 && (
              <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                {overdueDays}d overdue
              </span>
            )}
          </div>

          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{item.detail}</p>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <a href={`/customers/${item.customerId}`} className="font-medium hover:underline">
              {item.customerName}
            </a>
            <a href={`tel:${item.customerPhone ?? ''}`} className="font-mono text-sm hover:underline">
              {formatPhone(item.customerPhone)}
            </a>
            {item.vehicleLabel && item.vehicleId && (
              <a href={`/vehicles/${item.vehicleId}`} className="text-neutral-500 hover:underline">
                {item.vehicleLabel}
              </a>
            )}
            <span className="text-xs text-neutral-500">
              {item.visitCount} visit{item.visitCount === 1 ? '' : 's'} · {money(item.lifetimeSpend)} lifetime
            </span>
            <span className="text-xs text-neutral-500">prefers {item.preferredChannel}</span>
          </div>

          {item.talkTrack && (
            <p className="mt-2 rounded bg-neutral-50 px-2 py-1.5 text-sm italic text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
              {item.talkTrack}
            </p>
          )}
        </div>

        <div className="shrink-0 text-right">
          {item.estimatedValue > 0 && (
            <p className="text-xl font-bold tabular-nums">{money(item.estimatedValue)}</p>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-2 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium transition hover:border-neutral-900 dark:border-neutral-700 dark:hover:border-neutral-300"
          >
            {open ? 'Cancel' : 'Log call'}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-4 border-t border-neutral-100 pt-3 dark:border-neutral-800">
          <textarea
            name="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What did they say? Notes are saved to the customer record."
            rows={2}
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-300"
          />

          <div className="mt-2 flex flex-wrap gap-2">
            {OUTCOMES.map((o) => (
              <form key={o.value} action={outcomeAction}>
                <input type="hidden" name="taskId" value={item.id} />
                <input type="hidden" name="outcome" value={o.value} />
                <input type="hidden" name="notes" value={notes} />
                <button
                  type="submit"
                  disabled={outcomePending}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition disabled:opacity-50 ${o.tone}`}
                >
                  {o.label}
                </button>
              </form>
            ))}

            <form action={snoozeAction}>
              <input type="hidden" name="taskId" value={item.id} />
              <input type="hidden" name="days" value="7" />
              <button
                type="submit"
                disabled={snoozePending}
                className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium transition hover:border-neutral-900 disabled:opacity-50 dark:border-neutral-700 dark:hover:border-neutral-300"
              >
                Snooze 7d
              </button>
            </form>
          </div>

          <p className="mt-2 text-xs text-neutral-500">
            No answer and voicemail keep the task open and retry in two days. Do not contact
            suppresses this customer everywhere, permanently.
          </p>

          {outcomeState.error && (
            <p className="mt-2 text-sm text-rose-600">{outcomeState.error}</p>
          )}
        </div>
      )}
    </li>
  )
}
