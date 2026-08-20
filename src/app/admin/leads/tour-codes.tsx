'use client'

import { useActionState, useState } from 'react'
import { issueTourCodeForLead, revokeTourCodeAction, type TourCodeState } from '../actions'
/*
  Type-only, and it has to stay that way. `@/lib/demo-tour/store` is
  `server-only` and `@/lib/demo-tour/codes` imports `node:crypto` — pulling
  either into this bundle for a helper would drag Node's crypto into the
  browser. Which is why the action hands back an already-hyphenated code rather
  than this component calling `formatTourCode`.
*/
import type { TourCodeSummary } from '@/lib/demo-tour/store'
import { ago } from '../ui'

const INITIAL: TourCodeState = {}

/**
 * Tour codes for one lead: issue, see, withdraw.
 *
 * ---------------------------------------------------------------------------
 * WHY THE RAW CODE IS SHOWN EXACTLY ONCE
 * ---------------------------------------------------------------------------
 * The same discipline as the invitation link above it, for the same reason:
 * only the SHA-256 is stored, so there is nothing to recover afterwards and no
 * "resend" that could recover it. A credential the database can hand back is a
 * credential the database is responsible for keeping.
 *
 * The practical consequence is that this panel is the one moment it exists in
 * readable form, which is why it renders large, monospaced and hyphenated —
 * it is going to be read down a phone line, and every character misheard is a
 * support call with the prospect being sold to.
 *
 * Collapsed until asked for, like `ProvisionForm`. A dozen open panels turns a
 * list you scan into a wall you scroll past.
 */
export function TourCodes({
  leadId,
  dealershipName,
  contactName,
  codes,
  now,
}: {
  leadId: string
  dealershipName: string
  contactName: string
  codes: TourCodeSummary[]
  now: number
}) {
  const [state, formAction, pending] = useActionState(issueTourCodeForLead, INITIAL)
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const live = codes.filter((c) => c.status === 'VALID').length

  if (state.code) {
    // Already hyphenated by the action — see the import note above.
    const pretty = state.code
    return (
      <div className="mt-2 rounded-lg border border-sky-300 bg-sky-50 p-3 dark:border-sky-800 dark:bg-sky-950">
        <p className="text-sm font-semibold text-sky-900 dark:text-sky-200">
          Tour code for {state.label}
        </p>
        <p className="mt-1 text-xs text-sky-900/80 dark:text-sky-200/80">
          Shown once — only its hash is stored, so this is the only time it exists in readable form.
          Read it out or paste it into the email now. It opens{' '}
          <span className="font-mono">/tour</span> and expires{' '}
          {state.expiresAt ? new Date(state.expiresAt).toLocaleDateString() : 'in seven days'}.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <input
            readOnly
            value={pretty}
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 rounded-md border border-sky-300 bg-white px-3 py-2 font-mono text-lg font-bold tracking-[0.2em] dark:border-sky-800 dark:bg-neutral-950"
          />
          <button
            type="button"
            onClick={() => { void navigator.clipboard.writeText(pretty).then(() => setCopied(true)) }}
            // Primary-button treatment rather than a deep tint of the panel
            // colour, which has twice rendered as invisible white-on-pale.
            className="shrink-0 rounded-md bg-neutral-900 px-3 py-2 text-xs font-semibold text-white dark:bg-white dark:text-neutral-900"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-2">
      {codes.length > 0 && (
        <ul className="mb-2 space-y-1">
          {codes.map((c) => (
            <CodeRow key={c.id} code={c} now={now} />
          ))}
        </ul>
      )}

      {open ? (
        <form
          action={formAction}
          className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"
        >
          <input type="hidden" name="leadId" value={leadId} />
          <label
            className="block text-xs font-semibold uppercase tracking-wide text-neutral-500"
            htmlFor={`tour-label-${leadId}`}
          >
            Who is this for?
          </label>
          <input
            id={`tour-label-${leadId}`}
            name="label"
            required
            maxLength={120}
            /*
              Prefilled from the lead, because the label's whole job is making a
              row in the list recognisable three weeks later and "Lone Star Ford
              — Ray Delgado" does that better than anything anyone types under
              time pressure. Editable, since the person on the call is often not
              the person who filled the form in.
            */
            defaultValue={`${dealershipName} — ${contactName}`}
            className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-300"
          />
          <div className="mt-3 flex items-center gap-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
            >
              {pending ? 'Issuing…' : 'Issue a tour code'}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700"
            >
              Cancel
            </button>
          </div>
          {state.error && (
            <p className="mt-2 rounded-lg border border-rose-300 bg-rose-50 p-2 text-xs text-rose-900 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-100">
              {state.error}
            </p>
          )}
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium transition hover:border-neutral-900 dark:border-neutral-700 dark:hover:border-neutral-300"
        >
          {live > 0 ? 'Issue another tour code' : 'Issue a tour code'}
        </button>
      )}
    </div>
  )
}

/**
 * One issued code: what state it is in, whether anybody used it, and the way
 * to pull it.
 *
 * "Never used" is the fact worth surfacing. A code issued four days ago that
 * nobody has opened is a walkthrough that is quietly not happening, and it is
 * invisible everywhere else.
 */
function CodeRow({ code, now }: { code: TourCodeSummary; now: number }) {
  const [state, formAction, pending] = useActionState(revokeTourCodeAction, INITIAL)

  const tone =
    code.status === 'VALID'
      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
      : code.status === 'REVOKED'
        ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200'
        : 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300'

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-xs dark:border-neutral-800">
      <span className={`rounded px-1.5 py-0.5 font-semibold ${tone}`}>
        {code.status.toLowerCase()}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium">{code.label}</span>
      <span className="text-neutral-500">
        {code.uses === 0
          ? 'never used'
          : `${code.uses} use${code.uses === 1 ? '' : 's'} · last ${ago(code.lastUsedAt, now)}`}
      </span>
      <span className="text-neutral-500">
        {code.status === 'VALID'
          ? `expires ${code.expiresAt.toLocaleDateString()}`
          : code.status === 'REVOKED'
            ? `withdrawn ${ago(code.revokedAt, now)}`
            : `expired ${ago(code.expiresAt, now)}`}
      </span>
      {code.status === 'VALID' && !state.ok && (
        <form action={formAction}>
          <input type="hidden" name="codeId" value={code.id} />
          <button
            type="submit"
            disabled={pending}
            className="rounded-md border border-neutral-300 px-2 py-1 font-medium transition hover:border-rose-600 hover:text-rose-700 disabled:opacity-50 dark:border-neutral-700"
          >
            {pending ? 'Withdrawing…' : 'Withdraw'}
          </button>
        </form>
      )}
      {(state.ok || state.error) && (
        <span className={state.error ? 'text-rose-700 dark:text-rose-300' : 'text-neutral-500'}>
          {state.error ?? state.ok}
        </span>
      )}
    </li>
  )
}
