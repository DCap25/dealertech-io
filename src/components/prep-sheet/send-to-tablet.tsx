'use client'

import { useEffect, useState } from 'react'
import {
  listPairedDevices, readSessionDecisions, sendMenuLink, sendMenuToDevice, takeBackMenu,
} from '@/app/drive/present-actions'
import type { OpportunityDecision } from '@/lib/prep-sheet/presentation'

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
 */

const POLL_MS = 1500

interface Device {
  id: string
  name: string | null
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

  useEffect(() => {
    void listPairedDevices().then((d) => setDevices(d.map((x) => ({ id: x.id, name: x.name }))))
  }, [])

  // Mirror the customer's taps onto the advisor's screen while it is live.
  useEffect(() => {
    if (!sessionId) return
    const id = setInterval(async () => {
      const result = await readSessionDecisions(sessionId)
      if (!result) return
      for (const [oppId, value] of Object.entries(result.decisions)) {
        if (value === 'ACCEPTED' || value === 'DECLINED' || value === 'PENDING') {
          onCustomerDecision(oppId, value)
        }
      }
      setSeen(Object.values(result.decisions).filter((d) => d !== 'PENDING').length)
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
    return (
      <div className="rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3 dark:border-emerald-800 dark:bg-emerald-950">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-emerald-900 dark:text-emerald-100">
              On {sentTo}
            </p>
            <p className="mt-0.5 text-xs text-emerald-800 dark:text-emerald-300">
              {seen === 0 ? 'Waiting for them to start…' : `${seen} answered so far`}
            </p>
          </div>
          <button
            type="button"
            onClick={async () => {
              await takeBackMenu(sessionId)
              setSessionId(null)
            }}
            className="touch-target rounded-xl border border-emerald-600 px-3.5 py-2 text-xs font-bold text-emerald-900 dark:text-emerald-100"
          >
            Take it back
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {devices.map((device) => (
        <button
          key={device.id}
          type="button"
          disabled={busy || includedIds.length === 0}
          onClick={async () => {
            setBusy(true)
            setError(null)
            const result = await sendMenuToDevice(appointmentId, device.id, includedIds)
            setBusy(false)
            if (result.status === 'SENT' && result.sessionId) {
              setSessionId(result.sessionId)
              const where = result.deviceName ?? device.name ?? 'the tablet'
              setSentTo(where)
              onPresented?.(where)
            } else {
              setError(result.message ?? 'Could not send it.')
            }
          }}
          className="touch-target rounded-xl border border-[var(--border)] px-3.5 py-2 text-xs font-bold transition hover:border-neutral-900 disabled:opacity-40 dark:hover:border-neutral-300"
        >
          {busy ? 'Sending…' : `Send to ${device.name ?? 'tablet'}`}
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
