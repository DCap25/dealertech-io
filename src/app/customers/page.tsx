import Link from 'next/link'
import { WorkspaceNav } from '@/components/auth/workspace-nav'
import { searchCustomers } from '@/lib/records/customer'
import { getDefaultStore } from '@/lib/prep-sheet/load'
import { formatPhone, money, monthYear } from '../records-ui'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Customers',
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q } = await searchParams
  const store = await getDefaultStore()

  if (!store) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="text-xl font-bold">No store found</h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">
          Run <code className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">npm run db:test:up</code> then{' '}
          <code className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">npm run db:seed</code>.
        </p>
      </main>
    )
  }

  const results = await searchCustomers(store.id, q ?? '')

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-neutral-500">
              {store.name}
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight">Customers</h1>
          </div>
          <WorkspaceNav current="customers" />
        </div>
      </header>

      {/* A plain GET form so a search is a shareable URL. */}
      <form action="/customers" method="get" className="mb-5">
        <input
          type="search"
          name="q"
          defaultValue={q ?? ''}
          placeholder="Name, phone, email, VIN or plate…"
          className="w-full rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-300"
        />
        <p className="mt-1 text-xs text-neutral-500">
          VIN and plate search matter at the podium — an advisor is holding a key tag, not a name.
        </p>
      </form>

      <p className="mb-3 text-sm text-neutral-500">
        {q ? `${results.length} match${results.length === 1 ? '' : 'es'} for “${q}”` : `${results.length} most recent`}
      </p>

      {results.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500 dark:border-neutral-700">
          No customers found.
        </div>
      ) : (
        <ul className="divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {results.map((c) => (
            <li key={c.id}>
              <Link
                href={`/customers/${c.id}`}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 transition hover:bg-neutral-50 dark:hover:bg-neutral-900"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{c.name}</span>
                    {c.doNotCall && (
                      <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                        Do not call
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm text-neutral-500">
                    {formatPhone(c.mobilePhone)}
                    {c.vehicleSummary ? ` · ${c.vehicleSummary}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-6 text-right text-sm">
                  {c.openDeclineValue > 0 && (
                    <div>
                      <p className="font-bold tabular-nums text-amber-700 dark:text-amber-400">
                        {money(c.openDeclineValue)}
                      </p>
                      <p className="text-[11px] text-neutral-500">declined</p>
                    </div>
                  )}
                  <div>
                    <p className="font-medium tabular-nums">{money(c.lifetimeSpend)}</p>
                    <p className="text-[11px] text-neutral-500">
                      {c.visitCount} visit{c.visitCount === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div className="w-20">
                    <p className="text-neutral-600 dark:text-neutral-400">{monthYear(c.lastVisitAt)}</p>
                    <p className="text-[11px] text-neutral-500">last in</p>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
