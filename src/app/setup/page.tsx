import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireUser } from '@/lib/auth/session'
import { canManageStaff } from '@/lib/team/roster'
import { loadProgress } from '@/lib/onboarding/load'
import type { StepState } from '@/lib/onboarding/steps'
import { WorkspaceNav } from '@/components/auth/workspace-nav'
import { AcknowledgeButton } from './acknowledge-button'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Setup' }

/**
 * How far this rooftop is from the product working properly.
 *
 * ---------------------------------------------------------------------------
 * EVERY LINE SAYS WHAT BREAKS, NOT WHAT TO DO
 * ---------------------------------------------------------------------------
 * A checklist of chores gets ignored. "Import your declined work" is a chore;
 * "until this is done most lines read no record on file and the first morning
 * is worth very little" is a reason. The consequence is the point of each row
 * and is given the same weight as the task.
 *
 * Almost nothing here is ticked by a person — it is derived from live data, so
 * a store that deletes their op codes sees that step go red again. See
 * src/lib/onboarding/steps.ts for why the two exceptions are exceptions.
 */
export default async function SetupPage() {
  const user = await requireUser()
  // Same as /team and /import: a page an advisor cannot act on should not
  // advertise itself to them.
  if (!canManageStaff(user.role)) notFound()

  const p = await loadProgress(user.storeId)
  if (!p) notFound()

  const essential = p.steps.filter((s) => s.weight === 'ESSENTIAL')
  const recommended = p.steps.filter((s) => s.weight === 'RECOMMENDED')

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <div className="flex justify-end">
        <WorkspaceNav current="setup" />
      </div>

      <h1 className="mt-3 text-3xl font-bold tracking-tight">Setting up {user.storeName}</h1>

      <div className="mt-4 rounded-2xl border border-neutral-200 p-5 dark:border-neutral-800">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <p className="text-2xl font-bold tabular-nums">
            {p.doneCount} of {p.totalCount} done
          </p>
          {p.readyForTheDrive ? (
            <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
              Ready for the drive
            </p>
          ) : (
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
              {p.outstandingEssential.length} essential step
              {p.outstandingEssential.length === 1 ? '' : 's'} left
            </p>
          )}
        </div>

        {/* A bar rather than a percentage: nobody acts on 62%. */}
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
          <div
            className={`h-full ${p.readyForTheDrive ? 'bg-emerald-600' : 'bg-neutral-900 dark:bg-white'}`}
            style={{ width: `${Math.round((p.doneCount / p.totalCount) * 100)}%` }}
          />
        </div>

        {p.daysToFirstMenu !== null && (
          <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">
            Your first menu reached a customer{' '}
            <span className="font-semibold">
              {p.daysToFirstMenu === 0 ? 'the day you signed up' : `${p.daysToFirstMenu} days after signing up`}
            </span>
            .
          </p>
        )}
      </div>

      <Section
        title="Essential"
        blurb="The product does not do its job without these."
        steps={essential}
      />
      <Section
        title="Recommended"
        blurb="Everything works without them; it works better with them."
        steps={recommended}
      />

      <p className="mt-8 text-xs text-neutral-500">
        Most of this is worked out from your data rather than ticked off, so a step
        that stops being true goes back to outstanding on its own.
      </p>
    </main>
  )
}

function Section({
  title,
  blurb,
  steps,
}: {
  title: string
  blurb: string
  steps: StepState[]
}) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-bold uppercase tracking-widest text-neutral-500">{title}</h2>
      <p className="mt-0.5 text-xs text-neutral-500">{blurb}</p>

      <ul className="mt-3 space-y-2">
        {steps.map((step) => (
          <li
            key={step.key}
            className={`rounded-xl border p-4 ${
              step.done
                ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/30'
                : 'border-neutral-200 dark:border-neutral-800'
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <span
                    aria-hidden
                    className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                      step.done ? 'bg-emerald-600' : 'bg-neutral-300 dark:bg-neutral-700'
                    }`}
                  />
                  {step.label}
                  {step.done && step.detail && (
                    <span className="font-normal text-neutral-500">· {step.detail}</span>
                  )}
                </p>
                <p className="mt-1 max-w-xl text-xs leading-relaxed text-neutral-600 dark:text-neutral-400">
                  {step.consequence}
                </p>
              </div>

              {!step.done && (
                step.evidence === 'ACKNOWLEDGED' ? (
                  <AcknowledgeButton stepKey={step.key} href={step.href} />
                ) : step.evidence === 'MEASURED' ? (
                  // Nothing to press. Telling somebody to "go and do" the
                  // thing the product exists for would read as a chore.
                  <span className="shrink-0 text-xs text-neutral-500">happens on its own</span>
                ) : (
                  <Link
                    href={step.href}
                    className="touch-target shrink-0 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-semibold hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
                  >
                    Set up
                  </Link>
                )
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
