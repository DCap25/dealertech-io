'use client'

import { useState } from 'react'
import { Card, money } from '@/components/ui/primitives'
import { buildHandoffLine, buildHandoffNote } from '@/lib/prep-sheet/command-center'
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

        <button
          type="button"
          onClick={() => copy(note, 'all')}
          className="touch-target mt-4 w-full rounded-xl bg-neutral-900 px-4 py-3.5 text-sm font-bold text-white transition active:scale-[0.98] dark:bg-white dark:text-neutral-900"
        >
          {copied === 'all' ? 'Copied — paste into the RO' : 'Copy the whole hand-off'}
        </button>

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
