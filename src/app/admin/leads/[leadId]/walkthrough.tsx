'use client'

import { useActionState, useState } from 'react'
import {
  bookWalkthrough, markWalkthroughDone, walkthroughIcs, type LeadPipelineState,
} from '../../actions'
import { LocalTime } from '../../local-time'

const INITIAL: LeadPipelineState = {}

/**
 * A datetime, not a calendar.
 *
 * ---------------------------------------------------------------------------
 * WHY THE BROWSER DOES THE TIMEZONE ARITHMETIC
 * ---------------------------------------------------------------------------
 * `<input type="datetime-local">` hands back "2026-08-25T14:00" with no
 * timezone on it at all. Posting that string and parsing it on the server
 * resolves it against the server's clock — UTC on Netlify — so a walkthrough
 * booked for two in the afternoon in Texas would be stored as, and downloaded
 * as, nine in the morning. The only machine that knows which two o'clock was
 * meant is this one, so it converts to an instant before submitting and the
 * action takes the instant.
 *
 * The visible input keeps the plain value; a hidden field carries the ISO
 * string. That way the control behaves exactly like a date picker should and
 * nothing about the correction is on screen.
 */
export function WalkthroughPanel({
  leadId,
  dealershipName,
  walkthroughAt,
  walkthroughDoneAt,
}: {
  leadId: string
  dealershipName: string
  walkthroughAt: string | null
  walkthroughDoneAt: string | null
}) {
  const [bookState, book, booking] = useActionState(bookWalkthrough, INITIAL)
  const [doneState, done, marking] = useActionState(markWalkthroughDone, INITIAL)

  // The instant the browser computed, sent instead of the naked local value.
  const [instant, setInstant] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  async function download() {
    setDownloading(true)
    setDownloadError(null)
    try {
      const result = await walkthroughIcs(leadId)
      if (result.error || !result.ics) {
        setDownloadError(result.error ?? 'Nothing to download.')
        return
      }
      /*
        Saved from a blob rather than fetched from a URL.

        The file comes back from a server action, which carries the session and
        cannot be requested by anything that is not signed in — a route serving
        the same bytes would publish a prospect's name and phone number to
        anyone who guessed a uuid. See `walkthroughIcs`.
      */
      const url = URL.createObjectURL(new Blob([result.ics], { type: 'text/calendar' }))
      const link = document.createElement('a')
      link.href = url
      link.download = result.filename ?? 'walkthrough.ics'
      link.click()
      URL.revokeObjectURL(url)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="p-4">
      {walkthroughAt ? (
        <p className="text-sm">
          {walkthroughDoneAt ? 'Held ' : 'Booked for '}
          <span className="font-semibold">
            <LocalTime iso={walkthroughDoneAt ?? walkthroughAt} />
          </span>
          {walkthroughDoneAt && (
            <span className="text-neutral-500">
              {' '}· was booked for <LocalTime iso={walkthroughAt} />
            </span>
          )}
        </p>
      ) : (
        <p className="text-sm text-neutral-500">
          Nothing booked. A walkthrough is the step a tour code is issued for.
        </p>
      )}

      {walkthroughAt && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => { void download() }}
            disabled={downloading}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium transition hover:border-neutral-900 disabled:opacity-50 dark:border-neutral-700 dark:hover:border-neutral-300"
          >
            {downloading ? 'Building…' : 'Add to my calendar (.ics)'}
          </button>
          {/*
            Said out loud because it is the one surprising thing about the
            file. The UID is stable so a rebooking replaces the entry, but not
            every calendar honours that on a manual import — see the note on
            `sequence` in the action.
          */}
          <span className="text-xs text-neutral-500">
            Rebooking re-downloads; delete the old entry if your calendar keeps both.
          </span>
          {downloadError && (
            <span className="text-xs text-rose-700 dark:text-rose-400">{downloadError}</span>
          )}
        </div>
      )}

      <form action={book} className="mt-3">
        <input type="hidden" name="leadId" value={leadId} />
        <input type="hidden" name="walkthroughAt" value={instant} />

        <label
          className="block text-xs font-semibold uppercase tracking-wide text-neutral-500"
          htmlFor={`walkthrough-${leadId}`}
        >
          {walkthroughAt ? 'Move it to' : `Book a walkthrough with ${dealershipName}`}
        </label>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <input
            id={`walkthrough-${leadId}`}
            type="datetime-local"
            required
            onChange={(e) => {
              const value = e.currentTarget.value
              // Empty when the picker is cleared; `new Date('')` is Invalid
              // Date and would post the string "Invalid Date".
              setInstant(value ? new Date(value).toISOString() : '')
            }}
            className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-300"
          />
          <input
            name="note"
            maxLength={2000}
            placeholder="Who is joining, what they want to see"
            className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-300"
          />
          <button
            type="submit"
            disabled={booking || !instant}
            className="touch-target rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            {booking ? 'Booking…' : walkthroughAt ? 'Rebook' : 'Book'}
          </button>
        </div>
        {bookState.ok && (
          <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">{bookState.ok}</p>
        )}
        {bookState.error && (
          <p className="mt-2 text-xs text-rose-700 dark:text-rose-400">{bookState.error}</p>
        )}
      </form>

      {/*
        Only once something is booked, and only until it is held.

        Nothing observes whether a call happened, so this button is the fact —
        offering it on a lead with no booking would let a walkthrough be marked
        done that was never in anybody's diary.
      */}
      {walkthroughAt && !walkthroughDoneAt && (
        <form action={done} className="mt-3 flex flex-wrap items-center gap-2">
          <input type="hidden" name="leadId" value={leadId} />
          <input
            name="note"
            maxLength={2000}
            placeholder="How it went"
            className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-300"
          />
          <button
            type="submit"
            disabled={marking}
            className="touch-target rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            {marking ? 'Saving…' : 'It happened'}
          </button>
          {doneState.error && (
            <span className="text-xs text-rose-700 dark:text-rose-400">{doneState.error}</span>
          )}
        </form>
      )}
    </div>
  )
}
