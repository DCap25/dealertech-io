import Link from 'next/link'
import { loadWorklist } from '@/lib/cadence/worklist'
import { getDefaultStore } from '@/lib/prep-sheet/load'
import type { CadenceTrigger } from '@/lib/cadence'
import { TaskCard } from './task-card'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'BDC Worklist',
}

const TRIGGER_LABEL: Record<string, string> = {
  DECLINED_SERVICE_FOLLOW_UP: 'Declined work',
  MAINTENANCE_DUE_MILEAGE: 'Maintenance due',
  PPM_EXPIRING: 'Prepaid expiring',
  WARRANTY_EXPIRING: 'Warranty ending',
  POST_VISIT_THANK_YOU: 'Post-visit',
  CSI_PRE_EMPTION: 'CSI check',
  DORMANT_CUSTOMER: 'Win-back',
  OPEN_RECALL: 'Open recall',
}

function money(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

export default async function BdcPage({
  searchParams,
}: {
  searchParams: Promise<{ trigger?: string }>
}) {
  const params = await searchParams
  const store = await getDefaultStore()

  if (!store) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="text-xl font-bold">No store found</h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">
          Run <code className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">npm run db:test:up</code>,{' '}
          <code className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">npm run db:seed</code>, then{' '}
          <code className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">npm run cadence:run</code>.
        </p>
      </main>
    )
  }

  // The seeded dealership lives on a fixed date so the demo is stable.
  const asOf = new Date('2026-08-12T23:59:00Z')
  const selected = params.trigger as CadenceTrigger | undefined

  const all = await loadWorklist(store.id, asOf)
  const filtered = selected
    ? { ...all, items: all.items.filter((i) => i.trigger === selected) }
    : all

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-neutral-500">
              {store.name} · BDC
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight">Follow-up worklist</h1>
          </div>
          <nav className="flex gap-3 text-sm text-neutral-500">
            <Link href="/customers" className="hover:underline">Customers</Link>
            <Link href="/drive" className="hover:underline">Today&rsquo;s drive</Link>
          </nav>
        </div>
        <p className="mt-1 text-neutral-600 dark:text-neutral-400">
          Every customer the store would otherwise have let go quiet.
        </p>
      </header>

      <section className="mb-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <p className="text-xs uppercase tracking-wide text-neutral-500">Calls waiting</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{all.totals.count}</p>
        </div>
        <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <p className="text-xs uppercase tracking-wide text-neutral-500">Revenue on the table</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{money(all.totals.value)}</p>
        </div>
      </section>

      {all.totals.byTrigger.length > 0 && (
        <nav className="mb-5 flex flex-wrap gap-2">
          <Link
            href="/bdc"
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              !selected
                ? 'border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900'
                : 'border-neutral-300 text-neutral-700 hover:border-neutral-900 dark:border-neutral-700 dark:text-neutral-300'
            }`}
          >
            All {all.totals.count}
          </Link>
          {all.totals.byTrigger.map((t) => (
            <Link
              key={t.trigger}
              href={`/bdc?trigger=${t.trigger}`}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                selected === t.trigger
                  ? 'border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900'
                  : 'border-neutral-300 text-neutral-700 hover:border-neutral-900 dark:border-neutral-700 dark:text-neutral-300'
              }`}
            >
              {TRIGGER_LABEL[t.trigger] ?? t.trigger} {t.count}
              {t.value > 0 && (
                <span className="ml-1 opacity-60">· {money(t.value)}</span>
              )}
            </Link>
          ))}
        </nav>
      )}

      {filtered.items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 p-10 text-center dark:border-neutral-700">
          <p className="font-medium">Worklist is clear.</p>
          <p className="mt-2 text-sm text-neutral-500">
            Run <code className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">npm run cadence:run</code>{' '}
            to generate today&rsquo;s follow-ups.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.items.map((item) => (
            <TaskCard key={item.id} item={item} />
          ))}
        </ul>
      )}
    </main>
  )
}
