'use client'

import { useEffect, useState } from 'react'
import {
  listPairedDevices, readSessionDecisions, sendMenuLink, sendMenuToDevice, takeBackMenu,
  type PresentMode,
} from '@/app/drive/present-actions'
import type { OpportunityDecision } from '@/lib/prep-sheet/presentation'
import { isDecision } from '@/lib/presentation/decisions'

/**
 * Getting the built menu in front of the customer.
 *
 * Two routes, because there are two conversations. At write-up the customer is
 * standing at the podium and a tablet is the right thing. After the technician
 * has been under the car they are at work, and the only way to reach them is
 * their own phone — which is where most of the money on a repair order is won
 * or lost.
 *
 * The link is offered whether or not a tablet exists. Gating it behind a paired
 * device would have made the more valuable of the two conversations depend on
 * hardware it does not use.
 *
 * A tablet session is polled while it is live so the advisor watches taps land
 * on their own screen, and they keep control — "take it back" ends it and the
 * tablet returns to showing nothing. A link is not polled: the customer may
 * answer in ten minutes or at lunchtime, and a spinner on the advisor's screen
 * for two hours is a lie about what is happening.
 *
 * The tablet goes two ways. Presented, the advisor is standing next to it and
 * the mirror is a convenience. Handed over, the mirror is the only thing they
 * have: nobody is watching the customer work down the list, so the panel counts
 * progress against the menu itself and — the state this was missing — says when
 * they are finished and whose name is on it.
 *
 * Not polled is not the same as not read, which is what it used to mean. A
 * link's answers land on the prep sheet when it loads and again whenever the
 * advisor comes back to the tab (`prep-sheet-view.tsx`), and the hand-off
 * re-reads them on the server before anything reaches the DMS.
 */

const POLL_MS = 1500

interface Device {
  id: string
  name: string | null
}

/**
 * "Betty Lewis" → "Betty", for the one line an advisor reads at a glance.
 *
 * The full name still appears in the same panel and in the permanent record;
 * this is only the heading, where the point is to recognise the person walking
 * back towards the podium. Falls back to whatever was typed, because the rule
 * for a confirmation name is deliberately forgiving and "Bec" is a real answer.
 */
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name
}

export function SendToTablet({
  appointmentId,
  includedIds,
  onCustomerDecision,
  onPresented,
}: {
  appointmentId: string | null
  includedIds: string[]
  onCustomerDecision: (id: string, decision: OpportunityDecision) => void
  /** Names the tablet a menu went to, so the DMS note can say where. */
  onPresented?: (deviceName: string | null) => void
}) {
  const [devices, setDevices] = useState<Device[] | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [seen, setSeen] = useState(0)
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  /*
    Which conversation the advisor is about to have.

    Held here rather than asked per device, because it is a decision about the
    moment and not about the hardware — the same tablet is presented at the
    podium at eight and handed to somebody in the waiting room at nine.
  */
  const [mode, setMode] = useState<PresentMode>('ATTENDED')
  const [onTablet, setOnTablet] = useState<PresentMode>('ATTENDED')
  /** What the customer answered on a handed-over tablet, once they send it. */
  const [finished, setFinished] = useState<{ name: string } | null>(null)
  const [itemsOnMenu, setItemsOnMenu] = useState(0)
  const [callMe, setCallMe] = useState(0)

  useEffect(() => {
    void listPairedDevices().then((d) => setDevices(d.map((x) => ({ id: x.id, name: x.name }))))
  }, [])

  /**
   * Mirror the customer's taps onto the advisor's screen while it is live.
   *
   * The guard is `isDecision` rather than a list of values written out here.
   * The list this replaced read `ACCEPTED | DECLINED | PENDING`, which silently
   * dropped `CALL_ME` — the one answer `decisions.ts` argues hardest for, and
   * the only one nobody else recovers: the customer watched their card turn
   * blue while the advisor's screen kept the line pending, counted it as still
   * winnable, and handed off without the "customer asked to be called" block
   * that `command-center.ts` writes for exactly this. The job the filter
   * is actually doing is keeping junk and the advisor-only `SKIPPED` out of
   * `decideFromCustomer`, and the shared guard does that without being able to
   * fall behind the `Decision` type the way a literal list did.
   *
   * `PENDING` is forwarded on purpose. A tablet is mirrored while the customer
   * is standing there, and tapping the same button twice clears the choice
   * (`service-menu.tsx`) — an answer taken back in front of the advisor is
   * something they should see happen. That is the opposite of the link path,
   * where `answersToApply` drops `PENDING`: those answers land hours later, so
   * a cleared line there would blank a decision the advisor has since made
   * themselves rather than narrate a change they just watched.
   *
   * The server sanitises on write (`recordDeviceDecisions` → `sanitizeDecisions`),
   * so this is belt-and-braces rather than the boundary that matters.
   */
  useEffect(() => {
    if (!sessionId) return
    const id = setInterval(async () => {
      const result = await readSessionDecisions(sessionId)
      if (!result) return
      for (const [oppId, value] of Object.entries(result.decisions)) {
        if (isDecision(value)) onCustomerDecision(oppId, value)
      }
      /*
        Counted on the server against the session's own snapshot.

        It used to be counted here off the keys of the decisions map, which is
        the same number in the ordinary case and a different one whenever the
        map holds an id that is not on the menu in front of the customer. The
        tablet's footer already counts it the snapshot's way (`menuTotals`);
        having the advisor's screen read the same figure is what makes "4 of 6
        answered" one fact rather than two screens' opinions — which matters
        far more once nobody is standing over the tablet to compare them.
      */
      setSeen(result.totals.answered)
      setItemsOnMenu(result.totals.itemCount)
      setCallMe(result.totals.callMe)
      // The customer put their name to it. A fact about the visit, so it stays
      // on screen even after the session itself goes quiet.
      if (result.authorized) setFinished({ name: result.authorized.name })
      if (!result.active) setSessionId(null)
    }, POLL_MS)
    return () => clearInterval(id)
  }, [sessionId, onCustomerDecision])

  if (!appointmentId) return null
  if (devices === null) return null

  const linkButton = (
    <button
      type="button"
      disabled={busy || includedIds.length === 0}
      onClick={async () => {
        setBusy(true)
        setError(null)
        const result = await sendMenuLink(appointmentId, includedIds)
        setBusy(false)
        if (result.status === 'CREATED') {
          setLink(`${window.location.origin}${result.path}`)
          setCopied(false)
          onPresented?.('a link')
        } else {
          setError(result.message)
        }
      }}
      className="touch-target rounded-xl border border-[var(--border)] px-3.5 py-2 text-xs font-bold transition hover:border-neutral-900 disabled:opacity-40 dark:hover:border-neutral-300"
    >
      {busy ? 'Creating…' : 'Send them a link'}
    </button>
  )

  if (link) {
    return (
      <div className="rounded-2xl border border-sky-300 bg-sky-50 px-4 py-3 dark:border-sky-800 dark:bg-sky-950">
        <p className="text-sm font-bold text-sky-900 dark:text-sky-100">
          Link ready — text or email it to them
        </p>
        {/*
          Said plainly, because an advisor who assumes we sent it will not, and
          the customer will sit waiting for a message that never arrives.
        */}
        <p className="mt-0.5 text-xs text-sky-800 dark:text-sky-300">
          We do not send it for you yet. It works for twelve hours and shows them exactly this
          menu — their answers come back here.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <input
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 rounded-lg border border-sky-300 bg-white px-2 py-1.5 font-mono text-xs dark:border-sky-800 dark:bg-neutral-950"
          />
          <button
            type="button"
            onClick={() => { void navigator.clipboard.writeText(link).then(() => setCopied(true)) }}
            /*
              The app's primary-button treatment rather than a deep tint of the
              panel colour. Twice now a bg-{colour}-800/900 has rendered as
              white-on-pale — invisible — because the utility never reached the
              stylesheet. Reusing a class the app already leans on everywhere
              takes that whole failure mode off the table for a button whose
              only job is to be pressed.
            */
            className="touch-target shrink-0 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-bold text-white dark:bg-white dark:text-neutral-900"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            onClick={() => setLink(null)}
            className="touch-target shrink-0 rounded-lg border border-sky-300 px-3 py-1.5 text-xs font-bold text-sky-900 dark:border-sky-800 dark:text-sky-100"
          >
            Done
          </button>
        </div>
      </div>
    )
  }

  if (devices.length === 0) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {linkButton}
        <p className="w-full text-xs text-neutral-500">
          No tablets paired.{' '}
          <a href="/devices" className="underline">Pair one</a>{' '}
          to hand the menu across at the podium as well.
        </p>
        {error && (
          <p className="w-full rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:bg-rose-950 dark:text-rose-200">
            {error}
          </p>
        )}
      </div>
    )
  }

  if (sessionId) {
    /*
      Three states, and they are genuinely three different things to know.

      Presenting: the advisor is holding the conversation and the mirror is
      there so they can watch answers land without leaning over the customer.
      Handed over and still going: nobody is standing over it, so "3 of 6
      answered" is the only sign of life there is. Finished: the customer typed
      their name and sent it, which is the moment the advisor is waiting for and
      used to look identical to somebody who had simply stopped tapping.
    */
    const heading = finished
      ? `${firstName(finished.name)} is done`
      : onTablet === 'SELF_SERVE'
        ? `Handed over on ${sentTo}`
        : `On ${sentTo}`

    const detail = finished
      ? [
          `${seen} of ${itemsOnMenu} answered`,
          ...(callMe > 0 ? [`${callMe} call-me`] : []),
          `confirmed by ${finished.name}`,
        ].join(', ')
      : seen === 0
        ? 'Waiting for them to start…'
        : onTablet === 'SELF_SERVE'
          // Out of how many, because nobody is watching them work through it and
          // "3 answered" says nothing about whether they are nearly there.
          ? `${seen} of ${itemsOnMenu} answered`
          : `${seen} answered so far`

    return (
      <div className="rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3 dark:border-emerald-800 dark:bg-emerald-950">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-emerald-900 dark:text-emerald-100">
              {heading}
            </p>
            <p className="mt-0.5 text-xs text-emerald-800 dark:text-emerald-300">
              {detail}
            </p>
            {finished && (
              /*
                Said here as well as on the customer's screen.

                The advisor is about to go over the answers with them, and the
                thing that makes that conversation work is that nothing has been
                decided yet. A "done" panel with no such line invites reading it
                as an authorisation to start work, which it is not.
              */
              <p className="mt-1 text-xs text-emerald-800/80 dark:text-emerald-300/80">
                Their answers, not an approval to start — go through them together.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={async () => {
              /*
                The last answers land before the mirror dies.

                Clearing `sessionId` stops the poll above on the next render, so
                whatever the customer tapped in the final interval used to be
                ended, kept on the row and shown to nobody — the advisor turned
                to their screen and the line they had just watched go green was
                pending again. `takeBackMenu` returns the decisions the session
                closed with, and they go through the same `isDecision` guard the
                poll uses, so a value can only reach the advisor's state by the
                one route.

                A tap that raced past the end is genuinely lost from both
                screens: the server refused it (409) and the tablet un-paints
                it. There is nothing here to recover, and pretending otherwise
                would put an answer on the advisor's sheet that the customer's
                own screen no longer shows.
              */
              const { decisions } = await takeBackMenu(sessionId)
              for (const [oppId, value] of Object.entries(decisions)) {
                if (isDecision(value)) onCustomerDecision(oppId, value)
              }
              setSessionId(null)
              /*
                The panel goes with the session, finished or not.

                It is the control for a live menu, and the advisor has just
                ended one — leaving "Betty is done" on screen with nothing left
                to take back would be a panel that cannot be dismissed and a
                tablet list they cannot get back to. What the customer answered
                is not lost by this: it is on their sheet, forwarded two lines
                above, and on the presentation row for good.
              */
              setFinished(null)
            }}
            className="touch-target rounded-xl border border-emerald-600 px-3.5 py-2 text-xs font-bold text-emerald-900 dark:text-emerald-100"
          >
            {/*
              Still "take it back" after they have finished. They are holding
              the tablet and the advisor is about to go through the answers with
              them; the button ends the same thing it always ended.
            */}
            Take it back
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/*
        Which conversation, chosen before the tablet is picked.

        Two buttons rather than a second button per device: a store with three
        tablets would otherwise get six, and the choice is about the moment
        rather than the hardware. The send buttons then say which one it is, so
        the mode cannot be set and forgotten a screen earlier.
      */}
      <div className="flex w-full flex-wrap items-center gap-2">
        {([
          ['ATTENDED', 'I will present it'],
          ['SELF_SERVE', 'Hand it over'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            aria-pressed={mode === value}
            className={`touch-target rounded-xl border px-3.5 py-2 text-xs font-bold transition ${
              mode === value
                ? 'border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900'
                : 'border-[var(--border)]'
            }`}
          >
            {label}
          </button>
        ))}
        <p className="text-xs text-neutral-500">
          {mode === 'SELF_SERVE'
            ? 'They work through it on their own and send it to you when they are done.'
            : 'You turn the screen around and go through it with them.'}
        </p>
      </div>

      {devices.map((device) => (
        <button
          key={device.id}
          type="button"
          disabled={busy || includedIds.length === 0}
          onClick={async () => {
            setBusy(true)
            setError(null)
            const result = await sendMenuToDevice(appointmentId, device.id, includedIds, mode)
            setBusy(false)
            if (result.status === 'SENT' && result.sessionId) {
              setSessionId(result.sessionId)
              // What this session is, as sent. `mode` is a control and can be
              // changed for the next push; the panel has to describe this one.
              setOnTablet(mode)
              setFinished(null)
              setSeen(0)
              const where = result.deviceName ?? device.name ?? 'the tablet'
              setSentTo(where)
              onPresented?.(where)
            } else {
              setError(result.message ?? 'Could not send it.')
            }
          }}
          className="touch-target rounded-xl border border-[var(--border)] px-3.5 py-2 text-xs font-bold transition hover:border-neutral-900 disabled:opacity-40 dark:hover:border-neutral-300"
        >
          {busy
            ? 'Sending…'
            : mode === 'SELF_SERVE'
              ? `Hand ${device.name ?? 'tablet'} over`
              : `Send to ${device.name ?? 'tablet'}`}
        </button>
      ))}
      {linkButton}
      {error && (
        <p className="w-full rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:bg-rose-950 dark:text-rose-200">
          {error}
        </p>
      )}
    </div>
  )
}
