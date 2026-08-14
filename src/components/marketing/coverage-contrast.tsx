import { ProgressRing } from '@/components/ui/primitives'

/**
 * The two-Hyundai contrast, drawn rather than described.
 *
 * Rendered with the same ProgressRing the prep sheet uses, so what a visitor
 * sees here is literally the component an advisor will see on the drive —
 * screenshots go stale the first time someone changes a colour, and a
 * marketing page showing a version of the product that no longer exists is
 * worse than showing nothing.
 *
 * The figures are an illustration and the page says so. They are not pulled
 * from the demo dealership: a marketing page that quietly rendered live data
 * would change under a visitor mid-scroll.
 */

interface Term {
  label: string
  months: number
}

/**
 * Both cards measure every term against the same denominator — the full
 * advertised length, not each car's own entitlement.
 *
 * Drawn as a share of what each car actually has, every ring on the page came
 * out green and the entire point of the comparison disappeared: the second
 * owner's 31 months looked exactly as healthy as the first owner's 105. What a
 * used-car buyer is comparing against is the number on the billboard, so that
 * is the circle.
 */
const FULL_TERM: Record<string, number> = {
  Basic: 60,
  Powertrain: 120,
  Emissions: 96,
}

function TermRing({ term }: { term: Term }) {
  const full = FULL_TERM[term.label] ?? 120
  const percent = Math.round((term.months / full) * 100)
  const tone =
    term.months === 0 ? 'EXPIRED' : percent < 30 ? 'CRITICAL' : percent < 55 ? 'WARNING' : 'GOOD'

  return (
    <div className="flex flex-col items-center gap-2">
      <ProgressRing percent={percent} tone={tone} size={78} stroke={7} animate={false}>
        <span className="text-lg font-bold tabular-nums">{term.months}</span>
        <span className="mt-0.5 text-[10px] uppercase tracking-wide opacity-60">mo</span>
      </ProgressRing>
      <div className="text-center">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-soft)]">
          {term.label}
        </p>
        <p className="text-[10px] tabular-nums text-[var(--ink-soft)] opacity-70">of {full}</p>
      </div>
    </div>
  )
}

function VehicleCard({
  heading,
  ownership,
  terms,
  verdict,
  verdictTone,
}: {
  heading: string
  ownership: string
  terms: Term[]
  verdict: string
  verdictTone: 'good' | 'bad'
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-[var(--rule)] bg-[var(--paper)] p-5">
      <p className="text-sm font-bold">{heading}</p>
      <p className="mt-0.5 text-xs text-[var(--ink-soft)]">{ownership}</p>

      <div className="mt-5 flex justify-around gap-2">
        {terms.map((t) => (
          <TermRing key={t.label} term={t} />
        ))}
      </div>

      <p
        className={`mt-5 rounded-xl px-3.5 py-2.5 text-sm font-semibold ${
          verdictTone === 'good'
            ? 'bg-[var(--signal-soft)] text-[var(--signal)]'
            : 'bg-[var(--danger-soft)] text-[var(--danger)]'
        }`}
      >
        {verdict}
      </p>
    </div>
  )
}

export function CoverageContrast() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <VehicleCard
        heading="2024 Santa Fe · 22,091 mi"
        ownership="Bought here new. Original owner."
        terms={[
          { label: 'Basic', months: 31 },
          { label: 'Powertrain', months: 105 },
          { label: 'Emissions', months: 67 },
        ]}
        verdict="Transmission repair — factory warranty pays."
        verdictTone="good"
      />
      <VehicleCard
        heading="2024 Santa Fe · 22,091 mi"
        ownership="Same year, same mileage. Bought used elsewhere."
        terms={[
          { label: 'Basic', months: 31 },
          { label: 'Powertrain', months: 31 },
          { label: 'Emissions', months: 67 },
        ]}
        verdict="Same repair — customer pay, or the store eats it."
        verdictTone="bad"
      />
    </div>
  )
}
