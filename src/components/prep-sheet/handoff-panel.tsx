'use client'

import { useState, useTransition } from 'react'
import { Card, money } from '@/components/ui/primitives'
import { buildHandoffLine, buildHandoffNote } from '@/lib/prep-sheet/command-center'
import { pushHandOffForVisit, type HandOffPushState } from '@/app/drive/handoff-actions'
import type { OpportunityDecision } from '@/lib/prep-sheet/presentation'
import type { PrepSheet } from '@/lib/prep-sheet'

/**
 * DMS hand-off.
 *
 * We do not write to the DMS — the advisor is already logged into it, and
 * pretending to own RO writing is how an intelligence layer turns into a
 * migration project. What we can do is make the twenty seconds of keying that
 * follows a "yes" fast and correct: one tap, a clean block, paste.
 */
export function HandoffPanel({
  sheet,
  decisions,
  onClose,
}: {
  sheet: PrepSheet
  decisions: Record<string, OpportunityDecision>
  onClose: () => void
}) {
  const [copied, setCopied] = useState<string | null>(null)
  const [push, setPush] = useState<HandOffPushState | null>(null)
  const [sending, startSending] = useTransition()

  const accepted = sheet.opportunities.filter((o) => decisions[o.id] === 'ACCEPTED')
  const note = buildHandoffNote(sheet, decisions)

  async function copy(text: string, key: string) {
    await navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 1800)
  }

  const customerTotal = accepted.reduce((s, o) => s + o.customerOutOfPocket, 0)
  const coveredTotal = accepted.reduce(
    (s, o) => s + Math.max(0, o.estimatedAmount - o.customerOutOfPocket),
    0,
  )

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[var(--background)]">
      <div className="mx-auto max-w-3xl px-4 py-5 pb-24 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Hand-off to the DMS</h1>
            <p className="mt-1 text-sm text-neutral-500">
              {accepted.length} approved item{accepted.length === 1 ? '' : 's'} ·{' '}
              {money(customerTotal)} customer
              {coveredTotal > 0 && ` · ${money(coveredTotal)} covered`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="touch-target rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-semibold transition active:scale-[0.98] hover:border-neutral-900 dark:hover:border-neutral-300"
          >
            Back
          </button>
        </div>

        {/*
          Send first, copy second — but copy is never hidden or disabled. The
          paste path is the floor that works in every store; pushing is the
          bonus that works where the integration allows it.
        */}
        <div className="mt-4 flex flex-wrap gap-2">
          {sheet.appointment && (
            <button
              type="button"
              disabled={sending}
              onClick={() =>
                startSending(async () => {
                  setPush(await pushHandOffForVisit(sheet.appointment!.id, decisions))
                })
              }
              className="touch-target flex-1 rounded-xl bg-neutral-900 px-4 py-3.5 text-sm font-bold text-white transition active:scale-[0.98] disabled:opacity-60 dark:bg-white dark:text-neutral-900"
            >
              {sending ? 'Sending…' : push?.status === 'SENT' ? 'Send again' : 'Send to DMS'}
            </button>
          )}
          <button
            type="button"
            onClick={() => copy(note, 'all')}
            className="touch-target flex-1 rounded-xl border-2 border-neutral-900 px-4 py-3.5 text-sm font-bold transition active:scale-[0.98] dark:border-neutral-100"
          >
            {copied === 'all' ? 'Copied — paste into the RO' : 'Copy the whole hand-off'}
          </button>
        </div>

        {push && <PushResult result={push} />}

        {accepted.length > 0 && (
          <>
            <p className="mt-6 text-xs font-bold uppercase tracking-[0.15em] text-neutral-500">
              Or copy one line at a time
            </p>
            <ul className="mt-2 space-y-2">
              {accepted.map((o) => (
                <li key={o.id}>
                  <Card className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{o.title}</p>
                      <p className="text-xs text-neutral-500">
                        {money(o.customerOutOfPocket)} to the customer
                        {o.likelyPayer !== 'CUSTOMER_PAY' && ` · ${o.likelyPayer.replace(/_/g, ' ').toLowerCase()}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => copy(buildHandoffLine(o), o.id)}
                      className="touch-target shrink-0 rounded-xl border border-[var(--border)] px-3.5 py-2 text-xs font-bold transition active:scale-[0.97] hover:border-neutral-900 dark:hover:border-neutral-300"
                    >
                      {copied === o.id ? 'Copied' : 'Copy line'}
                    </button>
                  </Card>
                </li>
              ))}
            </ul>
          </>
        )}

        <p className="mt-6 text-xs font-bold uppercase tracking-[0.15em] text-neutral-500">
          Preview
        </p>
        {/* Shown verbatim, so an advisor can see exactly what lands in the DMS
            before they paste it into a customer's permanent record. */}
        <pre className="mt-2 whitespace-pre-wrap break-words rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4 text-xs leading-relaxed">
          {note}
        </pre>
      </div>
    </div>
  )
}

/**
 * What actually happened.
 *
 * Three states, said plainly. The middle one — sent, but to an adapter that
 * does not persist — is the one worth getting right: a demo that claims work
 * reached a DMS becomes a false promise the first time someone checks.
 */
function PushResult({ result }: { result: HandOffPushState }) {
  const tone =
    result.status === 'FAILED'
      ? 'border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/60'
      : result.persisted
        ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/60'
        : 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/60'

  const headline =
    result.status === 'FAILED'
      ? `Not sent to ${result.vendor}`
      : result.persisted
        ? `Sent to ${result.vendor}`
        : `Sent to the ${result.vendor} adapter — not a real DMS`

  return (
    <div className={`expand-in mt-3 rounded-2xl border p-4 ${tone}`}>
      <p className="font-bold">{headline}</p>
      <p className="mt-1 text-sm leading-relaxed">{result.message}</p>

      {result.status === 'SENT' && !result.persisted && (
        <p className="mt-2 text-sm leading-relaxed">
          Nothing was written to your dealer management system. Use{' '}
          <strong>Copy the whole hand-off</strong> and paste it into the RO as normal.
        </p>
      )}

      {result.externalRef && (
        <p className="mt-2 font-mono text-xs opacity-70">Reference {result.externalRef}</p>
      )}
    </div>
  )
}
