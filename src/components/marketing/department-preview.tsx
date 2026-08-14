/**
 * What a service manager opens in the morning.
 *
 * A still of the real board's layout, with illustrative figures. The advisor
 * columns stop at results on purpose — that is the actual product rule, not a
 * simplification for the marketing page, and it is worth a manager knowing
 * before they buy that their advisors' coaching numbers stay private.
 */

const ADVISORS = [
  { name: 'Dana Whitfield', today: 7, ros: 7, sold: 4769, covered: 3035, perRo: 681 },
  { name: 'Marcus Reyes', today: 7, ros: 5, sold: 3526, covered: 2299, perRo: 705 },
  { name: 'Alicia Nguyen', today: 6, ros: 6, sold: 2914, covered: 604, perRo: 486 },
]

function money(n: number): string {
  return `$${n.toLocaleString()}`
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-[var(--rule)] bg-[var(--paper)] px-3.5 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-soft)]">
        {label}
      </p>
      <p
        className={`mt-1 text-xl font-bold tabular-nums sm:text-2xl ${
          accent ? 'text-[var(--signal)]' : ''
        }`}
      >
        {value}
      </p>
    </div>
  )
}

export function DepartmentPreview() {
  return (
    <div className="rounded-2xl border border-[var(--rule)] bg-[var(--paper-tint)] p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--ink-soft)]">
          The department · this week
        </p>
        <p className="text-xs text-[var(--ink-soft)]">Illustrative figures</p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Stat label="Sold" value="$11,209" />
        <Stat label="Covered revenue" value="$5,938" accent />
        <Stat label="Effective labor rate" value="$191/hr" />
        <Stat label="No advisor assigned" value="0" />
      </div>

      <div className="mt-3 overflow-x-auto rounded-xl border border-[var(--rule)] bg-[var(--paper)]">
        <table className="w-full min-w-[440px] text-sm">
          <thead>
            <tr className="border-b border-[var(--rule)] text-[10px] uppercase tracking-wide text-[var(--ink-soft)]">
              <th className="px-3.5 py-2 text-left font-semibold">Advisor</th>
              <th className="px-3.5 py-2 text-right font-semibold">Today</th>
              <th className="px-3.5 py-2 text-right font-semibold">ROs</th>
              <th className="px-3.5 py-2 text-right font-semibold">Sold</th>
              <th className="px-3.5 py-2 text-right font-semibold">Covered</th>
              <th className="px-3.5 py-2 text-right font-semibold">Per RO</th>
            </tr>
          </thead>
          <tbody>
            {ADVISORS.map((a) => (
              <tr key={a.name} className="border-b border-[var(--rule)] last:border-b-0">
                <td className="whitespace-nowrap px-3.5 py-2.5 font-semibold">{a.name}</td>
                <td className="px-3.5 py-2.5 text-right tabular-nums">{a.today}</td>
                <td className="px-3.5 py-2.5 text-right tabular-nums">{a.ros}</td>
                <td className="px-3.5 py-2.5 text-right tabular-nums">{money(a.sold)}</td>
                <td className="px-3.5 py-2.5 text-right tabular-nums text-[var(--signal)]">
                  {money(a.covered)}
                </td>
                <td className="px-3.5 py-2.5 text-right tabular-nums">{money(a.perRo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2.5 text-xs leading-relaxed text-[var(--ink-soft)]">
        Results only — the same facts as your DMS report, in one place and a day earlier. Each
        advisor&rsquo;s capture rate and streaks stay on their own scorecard, because the moment
        they are being marked on them they stop recording honest ones.
      </p>
    </div>
  )
}
