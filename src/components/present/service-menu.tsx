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

      {/*
        Nothing to show.

        Reachable in practice: an advisor can clear the menu in the builder and
        still hand the tablet over, and a link sent for one visit can outlive
        the work it was about. Without this the customer got a vehicle name, a
        blank space and a "0 of 0 answered" footer, which reads like the page
        failed to load — and a customer who thinks the software is broken is
        not in a frame of mind to trust the next number it shows them.

        It says the true thing, which is also the reassuring one.
      */}
      {snapshot.itemCount === 0 && (
        <div className="mt-8 rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-8 text-center">
          <p className="text-lg font-bold">Nothing needs doing today</p>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
            Your advisor has not put anything on this list. If you were expecting to see
            something, they are the best person to ask.
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

                  {item.explainerKey && explainerFor(item.explainerKey) && (
                    /*
                      On its own line, above the answers and never beside them.

                      Sharing a row meant that on a phone the four buttons
                      wrapped into whatever order fitted, so the thing that
                      explains the item could land between two of the answers.
                      It is also not an answer, and should not sit in a line
                      that looks like a choice.
                    */
                    <button
                      type="button"
                      onClick={() => setExplaining(item)}
                      className="touch-target mt-4 inline-flex items-center gap-2 rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-semibold"
                    >
                      <span aria-hidden>▶</span> Show me why
                    </button>
                  )}

                  {/*
                    Three answers, and this time actually equal.

                    They were laid out with intrinsic widths, so "Call me about
                    this" came out two and a half times the width of "Yes"
                    while a comment above them claimed they carried equal
                    weight. A customer reads that difference before they read
                    the words: the big one is the one the shop wants. A three-
                    column grid makes them the same size, which is the only way
                    the claim is true.

                    Wider gap and taller targets because of where this happens.
                    A tablet is handed across a counter and answered standing
                    up, often by somebody holding keys and a phone; 8px between
                    a decline and an acceptance is close enough to mis-tap, and
                    a mis-tapped "Yes" is a customer authorising work they did
                    not want.

                    The selection is marked as well as coloured. Shop lighting
                    is poor, screens get glare, and roughly one man in twelve
                    cannot rely on the red/green distinction at all.
                  */}
                  <div className="mt-3 grid grid-cols-3 gap-3">
                    {([
                      ['DECLINED', 'Not today',
                        'border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900'],
                      ['CALL_ME', 'Call me about this', 'border-sky-600 bg-sky-600 text-white'],
                      ['ACCEPTED', 'Yes', 'border-emerald-600 bg-emerald-600 text-white'],
                    ] as const).map(([value, label, selectedClasses]) => {
                      const selected = decision === value
                      return (
                        <button
                          key={value}
                          type="button"
                          disabled={readOnly}
                          onClick={() => toggle(item.id, decision, value)}
                          aria-pressed={selected}
                          className={`flex min-h-[52px] items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-center text-sm font-semibold leading-tight transition disabled:opacity-60 ${
                            selected ? selectedClasses : 'border-[var(--border)]'
                          }`}
                        >
                          {selected && <span aria-hidden>✓</span>}
                          {label}
                        </button>
                      )
                    })}
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
