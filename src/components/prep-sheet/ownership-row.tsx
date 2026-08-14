'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/primitives'
import type { OwnedProduct, OwnershipSummary } from '@/lib/prep-sheet/ownership'

/**
 * What the customer already owns.
 *
 * Sits above the factory warranty rings because it answers a different
 * question — "what did they buy from us" rather than "what came with the car"
 * — and because it is the fact most likely to change what the advisor says in
 * the first thirty seconds.
 *
 * Collapsed to one line per product. Tapping opens the detail an advisor needs
 * before promising anything: deductible, prior authorisation, tread minimum.
 */
export function OwnershipRow({
  summary,
  onAskCopilot,
}: {
  summary: OwnershipSummary
  onAskCopilot?: (product: OwnedProduct) => void
}) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  const open = summary.products.find((p) => p.key === openKey)

  if (summary.products.length === 0) {
    return (
      <Card className="px-4 py-3">
        <p className="text-xs font-bold uppercase tracking-[0.15em] text-neutral-500">
          What they own
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
          {summary.emptyNote}
        </p>
      </Card>
    )
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-2.5">
        <p className="text-xs font-bold uppercase tracking-[0.15em] text-neutral-500">
          What they own
        </p>
        <p className="text-[11px] font-semibold text-neutral-500">
          {summary.activeCount} active
          {summary.expiringCount > 0 && (
            <span className="ml-2 text-amber-700 dark:text-amber-400">
              {summary.expiringCount} expiring
            </span>
          )}
        </p>
      </div>

      <ul className="divide-y divide-[var(--border)]">
        {summary.products.map((product) => {
          const isOpen = product.key === openKey
          return (
            <li key={product.key}>
              <button
                type="button"
                onClick={() => setOpenKey(isOpen ? null : product.key)}
                aria-expanded={isOpen}
                className={`touch-target flex w-full items-center gap-3 px-4 py-3 text-left transition active:scale-[0.99] ${
                  isOpen ? 'bg-[var(--surface-muted)]' : 'hover:bg-[var(--surface-muted)]'
                }`}
              >
                <span
                  aria-hidden
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-base ${
                    product.active
                      ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
                      : 'bg-neutral-100 text-neutral-400 dark:bg-neutral-800'
                  }`}
                >
                  {product.glyph}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className={`font-bold ${product.active ? '' : 'text-neutral-500'}`}>
                      {product.label}
                    </span>
                    {product.tier && (
                      <span className="text-xs text-neutral-500">{product.tier}</span>
                    )}
                    {product.expiringSoon && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                        Expiring
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-neutral-500">
                    {product.adminCompany}
                    {product.facts.length > 0 && ` · ${product.facts.slice(0, 2).join(' · ')}`}
                  </span>
                </span>

                <span
                  className={`shrink-0 text-sm font-bold tabular-nums ${
                    product.active
                      ? product.expiringSoon
                        ? 'text-amber-700 dark:text-amber-400'
                        : 'text-emerald-700 dark:text-emerald-400'
                      : 'text-neutral-400'
                  }`}
                >
                  {product.headline}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      {open && (
        <div className="expand-in border-t border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3">
          <p className="text-sm leading-relaxed">{open.talkTrack}</p>

          {open.facts.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {open.facts.map((fact) => (
                <span
                  key={fact}
                  className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-semibold"
                >
                  {fact}
                </span>
              ))}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-3">
            {open.claimPhone && (
              <a
                href={`tel:${open.claimPhone}`}
                className="touch-target rounded-xl border border-[var(--border)] px-3.5 py-2 text-xs font-bold transition active:scale-[0.97] hover:border-neutral-900 dark:hover:border-neutral-300"
              >
                Claims {open.claimPhone}
              </a>
            )}
            {onAskCopilot && (
              <button
                type="button"
                onClick={() => onAskCopilot(open)}
                className="touch-target rounded-xl px-3 py-2 text-xs font-semibold text-neutral-500 transition active:scale-[0.97] hover:text-neutral-900 dark:hover:text-white"
              >
                ✦ Explain this to the customer
              </button>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}
