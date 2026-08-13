'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { logOutcome, snoozeTask, type Outcome, type OutcomeState } from '@/app/bdc/actions'
import {
  buildTextPrompt, canCall, canText, contactBlockedReason, overdueDays, triggerMeta,
  type FollowUpItem,
} from '@/lib/follow-up/view'

/**
 * One follow-up.
 *
 * Collapsed by default: name, why, value, and the three things a rep does most
 * — call, text, done. Everything else is one tap away. A worklist that makes
 * someone read a form before dialling is a worklist that stops getting worked.
 */

const OUTCOMES: { value: Outcome; label: string; tone: string }[] = [
  { value: 'APPOINTMENT_SET', label: 'Appointment set', tone: 'bg-emerald-600 hover:bg-emerald-700' },
  { value: 'CALLBACK_REQUESTED', label: 'Callback', tone: 'bg-sky-600 hover:bg-sky-700' },
  { value: 'LEFT_VOICEMAIL', label: 'Voicemail', tone: 'bg-neutral-600 hover:bg-neutral-700' },
  { value: 'NO_ANSWER', label: 'No answer', tone: 'bg-neutral-600 hover:bg-neutral-700' },
  { value: 'NOT_INTERESTED', label: 'Not interested', tone: 'bg-amber-600 hover:bg-amber-700' },
  { value: 'WRONG_NUMBER', label: 'Wrong number', tone: 'bg-amber-600 hover:bg-amber-700' },
  { value: 'DO_NOT_CONTACT', label: 'Do not contact', tone: 'bg-rose-700 hover:bg-rose-800' },
]

function money(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function formatPhone(raw: string | null): string {
  if (!raw) return 'No number'
  const digits = raw.replace(/\D/g, '')
  if (digits.length !== 10) return raw
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

const INITIAL: OutcomeState = {}

export function FollowUpCard({
  item,
  storeName,
  asOf,
}: {
  item: FollowUpItem
  storeName: string
  /** Passed in so the server and client agree on what "overdue" means. */
  asOf: string
}) {
  const [outcomeState, outcomeAction, outcomePending] = useActionState(logOutcome, INITIAL)
  const [, snoozeAction, snoozePending] = useActionState(snoozeTask, INITIAL)
  const [logging, setLogging] = useState(false)
  const [notes, setNotes] = useState('')
  const [copied, setCopied] = useState(false)

  const meta = triggerMeta(item.trigger)
  const overdue = overdueDays(item.dueAt, new Date(asOf))
  const blocked = contactBlockedReason(item)

  if (outcomeState.ok) {
    return (
      <li className="rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
        Logged for <strong>{item.customerName}</strong>. It drops off the list on refresh.
      </li>
    )
  }

  async function copyText() {
    await navigator.clipboard.writeText(buildTextPrompt(item, storeName))
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <li
      className={`overflow-hidden rounded-2xl border bg-[var(--surface)] ${
        overdue > 0 ? 'border-rose-300 dark:border-rose-900' : 'border-[var(--border)]'
      }`}
    >
      <div className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                  meta.highValue
                    ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                    : 'bg-[var(--surface-muted)] text-neutral-600 dark:text-neutral-400'
                }`}
              >
                <span aria-hidden>{meta.glyph}</span>
                {meta.label}
              </span>
              {overdue > 0 && (
                <span className="rounded-full bg-rose-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                  {overdue}d overdue
                </span>
              )}
              <span className="text-[11px] uppercase tracking-wide text-neutral-500">
                {item.owner === 'UNASSIGNED' ? 'Unassigned' : item.owner}
              </span>
            </div>

            <p className="mt-2 text-lg font-bold leading-tight">{item.customerName}</p>
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              {item.vehicleLabel ?? 'No vehicle on file'}
              {item.vehicleMileage ? ` · ${item.vehicleMileage.toLocaleString()} mi` : ''}
            </p>

            {/* Why this task exists, in one line. */}
            <p className="mt-2 text-sm leading-relaxed">{item.detail}</p>
            <p className="mt-0.5 text-xs text-neutral-500">{meta.why}</p>
          </div>

          <div className="shrink-0 text-right">
            {item.estimatedValue > 0 && (
              <p className="text-2xl font-bold tabular-nums">{money(item.estimatedValue)}</p>
            )}
            <p className="mt-0.5 text-xs text-neutral-500">
              {item.visitCount} visit{item.visitCount === 1 ? '' : 's'} ·{' '}
              {money(item.lifetimeSpend)}
            </p>
          </div>
        </div>

        {item.talkTrack && (
          <p className="mt-3 rounded-xl bg-[var(--surface-muted)] px-3 py-2.5 text-sm italic leading-relaxed">
            “{item.talkTrack}”
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {canCall(item) ? (
            <a
              href={`tel:${item.customerPhone}`}
              className="touch-target rounded-xl bg-neutral-900 px-4 py-2.5 text-sm font-bold text-white transition active:scale-[0.97] dark:bg-white dark:text-neutral-900"
            >
              Call {formatPhone(item.customerPhone)}
            </a>
          ) : (
            <span className="rounded-xl bg-[var(--surface-muted)] px-4 py-2.5 text-sm font-semibold text-neutral-500">
              {formatPhone(item.customerPhone)}
            </span>
          )}

          {/*
            Prompt only — we compose the message, the rep sends it from their
            own device. Sending on their behalf needs A2P 10DLC registration and
            per-customer consent, and TCPA runs $500–1,500 a message.
          */}
          {canText(item) && (
            <button
              type="button"
              onClick={copyText}
              className="touch-target rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-semibold transition active:scale-[0.97] hover:border-neutral-900 dark:hover:border-neutral-300"
            >
              {copied ? 'Text copied' : 'Copy text'}
            </button>
          )}

          <Link
            href={`/customers/${item.customerId}`}
            className="touch-target rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-semibold transition active:scale-[0.97] hover:border-neutral-900 dark:hover:border-neutral-300"
          >
            Customer
          </Link>

          <button
            type="button"
            onClick={() => setLogging((v) => !v)}
            className="touch-target rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-semibold transition active:scale-[0.97] hover:border-neutral-900 dark:hover:border-neutral-300"
          >
            {logging ? 'Cancel' : 'Log outcome'}
          </button>

          <form action={snoozeAction} className="ml-auto">
            <input type="hidden" name="taskId" value={item.id} />
            <input type="hidden" name="days" value="7" />
            <button
              type="submit"
              disabled={snoozePending}
              className="touch-target rounded-xl px-3 py-2.5 text-sm font-medium text-neutral-500 transition active:scale-[0.97] hover:text-neutral-900 disabled:opacity-50 dark:hover:text-white"
            >
              Snooze 7d
            </button>
          </form>
        </div>

        {blocked && <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{blocked}</p>}
      </div>

      {logging && (
        <div className="border-t border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What did they say? Saved to the customer record — your DMS notes stay yours."
            rows={2}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:focus:border-neutral-300"
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
                  className={`touch-target rounded-xl px-3.5 py-2 text-xs font-bold text-white transition active:scale-[0.97] disabled:opacity-50 ${o.tone}`}
                >
                  {o.label}
                </button>
              </form>
            ))}
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
