'use client'

import { useId, useState } from 'react'

/**
 * What the declined-work pool is worth at your store.
 *
 * Deliberately not an ROI calculator. It does not know what share of declined
 * work DealerTech recovers, and neither does anyone else until a store has run
 * it for a quarter — so it refuses to multiply by a capture rate we made up.
 * It does the one piece of arithmetic a manager cannot easily do themselves
 * (nobody's DMS reports on declined work in aggregate) and then stops, and
 * says on screen that it stopped.
 *
 * A number a dealer can check against their own DMS is worth more than a
 * bigger number they have to take on faith.
 */

const MONTHS_PER_YEAR = 12

function money(n: number): string {
  return `$${Math.round(n).toLocaleString()}`
}

function Field({
  label,
  hint,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string
  hint: string
  value: number
  min: number
  max: number
  step: number
  onChange: (n: number) => void
  format: (n: number) => string
}) {
  const id = useId()
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-semibold">
          {label}
        </label>
        <span className="font-mono text-sm tabular-nums text-[var(--ink)]">{format(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 h-2 w-full cursor-pointer appearance-none rounded-full bg-[var(--rule)] accent-[var(--signal)]"
      />
      <p className="mt-1.5 text-xs text-[var(--ink-soft)]">{hint}</p>
    </div>
  )
}

export function LeakCalculator() {
  const [rosPerMonth, setRosPerMonth] = useState(600)
  const [declineRate, setDeclineRate] = useState(35)
  const [averageDecline, setAverageDecline] = useState(420)

  const declinedPerMonth = rosPerMonth * (declineRate / 100)
  const monthlyPool = declinedPerMonth * averageDecline
  const yearlyPool = monthlyPool * MONTHS_PER_YEAR
  const onePoint = yearlyPool * 0.01

  return (
    <div className="rounded-2xl border border-[var(--rule)] bg-[var(--paper)] p-5 sm:p-6">
      <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:gap-8">
        <div className="space-y-5">
          <Field
            label="Repair orders a month"
            hint="Closed customer-pay and warranty ROs across the department."
            value={rosPerMonth}
            min={100}
            max={2000}
            step={50}
            onChange={setRosPerMonth}
            format={(n) => n.toLocaleString()}
          />
          <Field
            label="Share with something declined"
            hint="Industry conversations put this between a quarter and a half. Use your own if you know it."
            value={declineRate}
            min={10}
            max={60}
            step={1}
            onChange={setDeclineRate}
            format={(n) => `${n}%`}
          />
          <Field
            label="Average declined ticket"
            hint="One brake job, one set of tires, one fluid service."
            value={averageDecline}
            min={150}
            max={1500}
            step={10}
            onChange={setAverageDecline}
            format={money}
          />

          {/* Fills what was dead space on wide screens, and says the one thing
              a sceptical manager is already thinking. */}
          <p className="border-t border-[var(--rule)] pt-4 text-xs leading-relaxed text-[var(--ink-soft)]">
            Every figure here is one you can check. If your DMS can export declined lines, bring
            the file to a walkthrough and we will run your real numbers instead of these.
          </p>
        </div>

        <div className="flex flex-col justify-center rounded-2xl bg-[var(--paper-tint)] p-5 lg:w-72">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--ink-soft)]">
            Quoted and walked, per year
          </p>
          <p className="mt-1 text-4xl font-bold tabular-nums text-[var(--signal)] sm:text-5xl">
            {money(yearlyPool)}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-[var(--ink-soft)]">
            {money(monthlyPool)} a month, from about{' '}
            {Math.round(declinedPerMonth).toLocaleString()} declined jobs your techs already
            measured and your advisors already priced.
          </p>

          <hr className="my-4 border-[var(--rule)]" />

          <p className="text-sm leading-relaxed text-[var(--ink-soft)]">
            We are not going to tell you what share of that we recover — nobody honestly can before
            you have run a quarter. What we can tell you is that{' '}
            <strong className="text-[var(--ink)]">one point of it is {money(onePoint)} a year</strong>
            , and that today none of it is on a list anyone works.
          </p>
        </div>
      </div>
    </div>
  )
}
