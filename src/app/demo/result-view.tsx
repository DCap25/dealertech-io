import type { LookupResult } from '@/lib/demo/run-lookup'
import type { Payer } from '@/lib/coverage'
import type { TermStatus } from '@/lib/warranty'

const PAYER_COPY: Record<Payer, { label: string; tone: string; blurb: string }> = {
  OEM_RECALL: {
    label: 'Open Recall — OEM Pays',
    tone: 'bg-violet-50 border-violet-300 text-violet-900 dark:bg-violet-950 dark:border-violet-700 dark:text-violet-100',
    blurb: 'Manufacturer-funded campaign. No customer charge, no deductible.',
  },
  PPM: {
    label: 'Prepaid Maintenance',
    tone: 'bg-sky-50 border-sky-300 text-sky-900 dark:bg-sky-950 dark:border-sky-700 dark:text-sky-100',
    blurb: 'Redeems against the customer’s prepaid plan.',
  },
  TIRE_WHEEL: {
    label: 'Tire & Wheel Policy',
    tone: 'bg-teal-50 border-teal-300 text-teal-900 dark:bg-teal-950 dark:border-teal-700 dark:text-teal-100',
    blurb: 'Road hazard coverage applies.',
  },
  OEM_WARRANTY: {
    label: 'Factory Warranty',
    tone: 'bg-emerald-50 border-emerald-300 text-emerald-900 dark:bg-emerald-950 dark:border-emerald-700 dark:text-emerald-100',
    blurb: 'Covered by the manufacturer. Bill as warranty, not customer pay.',
  },
  VSC: {
    label: 'Service Contract',
    tone: 'bg-emerald-50 border-emerald-300 text-emerald-900 dark:bg-emerald-950 dark:border-emerald-700 dark:text-emerald-100',
    blurb: 'The customer already bought this coverage.',
  },
  GOODWILL: {
    label: 'Goodwill',
    tone: 'bg-amber-50 border-amber-300 text-amber-900 dark:bg-amber-950 dark:border-amber-700 dark:text-amber-100',
    blurb: 'Discretionary manufacturer assistance.',
  },
  CUSTOMER_PAY: {
    label: 'Customer Pay',
    tone: 'bg-amber-50 border-amber-300 text-amber-900 dark:bg-amber-950 dark:border-amber-700 dark:text-amber-100',
    blurb: 'No coverage applies. Present at menu pricing.',
  },
}

const CONFIDENCE_TONE: Record<string, string> = {
  HIGH: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100',
  MEDIUM: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100',
  LOW: 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-100',
}

function money(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function TermBar({ term }: { term: TermStatus }) {
  const monthsPct =
    term.term.months && term.monthsRemaining !== null
      ? Math.max(0, Math.min(100, (term.monthsRemaining / term.term.months) * 100))
      : term.term.months === null
        ? 100
        : 0
  const milesPct =
    term.term.miles && term.milesRemaining !== null
      ? Math.max(0, Math.min(100, (term.milesRemaining / term.term.miles) * 100))
      : term.term.miles === null
        ? 100
        : 0
  const pct = Math.min(monthsPct, milesPct)

  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{term.name}</span>
        <span className={term.active ? 'text-emerald-700 dark:text-emerald-400' : 'text-neutral-500'}>
          {term.active
            ? `${term.monthsRemaining ?? '∞'} mo · ${term.milesRemaining?.toLocaleString() ?? '∞'} mi left`
            : `expired${term.expiredBy ? ` on ${term.expiredBy.toLowerCase()}` : ''}`}
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
        <div
          className={`h-full rounded-full ${term.active ? 'bg-emerald-500' : 'bg-neutral-400 dark:bg-neutral-600'}`}
          style={{ width: `${term.active ? pct : 0}%` }}
        />
      </div>
    </div>
  )
}

export function ResultView({ result }: { result: LookupResult }) {
  const { vehicle, warranty, determination, candidateRecalls } = result
  if (!determination || !vehicle) {
    return (
      <div className="rounded-lg border border-rose-300 bg-rose-50 p-4 text-rose-900 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-100">
        <p className="font-semibold">Could not complete the lookup.</p>
        <ul className="mt-2 list-disc pl-5 text-sm">
          {result.errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      </div>
    )
  }

  const copy = PAYER_COPY[determination.payer]
  const terms = [warranty?.basic, warranty?.powertrain, warranty?.emissionsLong, warranty?.hybridEv, warranty?.corrosion]
    .filter((t): t is TermStatus => Boolean(t))

  return (
    <div className="space-y-5">
      {/* ---- Verdict ---- */}
      <section className={`rounded-xl border-2 p-5 ${copy.tone}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest opacity-70">Who pays</p>
            <h2 className="mt-1 text-2xl font-bold">{copy.label}</h2>
            <p className="mt-1 text-sm opacity-80">{copy.blurb}</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${CONFIDENCE_TONE[determination.confidence]}`}>
            {determination.confidence} confidence
          </span>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide opacity-70">Customer pays</dt>
            <dd className="text-xl font-bold tabular-nums">{money(determination.customerOutOfPocket)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide opacity-70">Covered</dt>
            <dd className="text-xl font-bold tabular-nums">{money(determination.coveredAmount)}</dd>
          </div>
          {determination.deductible > 0 && (
            <div>
              <dt className="text-xs uppercase tracking-wide opacity-70">Deductible</dt>
              <dd className="text-xl font-bold tabular-nums">
                {money(determination.deductible)}
                <span className="ml-1 text-xs font-normal opacity-70">
                  {determination.deductibleType.replace('_', ' ').toLowerCase()}
                </span>
              </dd>
            </div>
          )}
        </dl>

        <p className="mt-4 text-sm">
          <span className="opacity-70">Component:</span>{' '}
          <span className="font-semibold">{determination.componentGroup?.label ?? 'unresolved'}</span>
          {determination.warrantyTermName && (
            <>
              {' · '}
              <span className="opacity-70">via</span>{' '}
              <span className="font-semibold">{determination.warrantyTermName}</span>
            </>
          )}
        </p>
      </section>

      {/* ---- Required actions ---- */}
      {determination.requiredActions.length > 0 && (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-5 dark:border-amber-700 dark:bg-amber-950">
          <h3 className="text-sm font-bold uppercase tracking-widest text-amber-900 dark:text-amber-200">
            Do this before you quote
          </h3>
          <ul className="mt-3 space-y-2">
            {determination.requiredActions.map((action, i) => (
              <li key={i} className="flex gap-2 text-sm text-amber-950 dark:text-amber-100">
                <span aria-hidden className="mt-0.5 shrink-0 font-bold">→</span>
                <span>{action}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---- Vehicle + coverage stack ---- */}
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-xl border border-neutral-200 p-5 dark:border-neutral-800">
          <h3 className="text-sm font-bold uppercase tracking-widest text-neutral-500">Vehicle</h3>
          <p className="mt-2 text-lg font-semibold">
            {vehicle.modelYear} {vehicle.make} {vehicle.model}
          </p>
          <dl className="mt-3 space-y-1 text-sm text-neutral-600 dark:text-neutral-400">
            <div className="flex justify-between gap-4">
              <dt>VIN</dt><dd className="font-mono text-xs">{vehicle.vin}</dd>
            </div>
            {vehicle.bodyClass && (
              <div className="flex justify-between gap-4"><dt>Body</dt><dd>{vehicle.bodyClass}</dd></div>
            )}
            {vehicle.fuelTypePrimary && (
              <div className="flex justify-between gap-4"><dt>Fuel</dt><dd>{vehicle.fuelTypePrimary}</dd></div>
            )}
            {vehicle.isHybridOrEv && (
              <div className="mt-2 rounded-md bg-sky-50 px-2 py-1 text-xs font-medium text-sky-900 dark:bg-sky-950 dark:text-sky-200">
                Hybrid/EV detected from the VIN — high-voltage warranty terms applied automatically
              </div>
            )}
          </dl>
        </section>

        <section className="rounded-xl border border-neutral-200 p-5 dark:border-neutral-800">
          <h3 className="text-sm font-bold uppercase tracking-widest text-neutral-500">Coverage stack</h3>
          <div className="mt-2 divide-y divide-neutral-100 dark:divide-neutral-800">
            {terms.map((term) => <TermBar key={term.name} term={term} />)}
          </div>
          {warranty && !warranty.known && (
            <p className="mt-3 rounded-md bg-rose-50 px-2 py-1 text-xs text-rose-900 dark:bg-rose-950 dark:text-rose-200">
              No factory warranty reference data for {warranty.make}. Federal emissions terms still apply.
            </p>
          )}
        </section>
      </div>

      {/* ---- Candidate recalls ---- */}
      {candidateRecalls.length > 0 && (
        <section className="rounded-xl border border-neutral-200 p-5 dark:border-neutral-800">
          <h3 className="text-sm font-bold uppercase tracking-widest text-neutral-500">
            Candidate recalls ({candidateRecalls.length})
          </h3>
          <p className="mt-2 text-xs text-neutral-500">{result.recallCaveat}</p>
          <ul className="mt-3 space-y-2">
            {candidateRecalls.slice(0, 6).map((r) => (
              <li key={r.campaignNumber} className="text-sm">
                <span className="font-mono text-xs font-semibold">{r.campaignNumber}</span>
                {r.parkIt && (
                  <span className="ml-2 rounded bg-rose-600 px-1.5 py-0.5 text-xs font-bold text-white">DO NOT DRIVE</span>
                )}
                {r.parkOutside && (
                  <span className="ml-2 rounded bg-orange-500 px-1.5 py-0.5 text-xs font-bold text-white">PARK OUTSIDE</span>
                )}
                <span className="ml-2 text-neutral-600 dark:text-neutral-400">{r.component}</span>
              </li>
            ))}
          </ul>
          {candidateRecalls.length > 6 && (
            <p className="mt-2 text-xs text-neutral-500">+ {candidateRecalls.length - 6} more</p>
          )}
        </section>
      )}

      {/* ---- Alternatives + reasoning ---- */}
      {determination.alternatives.length > 0 && (
        <section className="rounded-xl border border-neutral-200 p-5 dark:border-neutral-800">
          <h3 className="text-sm font-bold uppercase tracking-widest text-neutral-500">Also worth raising</h3>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-neutral-700 dark:text-neutral-300">
            {determination.alternatives.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </section>
      )}

      <details className="rounded-xl border border-neutral-200 p-5 dark:border-neutral-800">
        <summary className="cursor-pointer text-sm font-bold uppercase tracking-widest text-neutral-500">
          Why — every rule evaluated ({determination.reasoning.length})
        </summary>
        <ol className="mt-4 space-y-2">
          {determination.reasoning.map((step, i) => (
            <li key={i} className="grid grid-cols-[7rem_5.5rem_1fr] items-start gap-3 text-sm">
              <span className="font-mono text-xs text-neutral-500">{step.rule}</span>
              <span
                className={`rounded px-1.5 py-0.5 text-center text-xs font-semibold ${
                  step.outcome === 'FIRED'
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100'
                    : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400'
                }`}
              >
                {step.outcome}
              </span>
              <span className="text-neutral-700 dark:text-neutral-300">{step.detail}</span>
            </li>
          ))}
        </ol>
      </details>

      <p className="rounded-lg bg-neutral-100 p-3 text-xs text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">
        {determination.disclaimer}
      </p>
    </div>
  )
}
