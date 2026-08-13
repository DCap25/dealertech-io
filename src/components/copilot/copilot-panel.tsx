'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { COMMON_OBJECTIONS, type CopilotIntent } from '@/lib/copilot/types'
import type { OpportunityDecision } from '@/lib/prep-sheet/presentation'

/**
 * The Co-Pilot drawer.
 *
 * Side panel on desktop, bottom sheet on a tablet held in portrait. It knows
 * the visit only by appointment id — every fact in an answer is re-derived
 * server-side, so nothing here can invent coverage.
 */

export interface CopilotTarget {
  /** Which opportunity the advisor is asking about, if any. */
  opportunityId?: string
  opportunityTitle?: string
  /** Which coverage ring was tapped, if any. */
  coverageKey?: string
  coverageLabel?: string
  /**
   * Fire this the moment the panel opens.
   *
   * Set it when the control the advisor tapped names the answer it will give
   * ("Explain this to the customer"), so a promised action isn't really a menu.
   */
  autoIntent?: CopilotIntent
  /** Bumped on every open, so tapping the same control twice asks twice. */
  nonce?: number
}

interface Turn {
  id: number
  label: string
  text: string
  source?: string
  provider?: string
  streaming: boolean
}

const INTENT_LABEL: Record<CopilotIntent, string> = {
  EXPLAIN_COVERAGE: 'Explain this coverage',
  NEXT_STEP: 'Best next step',
  TALK_TRACK: 'Generate talk track',
  OBJECTION: 'Handle objection',
  FREEFORM: 'Question',
}

function ActionButton({
  children, onClick, disabled, primary,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  primary?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`touch-target rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition active:scale-[0.98] disabled:opacity-40 ${
        primary
          ? 'bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200'
          : 'border border-[var(--border)] hover:border-neutral-900 dark:hover:border-neutral-300'
      }`}
    >
      {children}
    </button>
  )
}

/** Renders the mock/model markdown we actually emit: **bold** labels only. */
function AnswerText({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, i) => {
        if (line.trim() === '') return <div key={i} className="h-2" />
        const parts = line.split(/(\*\*[^*]+\*\*)/g)
        return (
          <p key={i} className="text-[15px] leading-relaxed">
            {parts.map((part, j) =>
              part.startsWith('**') && part.endsWith('**') ? (
                <strong key={j} className="font-bold">{part.slice(2, -2)}</strong>
              ) : (
                <span key={j}>{part}</span>
              ),
            )}
          </p>
        )
      })}
    </>
  )
}

export function CopilotPanel({
  appointmentId,
  decisions,
  target,
  open,
  onOpenChange,
}: {
  appointmentId: string
  decisions: Record<string, OpportunityDecision>
  target: CopilotTarget
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const nextId = useRef(0)

  // Cmd/Ctrl+K toggles the panel — hands stay on the tablet, or on the keys
  // at the podium.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        onOpenChange(!open)
      } else if (e.key === 'Escape' && open) {
        onOpenChange(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns])

  // A request in flight when the panel closes is abandoned, not left running.
  useEffect(() => () => abortRef.current?.abort(), [])

  const ask = useCallback(
    async (intent: CopilotIntent, extra: { objection?: string; question?: string } = {}) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      const id = nextId.current++
      const label =
        intent === 'OBJECTION' && extra.objection
          ? `Objection: "${extra.objection}"`
          : intent === 'FREEFORM' && extra.question
            ? extra.question
            : target.opportunityTitle && (intent === 'TALK_TRACK' || intent === 'OBJECTION')
              ? `${INTENT_LABEL[intent]} — ${target.opportunityTitle}`
              : target.coverageLabel && intent === 'EXPLAIN_COVERAGE'
                ? `${INTENT_LABEL[intent]} — ${target.coverageLabel}`
                : INTENT_LABEL[intent]

      setTurns((prev) => [...prev, { id, label, text: '', streaming: true }])
      setBusy(true)

      try {
        const res = await fetch('/api/copilot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            appointmentId,
            intent,
            opportunityId: target.opportunityId,
            coverageKey: target.coverageKey,
            ...extra,
            decisions,
          }),
        })

        if (!res.ok || !res.body) {
          const detail = await res.text().catch(() => '')
          throw new Error(detail || `Request failed (${res.status})`)
        }

        const source = res.headers.get('X-Copilot-Source') ?? undefined
        const provider = res.headers.get('X-Copilot-Provider') ?? undefined
        setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, source, provider } : t)))

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value, { stream: true })
          setTurns((prev) =>
            prev.map((t) => (t.id === id ? { ...t, text: t.text + chunk } : t)),
          )
        }
      } catch (error) {
        if (controller.signal.aborted) return
        const message = error instanceof Error ? error.message : 'Something went wrong'
        setTurns((prev) =>
          prev.map((t) => (t.id === id ? { ...t, text: `Couldn't reach the Co-Pilot. ${message}` } : t)),
        )
      } finally {
        setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, streaming: false } : t)))
        setBusy(false)
      }
    },
    [appointmentId, decisions, target],
  )

  // Auto-fire for controls that named their own answer. Keyed on the nonce so
  // it runs once per tap rather than on every re-render.
  const firedNonce = useRef<number | null>(null)
  useEffect(() => {
    if (!open || !target.autoIntent) return
    const nonce = target.nonce ?? 0
    if (firedNonce.current === nonce) return
    firedNonce.current = nonce
    void ask(target.autoIntent)
  }, [open, target, ask])

  async function copy(turn: Turn) {
    // Strip the bold markers — the advisor is pasting into a text message or
    // an RO note, not into a markdown renderer.
    await navigator.clipboard.writeText(turn.text.replace(/\*\*/g, ''))
    setCopiedId(turn.id)
    setTimeout(() => setCopiedId(null), 1600)
  }

  if (!open) return null

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]"
        onClick={() => onOpenChange(false)}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-label="Service Co-Pilot"
        className="expand-in fixed inset-x-0 bottom-0 z-50 flex h-[85dvh] flex-col rounded-t-2xl border-t border-[var(--border)] bg-[var(--surface)] shadow-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:h-auto sm:w-[27rem] sm:rounded-none sm:border-l sm:border-t-0"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-bold">Co-Pilot</h2>
            <p className="truncate text-xs text-neutral-500">
              {target.opportunityTitle ?? target.coverageLabel ?? 'This visit'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="touch-target rounded-lg px-3 text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-white"
          >
            Close
          </button>
        </header>

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {turns.length === 0 && (
            <div className="rounded-xl bg-[var(--surface-muted)] p-4">
              <p className="text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
                I can see this customer, their vehicle, what they already own and every
                opportunity on the sheet. Ask me anything, or start with one of these.
              </p>
            </div>
          )}

          {turns.map((turn) => (
            <div key={turn.id} className="space-y-1.5">
              <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">
                {turn.label}
              </p>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3.5">
                {turn.text ? (
                  <AnswerText text={turn.text} />
                ) : (
                  <p className="text-sm text-neutral-500">Thinking…</p>
                )}
                {!turn.streaming && turn.text && (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-2.5">
                    {turn.source && (
                      <p className="text-[11px] text-neutral-500">
                        {turn.source}
                        {turn.provider === 'mock' && ' · demo provider'}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => copy(turn)}
                      className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-semibold transition hover:border-neutral-900 dark:hover:border-neutral-300"
                    >
                      {copiedId === turn.id ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-[var(--border)] px-4 py-3">
          <div className="grid grid-cols-2 gap-2">
            <ActionButton onClick={() => ask('NEXT_STEP')} disabled={busy} primary>
              Best next step
            </ActionButton>
            <ActionButton onClick={() => ask('EXPLAIN_COVERAGE')} disabled={busy}>
              Explain coverage
            </ActionButton>
            <ActionButton onClick={() => ask('TALK_TRACK')} disabled={busy}>
              Talk track
            </ActionButton>
            <ActionButton
              onClick={() => ask('OBJECTION', { objection: COMMON_OBJECTIONS[0] })}
              disabled={busy}
            >
              Handle objection
            </ActionButton>
          </div>

          <div className="mt-2.5 flex gap-1.5 overflow-x-auto pb-1">
            {COMMON_OBJECTIONS.map((o) => (
              <button
                key={o}
                type="button"
                disabled={busy}
                onClick={() => ask('OBJECTION', { objection: o })}
                className="shrink-0 rounded-full border border-[var(--border)] px-3 py-1.5 text-xs transition hover:border-neutral-900 disabled:opacity-40 dark:hover:border-neutral-300"
              >
                “{o}”
              </button>
            ))}
          </div>

          <form
            className="mt-2.5 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const q = question.trim()
              if (!q || busy) return
              setQuestion('')
              void ask('FREEFORM', { question: q })
            }}
          >
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              maxLength={500}
              placeholder="Ask about this visit…"
              className="min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm outline-none focus:border-neutral-900 dark:focus:border-neutral-300"
            />
            <button
              type="submit"
              disabled={busy || !question.trim()}
              className="touch-target rounded-xl bg-neutral-900 px-4 text-sm font-bold text-white disabled:opacity-40 dark:bg-white dark:text-neutral-900"
            >
              Ask
            </button>
          </form>
        </div>
      </aside>
    </>
  )
}

/** Floating launcher. Lives above the sticky action bar, thumb-reachable. */
export function CopilotLauncher({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open Co-Pilot"
      className="fixed bottom-20 right-4 z-30 flex h-14 items-center gap-2 rounded-full bg-neutral-900 px-5 text-sm font-bold text-white shadow-lg transition active:scale-95 hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
    >
      <span aria-hidden>✦</span>
      Co-Pilot
      <kbd className="hidden rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-medium sm:inline dark:bg-black/10">
        ⌘K
      </kbd>
    </button>
  )
}
