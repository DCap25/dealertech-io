/**
 * The one screen the whole product is for, shrunk to fit beside a headline.
 *
 * Same visual grammar as the real prep sheet — payer badge, urgency, the
 * running total — because the hero's job is to answer "what am I actually
 * buying" before anyone reads a word of copy.
 */

const OPPORTUNITIES = [
  {
    urgency: 'SAFETY',
    title: 'Front brakes at 3mm',
    detail: 'Measured last visit at 5mm. 9,400 miles since.',
    payer: 'Customer pay',
    amount: '$618',
    covered: false,
  },
  {
    urgency: 'HIGH',
    title: 'Transmission fluid service',
    detail: 'Due at 60k. Projected 61,200 on arrival.',
    payer: 'Prepaid plan',
    amount: '$0',
    covered: true,
  },
  {
    urgency: 'HIGH',
    title: 'A/C compressor diagnosis',
    detail: 'Their stated concern. Inside the service contract.',
    payer: 'VSC · $100 deductible',
    amount: '$100',
    covered: true,
  },
]

const URGENCY_STYLE: Record<string, string> = {
  SAFETY: 'bg-rose-600 text-white',
  HIGH: 'bg-amber-500 text-amber-950',
}

export function PrepSheetPreview() {
  return (
    <div className="rounded-2xl border border-[var(--rule)] bg-[var(--paper)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-12px_rgba(0,0,0,0.18)] sm:p-5">
      <div className="flex items-baseline justify-between gap-3 border-b border-[var(--rule)] pb-3">
        <div className="min-w-0">
          <p className="truncate text-base font-bold">Maria Perez</p>
          <p className="truncate text-xs text-[var(--ink-soft)]">
            2021 Tucson · 51,140 mi · 8:30 AM
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-lg font-bold tabular-nums">$718</p>
          <p className="text-[10px] uppercase tracking-wide text-[var(--ink-soft)]">on the table</p>
        </div>
      </div>

      <p className="mt-3 rounded-lg bg-[var(--paper-tint)] px-3 py-2 text-xs">
        <span className="font-semibold uppercase tracking-wide text-[var(--ink-soft)]">
          Their words:
        </span>{' '}
        A/C not blowing cold
      </p>

      <ul className="mt-3 space-y-2">
        {OPPORTUNITIES.map((o) => (
          <li
            key={o.title}
            className="rounded-xl border border-[var(--rule)] px-3.5 py-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${URGENCY_STYLE[o.urgency]}`}
                  >
                    {o.urgency}
                  </span>
                  <span className="text-sm font-bold">{o.title}</span>
                </div>
                <p className="mt-1 text-xs text-[var(--ink-soft)]">{o.detail}</p>
              </div>
              <div className="shrink-0 text-right">
                <p
                  className={`text-sm font-bold tabular-nums ${o.covered ? 'text-[var(--signal)]' : ''}`}
                >
                  {o.amount}
                </p>
              </div>
            </div>
            <p
              className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                o.covered
                  ? 'bg-[var(--signal-soft)] text-[var(--signal)]'
                  : 'bg-[var(--paper-tint)] text-[var(--ink-soft)]'
              }`}
            >
              {o.payer}
            </p>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-center text-[11px] text-[var(--ink-soft)]">
        Ranked before the customer walks up.
      </p>
    </div>
  )
}
