'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ExplainerPlayer } from '@/components/explainer/explainer-player'
import { explainerFor } from '@/lib/explainer'
import type { DeviceItem, DeviceSnapshot } from '@/lib/pairing/snapshot'

/**
 * The customer tablet.
 *
 * Polls rather than holding a socket open. Netlify runs this on functions
 * where a long-lived connection is awkward, and the thing being waited for —
 * an advisor tapping "send" — happens on a human timescale. A second of
 * latency on a device sitting on a desk is invisible.
 *
 * Idle, it shows its own name and nothing else. No customer, no vehicle, no
 * prices. A tablet left on a bench between visits should be as informative to
 * a passer-by as a switched-off one.
 */

const POLL_MS = 1500
const TOKEN_KEY = 'dealertech.device.token'

type State =
  | { phase: 'LOADING' }
  | { phase: 'ENROLLING'; code: string }
  | { phase: 'IDLE'; deviceName: string | null }
  | { phase: 'PRESENTING'; deviceName: string | null; snapshot: DeviceSnapshot; decisions: Record<string, string> }

function money(n: number): string {
  return `$${Math.round(n).toLocaleString()}`
}

async function call(action: string, token: string | null, extra: object = {}) {
  const res = await fetch('/api/device', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ action, ...extra }),
  })
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) }
}

const TIER_ACCENT: Record<string, string> = {
  NOW: 'border-l-rose-500',
  SOON: 'border-l-amber-500',
  PLANNED: 'border-l-neutral-300 dark:border-l-neutral-600',
}

export function Tablet() {
  const [state, setState] = useState<State>({ phase: 'LOADING' })
  const [explaining, setExplaining] = useState<DeviceItem | null>(null)
  const tokenRef = useRef<string | null>(null)

  /** Local decisions, so a tap feels instant while the post is in flight. */
  const [pending, setPending] = useState<Record<string, string>>({})

  const poll = useCallback(async () => {
    const token = tokenRef.current
    if (!token) return

    const { ok, status, data } = await call('poll', token)

    if (status === 401) {
      // Revoked, or the row is gone. Start over rather than sitting on a dead
      // token showing a stale menu.
      localStorage.removeItem(TOKEN_KEY)
      tokenRef.current = null
      setState({ phase: 'LOADING' })
      return
    }
    if (!ok) return

    if (!data.paired) {
      setState((s) => (s.phase === 'ENROLLING' ? s : { phase: 'LOADING' }))
      return
    }

    if (data.session) {
      setState({
        phase: 'PRESENTING',
        deviceName: data.deviceName ?? null,
        snapshot: data.session.snapshot as DeviceSnapshot,
        decisions: (data.session.decisions ?? {}) as Record<string, string>,
      })
    } else {
      setPending({})
      setExplaining(null)
      setState({ phase: 'IDLE', deviceName: data.deviceName ?? null })
    }
  }, [])

  // Enrol once, then poll forever.
  useEffect(() => {
    let cancelled = false

    async function boot() {
      const stored = localStorage.getItem(TOKEN_KEY)
      if (stored) {
        tokenRef.current = stored
        await poll()
        return
      }
      const { data } = await call('enroll', null)
      if (cancelled || !data.token) return
      localStorage.setItem(TOKEN_KEY, data.token)
      tokenRef.current = data.token
      setState({ phase: 'ENROLLING', code: data.code })
    }

    void boot()
    const id = setInterval(() => void poll(), POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [poll])

  async function decide(id: string, decision: string) {
    const next = { ...pending, [id]: decision }
    setPending(next)
    await call('decide', tokenRef.current, { decisions: { [id]: decision } })
  }

  // ------------------------------------------------------------------ views

  if (state.phase === 'LOADING') {
    return <Centre>Connecting…</Centre>
  }

  if (state.phase === 'ENROLLING') {
    return (
      <Centre>
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-neutral-500">
          Pair this tablet
        </p>
        <p className="mt-6 font-mono text-6xl font-bold tracking-[0.2em] sm:text-7xl">
          {state.code}
        </p>
        <p className="mt-6 max-w-sm text-neutral-600 dark:text-neutral-400">
          Enter this code in DealerTech under Devices to name this tablet and pair it. The code
          expires in ten minutes.
        </p>
      </Centre>
    )
  }

  if (state.phase === 'IDLE') {
    /*
      Deliberately empty. A tablet between visits should tell a passer-by
      nothing about the last customer who held it.
    */
    return (
      <Centre>
        <p className="text-xl font-semibold">{state.deviceName ?? 'Tablet'}</p>
        <p className="mt-2 text-neutral-500">Ready</p>
      </Centre>
    )
  }

  const { snapshot } = state
  const decisions = { ...state.decisions, ...pending }
  const acceptedTotal = snapshot.tiers
    .flatMap((t) => t.items)
    .filter((i) => decisions[i.id] === 'ACCEPTED')
    .reduce((s, i) => s + i.customerOutOfPocket, 0)
  const acceptedCount = Object.values(decisions).filter((d) => d === 'ACCEPTED').length

  return (
    <main className="min-h-dvh bg-[var(--background)] pb-32">
      <div className="mx-auto max-w-3xl px-5 py-8 sm:px-6">
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
                        <p className="text-2xl font-bold tabular-nums">
                          {item.customerOutOfPocket === 0 ? 'No charge' : money(item.customerOutOfPocket)}
                        </p>
                        {savings > 0 && (
                          <p className="text-sm text-neutral-500 line-through tabular-nums">
                            {money(item.fullAmount)}
                          </p>
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
                      <div className="ml-auto flex gap-2">
                        <button
                          type="button"
                          onClick={() => decide(item.id, decision === 'DECLINED' ? 'PENDING' : 'DECLINED')}
                          aria-pressed={decision === 'DECLINED'}
                          className={`touch-target rounded-xl border px-4 py-2.5 text-sm font-semibold ${
                            decision === 'DECLINED'
                              ? 'border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900'
                              : 'border-[var(--border)]'
                          }`}
                        >
                          Not today
                        </button>
                        <button
                          type="button"
                          onClick={() => decide(item.id, decision === 'ACCEPTED' ? 'PENDING' : 'ACCEPTED')}
                          aria-pressed={decision === 'ACCEPTED'}
                          className={`touch-target rounded-xl border px-5 py-2.5 text-sm font-bold ${
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

        <p className="mt-6 text-xs leading-relaxed text-neutral-500">
          Choosing here tells your advisor what you would like done — they will confirm the work and
          the final price with you before anything starts. Prices are estimates until parts are
          confirmed.
        </p>
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-[var(--border)] bg-[var(--background)]/95 px-5 py-4 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-3xl items-baseline justify-between gap-4">
          <span className="text-sm font-semibold">
            You have said yes to {acceptedCount} of {snapshot.itemCount}
          </span>
          <span className="text-3xl font-bold tabular-nums">{money(acceptedTotal)}</span>
        </div>
      </div>

      {explaining?.explainerKey && explainerFor(explaining.explainerKey) && (
        <ExplainerPlayer
          explainer={explainerFor(explaining.explainerKey)!}
          reading={explaining.reading}
          onClose={() => setExplaining(null)}
        />
      )}
    </main>
  )
}

function Centre({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-[var(--background)] px-6 text-center">
      {children}
    </main>
  )
}
