'use client'

import { useState } from 'react'
import { ExplainerPlayer } from '@/components/explainer/explainer-player'
import { explainerFor } from '@/lib/explainer'
import type { DeviceItem, DeviceSnapshot } from '@/lib/pairing/snapshot'
import type { Decision } from '@/lib/presentation/decisions'

/**
 * The menu a customer actually reads.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS SHARED RATHER THAN COPIED
 * ---------------------------------------------------------------------------
 * The same conversation reaches a customer two ways — a tablet at the podium
 * at write-up, and a link on their phone after the technician has been under
 * the car. Those are different shells: one polls for a menu being pushed to it,
 * the other is handed its menu at page load.
 *
 * The menu itself must be the same to the pixel. This is the screen the whole
 * product is judged on, and a second copy would drift on exactly the details
 * that matter — whether "not today" is as tappable as "yes", whether the price
 * shown is the covered one. Drift there is not a styling bug, it is the
 * product quietly becoming the thing it exists to replace.
 */

const TIER_ACCENT: Record<string, string> = {
  NOW: 'border-l-rose-500',
  SOON: 'border-l-amber-500',
  PLANNED: 'border-l-neutral-300 dark:border-l-neutral-600',
}

export function money(n: number): string {
  return `$${Math.round(n).toLocaleString()}`
}

export function ServiceMenu({
  snapshot,
  decisions,
  onDecide,
  readOnly = false,
}: {
  snapshot: DeviceSnapshot
  decisions: Record<string, string>
  onDecide: (id: string, decision: Decision) => void
  /** After authorising, the answers are a record rather than a control. */
  readOnly?: boolean
}) {
  const [explaining, setExplaining] = useState<DeviceItem | null>(null)

  const toggle = (id: string, current: string | undefined, next: Decision) => {
    if (readOnly) return
    onDecide(id, current === next ? 'PENDING' : next)
  }

  return (
    <>
      <header className="border-b border-[var(--border)] pb-5">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-neutral-500">
          Recommended service
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">{snapshot.vehicleLabel}</h1>
        <p className="mt-1 text-neutral-600 dark:text-neutral-400">
          {snapshot.customerName} · {snapshot.mileage.toLocaleString()} miles
        </p>
      </header>

      {snapshot.coveredTotal > 0 && (
        /*
          Led with, before a single price.

          Most people arrive at a dealership assuming they are about to be sold
          something. The first number they see being what they already own —
          and do not have to pay for — is the fastest honest way to change that
          assumption.
        */
        <div className="mt-5 rounded-2xl border border-emerald-300 bg-emerald-50 p-5 dark:border-emerald-800 dark:bg-emerald-950">
          <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
            Coverage you already own pays for
          </p>
          <p className="mt-1 text-4xl font-bold tabular-nums text-emerald-900 dark:text-emerald-100">
            {money(snapshot.coveredTotal)}
          </p>
        </div>
      )}

      {snapshot.tiers.map((group) => (
        <section key={group.tier} className="mt-8">
          <h2 className="text-xl font-bold tracking-tight">{group.title}</h2>
          <p className="mt-0.5 text-sm text-neutral-500">{group.blurb}</p>

          <ul className="mt-3 space-y-3">
            {group.items.map((item) => {
              const decision = decisions[item.id]
              const savings = Math.max(0, item.fullAmount - item.customerOutOfPocket)
              return (
                <li
                  key={item.id}
                  className={`rounded-2xl border border-l-4 p-5 ${TIER_ACCENT[group.tier]} ${
                    decision === 'ACCEPTED'
                      ? 'border-emerald-400 bg-emerald-50/60 dark:border-emerald-700 dark:bg-emerald-950/40'
                      : decision === 'CALL_ME'
                        ? 'border-sky-400 bg-sky-50/60 dark:border-sky-700 dark:bg-sky-950/40'
                        : decision === 'DECLINED'
                          ? 'border-[var(--border)] bg-[var(--surface-muted)] opacity-70'
                          : 'border-[var(--border)] bg-[var(--surface)]'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-lg font-bold">{item.title}</h3>
                      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                        {item.detail}
                      </p>
                      {item.badges.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {item.badges.map((b) => (
                            <span
                              key={b.label}
                              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                                b.tone === 'SAFETY'
                                  ? 'bg-rose-600 text-white'
                                  : 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
                              }`}
                            >
                              {b.label}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      {/*
                        No number when the dealership has no price on file.

                        The price book is pulled every morning so that what a
                        customer is quoted is what the invoice will say. Where
                        we do not have that, saying so is the only honest
                        option — showing our estimate and billing something
                        else is precisely the experience this product exists to
                        replace.
                      */}
                      {item.priceConfirmed === false ? (
                        <>
                          <p className="text-lg font-bold">Price to be confirmed</p>
                          <p className="text-sm text-neutral-500">
                            Your advisor will tell you before any work starts
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="text-2xl font-bold tabular-nums">
                            {item.customerOutOfPocket === 0 ? 'No charge' : money(item.customerOutOfPocket)}
                          </p>
                          {savings > 0 && (
                            <p className="text-sm text-neutral-500 line-through tabular-nums">
                              {money(item.fullAmount)}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {item.explainerKey && explainerFor(item.explainerKey) && (
                      <button
                        type="button"
                        onClick={() => setExplaining(item)}
                        className="touch-target inline-flex items-center gap-2 rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-semibold"
                      >
                        <span aria-hidden>▶</span> Show me why
                      </button>
                    )}

                    {/*
                      Three answers, equal weight, "not today" first.

                      A customer who arrives expecting to be talked into
                      something reads a buried decline instantly — and once
                      they have, they discount the brake warning too, which is
                      the one that mattered. The middle option is the one they
                      want most often and no menu ever offers.
                    */}
                    <div className="ml-auto flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={readOnly}
                        onClick={() => toggle(item.id, decision, 'DECLINED')}
                        aria-pressed={decision === 'DECLINED'}
                        className={`touch-target rounded-xl border px-4 py-2.5 text-sm font-semibold disabled:opacity-60 ${
                          decision === 'DECLINED'
                            ? 'border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900'
                            : 'border-[var(--border)]'
                        }`}
                      >
                        Not today
                      </button>
                      <button
                        type="button"
                        disabled={readOnly}
                        onClick={() => toggle(item.id, decision, 'CALL_ME')}
                        aria-pressed={decision === 'CALL_ME'}
                        className={`touch-target rounded-xl border px-4 py-2.5 text-sm font-semibold disabled:opacity-60 ${
                          decision === 'CALL_ME'
                            ? 'border-sky-600 bg-sky-600 text-white'
                            : 'border-[var(--border)]'
                        }`}
                      >
                        Call me about this
                      </button>
                      <button
                        type="button"
                        disabled={readOnly}
                        onClick={() => toggle(item.id, decision, 'ACCEPTED')}
                        aria-pressed={decision === 'ACCEPTED'}
                        className={`touch-target rounded-xl border px-5 py-2.5 text-sm font-bold disabled:opacity-60 ${
                          decision === 'ACCEPTED'
                            ? 'border-emerald-600 bg-emerald-600 text-white'
                            : 'border-[var(--border)]'
                        }`}
                      >
                        Yes
                      </button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      {explaining?.explainerKey && explainerFor(explaining.explainerKey) && (
        <ExplainerPlayer
          explainer={explainerFor(explaining.explainerKey)!}
          reading={explaining.reading}
          onClose={() => setExplaining(null)}
        />
      )}
    </>
  )
}
