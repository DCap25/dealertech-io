'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ServiceMenu } from '@/components/present/service-menu'
import type { DeviceSnapshot } from '@/lib/pairing/snapshot'
import {
  menuTotals, nextTabletState, type PendingTaps, type PolledSession, type TabletState,
} from '@/lib/pairing/tablet-state'

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
 * a passer-by as a switched-off one — which now holds without an advisor
 * remembering, because the server ends a session nobody has touched for thirty
 * minutes and this screen goes idle at the next poll.
 *
 * What the poll does to the screen lives in `tablet-state.ts` rather than here:
 * this file is a shell that fetches and renders, and the decisions worth
 * getting right are pure and tested.
 */

const POLL_MS = 1500
const TOKEN_KEY = 'dealertech.device.token'

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


export function Tablet() {
  /*
    The screen and the taps still in flight, held together.

    They were two pieces of state and the pair could disagree: `pending` was
    dropped when the session went away but not when a *different* session
    arrived, so a re-curated menu inherited the last customer's answers.
    Advancing both in one call through `nextTabletState` makes that impossible
    to get wrong again — and, being one functional update, it cannot read a
    stale copy of either half from the poll's closure.
  */
  const [screen, setScreen] = useState<{ state: TabletState; pending: PendingTaps }>({
    state: { phase: 'LOADING' },
    pending: {},
  })
  const { state, pending } = screen
  const tokenRef = useRef<string | null>(null)

  const poll = useCallback(async () => {
    const token = tokenRef.current
    if (!token) return

    const { ok, status, data } = await call('poll', token)

    if (status === 401) {
      // Revoked, or the row is gone. Start over rather than sitting on a dead
      // token showing a stale menu.
      localStorage.removeItem(TOKEN_KEY)
      tokenRef.current = null
      setScreen({ state: { phase: 'LOADING' }, pending: {} })
      return
    }
    if (!ok) return

    if (!data.paired) {
      setScreen((s) => (
        s.state.phase === 'ENROLLING' ? s : { state: { phase: 'LOADING' }, pending: {} }
      ))
      return
    }

    const session: PolledSession | null = data.session
      ? {
          id: String(data.session.id),
          snapshot: data.session.snapshot as DeviceSnapshot,
          decisions: (data.session.decisions ?? {}) as Record<string, string>,
        }
      : null

    setScreen((s) => nextTabletState(s.state, s.pending, {
      deviceName: data.deviceName ?? null,
      session,
    }))
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
      setScreen({ state: { phase: 'ENROLLING', code: data.code }, pending: {} })
    }

    void boot()
    const id = setInterval(() => void poll(), POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [poll])

  async function decide(id: string, decision: string) {
    // Applied to whatever is on screen at the moment of the tap. If a poll has
    // swapped the menu underneath, the tap belongs to the menu that arrived,
    // and the server sanitises it against that snapshot regardless.
    setScreen((s) => ({ ...s, pending: { ...s.pending, [id]: decision } }))
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

      Reached three ways now: the advisor takes the menu back, another menu is
      pushed elsewhere, or nobody has touched this one for thirty minutes and
      the server ended it on read. The third is the one that covers the bench
      at closing time.
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
  // Every figure below the menu comes from the items on this snapshot, not from
  // the keys of the decisions map — see `menuTotals`.
  const { accepted: acceptedCount, callMe: callMeCount, acceptedTotal } =
    menuTotals(snapshot, decisions)

  return (
    <main className="min-h-dvh bg-[var(--background)] pb-32">
      <div className="mx-auto max-w-3xl px-5 py-8 sm:px-6">
        {/*
          The menu itself is the shared component, not a copy.

          This screen used to render its own — header, coverage banner, cards,
          and its own three answer buttons — which meant the tablet and the
          phone link were two implementations of the one screen the product is
          judged on. They had already drifted once. Now the paired tablet, the
          link on a customer's phone and the advisor's own preview are the same
          component with different shells around it, so a change to how a
          customer is asked lands everywhere or nowhere.
        */}
        <ServiceMenu snapshot={snapshot} decisions={decisions} onDecide={decide} />
      </div>

      {/*
        The running total stays here rather than moving into the shared
        component. The three surfaces genuinely differ at the bottom of the
        screen: the tablet has no submit because the advisor is standing next
        to it, the phone needs a name and a send button, and the advisor's
        preview needs a way back out. Only the menu is the same.
      */}
      <div className="fixed inset-x-0 bottom-0 border-t border-[var(--border)] bg-[var(--background)]/95 px-5 py-4 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-3xl items-baseline justify-between gap-4">
          <span className="text-sm font-semibold">
            You have said yes to {acceptedCount} of {snapshot.itemCount}
            {/*
              Counted separately and never folded into the total. A call-me is
              not money on the ticket, and showing it as such would be the
              advisor quietly counting a maybe as a yes.
            */}
            {callMeCount > 0 && (
              <span className="ml-2 font-normal text-sky-700 dark:text-sky-400">
                · {callMeCount} to talk through
              </span>
            )}
          </span>
          <span className="text-3xl font-bold tabular-nums">{money(acceptedTotal)}</span>
        </div>
      </div>
    </main>
  )
}

function Centre({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-[var(--background)] px-6 text-center">
      {children}
    </main>
  )
}
