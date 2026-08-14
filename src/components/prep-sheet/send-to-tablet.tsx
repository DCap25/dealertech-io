'use client'

import { useEffect, useState } from 'react'
import {
  listPairedDevices, readSessionDecisions, sendMenuToDevice, takeBackMenu,
} from '@/app/drive/present-actions'
import type { OpportunityDecision } from '@/lib/prep-sheet/presentation'

/**
 * Sending the built menu to a customer tablet, and watching what they do with
 * it.
 *
 * Polls the session while it is live so the advisor sees taps land on their
 * own screen. The advisor keeps control: "take it back" ends the session and
 * the tablet returns to showing nothing.
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

  if (devices.length === 0) {
    return (
      <p className="text-xs text-neutral-500">
        No tablets paired.{' '}
        <a href="/devices" className="underline">
          Pair one
        </a>{' '}
        to hand the menu across.
      </p>
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
      {error && (
        <p className="w-full rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:bg-rose-950 dark:text-rose-200">
          {error}
        </p>
      )}
    </div>
  )
}
