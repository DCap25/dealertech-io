'use client'

import { useActionState, useState, useTransition } from 'react'
import { runDemoAction, type DemoState } from './actions'
import { SCENARIO_KEYS, SCENARIO_LABELS, type ScenarioKey } from './scenarios'
import { ResultView } from './result-view'

interface Preset {
  label: string
  vin: string
  concern: string
  inServiceDate: string
  currentMileage: string
  state: string
  laborAmount: string
  partsAmount: string
  scenario: ScenarioKey
}

/** Real VINs that exercise different branches of the waterfall. */
const EXAMPLES: Preset[] = [
  {
    label: 'Tesla · HV battery · California',
    vin: '5YJ3E1EA7KF317806',
    concern: 'hybrid battery reduced range',
    inServiceDate: '2019-06-15',
    currentMileage: '120000',
    state: 'CA',
    laborAmount: '800',
    partsAmount: '13000',
    scenario: 'NONE',
  },
  {
    label: 'F-150 · A/C compressor · exclusionary VSC',
    vin: '1FTFW1ET9DFC10312',
    concern: 'a/c compressor not cooling',
    inServiceDate: '2013-06-15',
    currentMileage: '78000',
    state: 'TX',
    laborAmount: '800',
    partsAmount: '1400',
    scenario: 'VSC_EXCLUSIONARY',
  },
  {
    label: 'F-150 · brake pads · wear item',
    vin: '1FTFW1ET9DFC10312',
    concern: 'grinding noise when I brake',
    inServiceDate: '2022-03-01',
    currentMileage: '31000',
    state: 'TX',
    laborAmount: '260',
    partsAmount: '340',
    scenario: 'VSC_EXCLUSIONARY',
  },
  {
    label: 'F-150 · oil change · prepaid plan',
    vin: '1FTFW1ET9DFC10312',
    concern: 'oil and filter change',
    inServiceDate: '2023-04-01',
    currentMileage: '22000',
    state: 'TX',
    laborAmount: '30',
    partsAmount: '60',
    scenario: 'PPM',
  },
]

const INITIAL_STATE: DemoState = {}
const DEFAULT_FORM: Preset = EXAMPLES[0]!

const field =
  'w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-300'
const label = 'block text-xs font-semibold uppercase tracking-wide text-neutral-500'

export function DemoForm() {
  const [state, formAction] = useActionState(runDemoAction, INITIAL_STATE)
  const [isPending, startTransition] = useTransition()

  // Every field is controlled React state, and we build the FormData ourselves
  // rather than letting the <form> submit its own DOM.
  //
  // React 19 automatically resets a form after an action completes. For a
  // controlled <select> whose value prop is unchanged between renders, React
  // sees no diff and never restores the DOM — so the dropdown silently showed
  // "No products on file" while state still held the real choice. On a demo
  // that means the screen disagrees with what the next run submits.
  const [form, setForm] = useState<Preset>(DEFAULT_FORM)
  const [isOriginalOwner, setIsOriginalOwner] = useState(true)

  const set = <K extends keyof Preset>(key: K, value: Preset[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData()
    data.set('vin', form.vin)
    data.set('concern', form.concern)
    data.set('inServiceDate', form.inServiceDate)
    data.set('currentMileage', form.currentMileage)
    data.set('state', form.state)
    data.set('laborAmount', form.laborAmount)
    data.set('partsAmount', form.partsAmount)
    data.set('scenario', form.scenario)
    if (isOriginalOwner) data.set('isOriginalOwner', 'on')
    startTransition(() => formAction(data))
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[23rem_1fr]">
      <div>
        <div className="mb-4 flex flex-wrap gap-2">
          {EXAMPLES.map((example) => (
            <button
              key={example.label}
              type="button"
              onClick={() => setForm(example)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                form.label === example.label
                  ? 'border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900'
                  : 'border-neutral-300 text-neutral-700 hover:border-neutral-900 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800'
              }`}
            >
              {example.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-neutral-200 p-5 dark:border-neutral-800">
          <div>
            <label className={label} htmlFor="vin">VIN</label>
            <input id="vin" name="vin" required maxLength={17} className={`${field} font-mono`}
              value={form.vin} onChange={(e) => set('vin', e.target.value)} />
          </div>

          <div>
            <label className={label} htmlFor="concern">Concern or operation</label>
            <input id="concern" name="concern" required className={field}
              value={form.concern} onChange={(e) => set('concern', e.target.value)} />
            <p className="mt-1 text-xs text-neutral-500">
              Plain language, an op code, or a trouble code — all work.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label} htmlFor="inServiceDate">In-service date</label>
              <input id="inServiceDate" name="inServiceDate" type="date" className={field}
                value={form.inServiceDate} onChange={(e) => set('inServiceDate', e.target.value)} />
            </div>
            <div>
              <label className={label} htmlFor="currentMileage">Odometer</label>
              <input id="currentMileage" name="currentMileage" type="number" min="0" className={field}
                value={form.currentMileage} onChange={(e) => set('currentMileage', e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={label} htmlFor="state">State</label>
              <input id="state" name="state" maxLength={2} className={`${field} uppercase`}
                value={form.state} onChange={(e) => set('state', e.target.value.toUpperCase())} />
            </div>
            <div>
              <label className={label} htmlFor="laborAmount">Labor $</label>
              <input id="laborAmount" name="laborAmount" type="number" min="0" className={field}
                value={form.laborAmount} onChange={(e) => set('laborAmount', e.target.value)} />
            </div>
            <div>
              <label className={label} htmlFor="partsAmount">Parts $</label>
              <input id="partsAmount" name="partsAmount" type="number" min="0" className={field}
                value={form.partsAmount} onChange={(e) => set('partsAmount', e.target.value)} />
            </div>
          </div>

          <div>
            <label className={label} htmlFor="scenario">Products on file</label>
            <select id="scenario" name="scenario" className={field}
              value={form.scenario} onChange={(e) => set('scenario', e.target.value as ScenarioKey)}>
              {SCENARIO_KEYS.map((key) => (
                <option key={key} value={key}>{SCENARIO_LABELS[key]}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-neutral-500">
              Change this and re-run — the payer flips without touching anything else.
            </p>
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="isOriginalOwner" className="h-4 w-4 rounded border-neutral-300"
                checked={isOriginalOwner} onChange={(e) => setIsOriginalOwner(e.target.checked)} />
              <span>Original owner</span>
            </label>
            <p className="mt-1 text-xs text-neutral-500">
              Decisive on Hyundai, Kia, Genesis and Mitsubishi — the headline 10yr/100k
              powertrain is original-owner only.
            </p>
          </div>

          <button
            type="submit"
            disabled={isPending}
            className="w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            {isPending ? 'Decoding VIN and checking coverage…' : 'Who pays?'}
          </button>
        </form>
      </div>

      <div>
        {state.error && (
          <div className="mb-4 rounded-lg border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-100">
            {state.error}
          </div>
        )}
        {state.result ? (
          <ResultView result={state.result} />
        ) : (
          !state.error && (
            <div className="rounded-xl border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500 dark:border-neutral-700">
              <p className="font-medium">Pick an example, or enter any VIN.</p>
              <p className="mt-2">Decoded live against NHTSA. Nothing is stored.</p>
            </div>
          )
        )}
      </div>
    </div>
  )
}
