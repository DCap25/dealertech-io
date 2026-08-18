import Link from 'next/link'
import type { VisitCard } from '@/lib/timeline'

/**
 * The ninety-second version — DRIVE_PLAN D6's compressed card on the prep
 * sheet.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS A STRIP AND NOT A PANEL
 * ---------------------------------------------------------------------------
 * The prep sheet exists to put ranked opportunities in front of an advisor
 * with a customer walking towards them. Anything above that list is rent, and
 * a relationship summary that pushes the first opportunity below the fold has
 * cost more than it gave. So this is one line of three facts — last visit,
 * next visit, what is still open — sized to be read while walking, with the
 * record page one tap away for anyone who wants the history.
 *
 * ---------------------------------------------------------------------------
 * HOW IT COORDINATES WITH THE FIRST-SERVICE CUE
 * ---------------------------------------------------------------------------
 * P3's cue (emerald, above the alerts) says "this is a delivery introduction,
 * greet them differently". This says "here is the relationship". Stacking two
 * context panels above the list would be exactly the awkwardness the plan
 * warns about, and it mostly does not arise: a genuine first-service customer
 * has no last visit, no next visit and no open threads, so this renders
 * *nothing at all* and the cue stands alone. Where both do appear — the
 * existing customer who bought a second car — the cue keeps the emphasis and
 * this is a quiet line underneath it rather than a second box competing.
 */

function dayLabel(at: Date): string {
  return at.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="truncate text-sm">{children}</p>
    </div>
  )
}

export function VisitCardStrip({
  card,
  recordHref,
}: {
  card: VisitCard
  /** The customer record, where the full timeline lives. */
  recordHref: string
}) {
  const top = card.threads[0]

  // Nothing to say is a real answer, and an empty strip is worse than none:
  // it teaches the advisor that the space above the list is decoration.
  if (!card.lastVisit && !card.nextVisit && card.threads.length === 0) return null

  return (
    <div className="mt-4 flex flex-wrap items-start gap-x-8 gap-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3">
      <Fact label="Last visit">
        {card.lastVisit ? (
          <Link href={card.lastVisit.href ?? '#'} className="hover:underline">
            {dayLabel(card.lastVisit.at)}
            <span className="text-neutral-500"> · {card.lastVisit.title}</span>
          </Link>
        ) : (
          <span className="text-neutral-500">First time here</span>
        )}
      </Fact>

      <Fact label="Next visit">
        {card.nextVisit ? (
          <Link href={card.nextVisit.href ?? '#'} className="hover:underline">
            {dayLabel(card.nextVisit.at)}
          </Link>
        ) : (
          <span className="text-neutral-500">Nothing booked</span>
        )}
      </Fact>

      <Fact label={`Open threads (${card.threads.length})`}>
        {top ? (
          <Link href={recordHref} className="hover:underline">
            {/*
              The most urgent one by name, not just a count. "3 open threads"
              is a number to act on later; "they asked to be called about the
              alignment" is a sentence to say in the next thirty seconds, which
              is what this card is for.
            */}
            {top.kind === 'CALL_ME' ? 'Wants to talk — ' : ''}
            {top.title}
            {card.threads.length > 1 ? (
              <span className="text-neutral-500"> +{card.threads.length - 1} more</span>
            ) : null}
          </Link>
        ) : (
          <span className="text-neutral-500">Nothing outstanding</span>
        )}
      </Fact>
    </div>
  )
}
