/**
 * The screen the customer reads, shrunk to fit on a marketing page.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS AS A SEPARATE COMPONENT
 * ---------------------------------------------------------------------------
 * The real menu is `src/components/present/service-menu.tsx` — a client
 * component over a `DeviceSnapshot`, with an explainer player, tap handling
 * and a decision model behind it. None of that can be mounted on a static
 * marketing page without dragging the pairing layer along with it, and the
 * previews on this page are deliberately independent of `src/lib` so that a
 * visitor never sees a marketing page render live dealership data.
 *
 * So this is an illustration, in the idiom of prep-sheet-preview.tsx: static
 * data, no imports, no state. What it must not do is illustrate something the
 * product does not do. The three properties copied exactly from the real menu,
 * because they are the argument rather than the styling:
 *
 *   1. The covered total is the first number, before any price.
 *   2. The three answers sit in a three-column grid — same width, same height,
 *      same weight — with "Not today" first.
 *   3. The out-of-pocket number is the big one; the full price is struck
 *      through beside it, not the other way round.
 *
 * The same customer and vehicle as `PrepSheetPreview`, on purpose: the hero
 * shows what the advisor sees, this shows what the customer is handed for the
 * same visit.
 */

const ITEMS = [
  {
    tier: 'Needs attention now',
    blurb: 'Measured at or past the point the manufacturer sets.',
    accent: 'border-l-rose-500',
    title: 'Front brake pads',
    detail: 'Measured at 3mm today. Replaced at 3mm on this vehicle.',
    badge: { label: 'Safety', tone: 'SAFETY' as const },
    price: '$618',
    was: null,
    explainer: true,
    answer: null,
  },
  {
    tier: 'Coming up soon',
    blurb: 'Still serviceable. Worth planning rather than reacting to.',
    accent: 'border-l-amber-500',
    title: 'A/C compressor replacement',
    detail: 'Your stated concern. Your service contract covers this part.',
    badge: { label: 'Service contract', tone: 'COVERED' as const },
    price: '$100',
    was: '$1,240',
    explainer: false,
    answer: 'CALL_ME' as const,
  },
  {
    tier: 'Scheduled maintenance',
    blurb: 'On the maker’s schedule for your mileage.',
    accent: 'border-l-neutral-300 dark:border-l-neutral-600',
    title: 'Transmission fluid service',
    detail: 'Due at 60,000 miles. You will be at 61,200 next visit.',
    badge: { label: 'Prepaid plan', tone: 'COVERED' as const },
    price: 'No charge',
    was: '$289',
    explainer: false,
    answer: null,
  },
]

/** Verbatim from `DECISIONS` in src/lib/presentation/decisions.ts. */
const ANSWERS = [
  { code: 'DECLINED', label: 'Not today', selected: 'border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]' },
  { code: 'CALL_ME', label: 'Call me about this', selected: 'border-sky-600 bg-sky-600 text-white' },
  { code: 'ACCEPTED', label: 'Yes', selected: 'border-emerald-600 bg-emerald-600 text-white' },
] as const

export function MenuPreview() {
  return (
    <div className="rounded-2xl border border-[var(--rule)] bg-[var(--paper)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-12px_rgba(0,0,0,0.18)] sm:p-5">
      <header className="border-b border-[var(--rule)] pb-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--ink-soft)]">
          Recommended service
        </p>
        <p className="mt-1.5 text-lg font-bold tracking-tight">2021 Hyundai Tucson</p>
        <p className="text-xs text-[var(--ink-soft)]">Maria Perez · 51,140 miles</p>
      </header>

      {/* The first number the customer sees is the one they do not owe. */}
      <div className="mt-4 rounded-xl border border-[var(--signal)]/40 bg-[var(--signal-soft)] px-4 py-3">
        <p className="text-xs font-semibold text-[var(--signal)]">
          Coverage you already own pays for
        </p>
        <p className="mt-0.5 text-2xl font-bold tabular-nums text-[var(--signal)]">$1,429</p>
      </div>

      <ul className="mt-4 space-y-3">
        {ITEMS.map((item) => (
          <li
            key={item.title}
            className={`rounded-xl border border-l-4 border-[var(--rule)] p-3.5 ${item.accent}`}
          >
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--ink-soft)]">
              {item.tier}
            </p>
            <div className="mt-1 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h4 className="text-sm font-bold leading-snug">{item.title}</h4>
                <p className="mt-1 text-xs leading-relaxed text-[var(--ink-soft)]">{item.detail}</p>
                <span
                  className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    item.badge.tone === 'SAFETY'
                      ? 'bg-rose-600 text-white'
                      : 'bg-[var(--signal-soft)] text-[var(--signal)]'
                  }`}
                >
                  {item.badge.label}
                </span>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-lg font-bold tabular-nums">{item.price}</p>
                {item.was && (
                  <p className="text-xs tabular-nums text-[var(--ink-soft)] line-through">
                    {item.was}
                  </p>
                )}
              </div>
            </div>

            {item.explainer && (
              /* The animated explanation, offered before the choice, never beside it. */
              <span className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-[var(--rule)] px-2.5 py-1.5 text-[11px] font-semibold">
                <span aria-hidden>▶</span> Show me why
              </span>
            )}

            {/* Three columns, so "equal weight" is a fact rather than a claim. */}
            <div className="mt-3 grid grid-cols-3 gap-2">
              {ANSWERS.map((a) => {
                const selected = item.answer === a.code
                return (
                  <span
                    key={a.code}
                    className={`flex min-h-[38px] items-center justify-center gap-1 rounded-lg border px-1.5 py-1.5 text-center text-[11px] font-semibold leading-tight ${
                      selected ? a.selected : 'border-[var(--rule)] text-[var(--ink-soft)]'
                    }`}
                  >
                    {selected && <span aria-hidden>✓</span>}
                    {a.label}
                  </span>
                )
              })}
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-center text-[11px] text-[var(--ink-soft)]">
        Their answers are recorded as preferences. The advisor still authorises the work.
      </p>
    </div>
  )
}
