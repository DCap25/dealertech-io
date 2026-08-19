'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ServiceMenu } from '@/components/present/service-menu'
import type { DeviceSnapshot } from '@/lib/pairing/snapshot'
import {
  menuTotals, nextTabletState, withAuthorisation, withoutTap,
  type PendingTaps, type PolledSession, type TabletState,
} from '@/lib/pairing/tablet-state'
import { isUsableAuthorisationName } from '@/lib/presentation/link'

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
 * Two menus can be on it. An advisor presenting one, which is the original and
 * has no submit because the conversation ends when they take it back; and one
 * handed over, where the customer works through it alone and finishes it
 * themselves — the doctor's-office questionnaire, gone over together
 * afterwards. The second is the first plus the link's confirm bar and the
 * link's done state, because a customer answering alone on our glass and a
 * customer answering alone on their phone are doing the same thing and must not
 * be asked two different ways.
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
    The name on the confirm bar, and what the last submit said.

    Kept here rather than in `TabletState` on purpose: half-typed text is the
    browser's business, and a poll landing mid-keystroke must never rewrite what
    somebody is typing. Only the outcome — the authorisation — reaches the pure
    layer.
  */
  const [name, setName] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

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
          selfServe: data.session.selfServe === true,
          authorized: data.session.authorized ?? null,
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
    const { ok } = await call('decide', tokenRef.current, { decisions: { [id]: decision } })

    /*
      A refused tap must not stay painted.

      The one that happens is the customer answering as the advisor takes the
      menu back: `recordDeviceDecisions` finds no active session and the route
      returns 409. This used to be ignored, so the card stayed green for up to a
      poll while the server held nothing — the customer's last word on the
      screen, recorded nowhere. 403 (the tablet was unpaired) and any other
      failure are the same lie for a different reason — including the one this
      screen can now produce on its own: a tap racing the customer's own "send
      to my advisor", which the server refuses because the record has stopped
      moving.

      Un-paint it, then poll immediately rather than waiting out the interval:
      the poll is what knows whether the menu is gone, replaced or still there,
      and `nextTabletState` already answers that correctly for all three.
    */
    if (!ok) {
      setScreen((s) => ({ ...s, pending: withoutTap(s.pending, id) }))
      await poll()
    }
  }

  /**
   * "Send to my advisor" on a tablet that was handed over.
   *
   * The same act as the link's confirm bar and deliberately the same code path
   * shape: the server freezes what was shown alongside what was answered, and
   * this screen becomes a record of it rather than a control.
   *
   * A refusal is not swallowed. The one that happens is the advisor taking the
   * menu back while the customer was typing their name; the poll that follows
   * puts the tablet back to idle, which is the truth, and the sentence explains
   * the second in between.
   */
  async function sendToAdvisor() {
    if (sending) return
    setSending(true)
    setSendError(null)

    const { ok, data } = await call('authorise', tokenRef.current, { name })
    setSending(false)

    if (!ok || !data.authorized) {
      setSendError(
        typeof data.error === 'string'
          ? data.error
          : 'That did not send. Please ask your advisor.',
      )
      await poll()
      return
    }

    setScreen((s) => withAuthorisation(s, data.authorized))
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

  const { snapshot, selfServe, authorized } = state
  const decisions = { ...state.decisions, ...pending }
  // Every figure below the menu comes from the items on this snapshot, not from
  // the keys of the decisions map — see `menuTotals`.
  const {
    accepted: acceptedCount, callMe: callMeCount, answered, acceptedTotal,
  } = menuTotals(snapshot, decisions)

  /*
    Once they have sent it, the answers are a record rather than a control.

    The same `readOnly` the link's menu uses at the same moment, for the same
    reason: the server has stopped taking taps against this session, so a card
    that still looked pressable would be offering something nobody would honour.
  */
  const done = authorized !== null
  const askForName = selfServe && !done && snapshot.itemCount > 0

  return (
    <main className="min-h-dvh bg-[var(--background)] pb-32">
      <div className="mx-auto max-w-3xl px-5 py-8 sm:px-6">
        {done && (
          /*
            The link's done state, word for word.

            A customer who answers alone on a tablet and one who answers alone
            on their phone have done the same thing and are owed the same
            sentence — including the second half, which is the promise the whole
            product rests on: nothing has been set in motion by the tapping.
          */
          <div className="mb-6 rounded-2xl border border-emerald-300 bg-emerald-50 p-5 dark:border-emerald-800 dark:bg-emerald-950">
            <p className="text-lg font-bold text-emerald-900 dark:text-emerald-100">
              Sent to your advisor
            </p>
            <p className="mt-1 text-sm text-emerald-900/90 dark:text-emerald-200/90">
              {authorized.name ? `Confirmed by ${authorized.name}.` : ''} Nothing starts until they
              have spoken to you.
            </p>
          </div>
        )}

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
        <ServiceMenu
          snapshot={snapshot}
          decisions={decisions}
          onDecide={decide}
          readOnly={done}
        />

        {selfServe && (
          /*
            The footer sentence the link already carries, on the surface that
            now needs it just as much.

            An attended menu does not print this because the advisor is saying
            it out loud; a handed-over one has nobody to say it, and a customer
            tapping "Yes" alone must not be able to think they have committed to
            anything. Invariant 2, on a new surface.
          */
          <p className="mt-8 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
            Choosing here tells your advisor what you would like done — they will confirm the work
            and the final price with you before anything starts. Prices are estimates until parts
            are confirmed.
          </p>
        )}
      </div>

      {/*
        The running total stays here rather than moving into the shared
        component. The three surfaces genuinely differ at the bottom of the
        screen: an attended tablet has no submit because the advisor is standing
        next to it, the phone needs a name and a send button, and the advisor's
        preview needs a way back out. Only the menu is the same.

        A handed-over tablet is the attended one plus the phone's finish, which
        is exactly what Q6 is: no third screen, no second idea of what finishing
        means.
      */}
      <div className="fixed inset-x-0 bottom-0 border-t border-[var(--border)] bg-[var(--background)]/95 px-5 py-4 backdrop-blur sm:px-6">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-sm font-semibold">
              {selfServe
                ? `${answered} of ${snapshot.itemCount} answered`
                : `You have said yes to ${acceptedCount} of ${snapshot.itemCount}`}
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

          {askForName && (
            <form
              onSubmit={(e) => { e.preventDefault(); void sendToAdvisor() }}
              className="mt-3 flex flex-wrap items-center gap-2"
            >
              <label htmlFor="confirm-name" className="sr-only">Your name</label>
              <input
                id="confirm-name"
                name="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Type your name to confirm"
                autoComplete="off"
                className="min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-base"
              />
              {/*
                Enabled with nothing chosen, exactly as on the phone.

                "No thank you, none of it" is a real and complete answer, and an
                advisor is far better off hearing it now than finding out at
                four o'clock. What is required is the name — which matters more
                here than on a phone, not less: this is a shared device in a
                waiting room, and the typed name is the only thing tying the
                answers to a person. Forgiving about *what* they type, for the
                reason `isUsableAuthorisationName` gives.
              */}
              <button
                type="submit"
                disabled={sending || !isUsableAuthorisationName(name)}
                className="touch-target rounded-xl bg-neutral-900 px-6 py-3 text-base font-bold text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
              >
                {sending ? 'Sending…' : 'Send to my advisor'}
              </button>
            </form>
          )}

          {sendError && (
            <p className="mt-2 text-sm font-medium text-rose-700 dark:text-rose-400">
              {sendError}
            </p>
          )}
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
