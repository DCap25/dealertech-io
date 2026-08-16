import Link from 'next/link'
import { requirePlatformAdmin } from '@/lib/auth/session'
import { loadTenants } from '@/lib/platform/load'
import { LifecycleBadge, ago } from '../ui'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Tenants' }

/**
 * The wall clock, hoisted out of the component.
 *
 * Reading a clock is a request-scoped input like the session or the headers,
 * not part of rendering — same shape as `nowMs` on the operations page, and
 * the linter enforces it.
 */
const nowMs = () => Date.now()

/**
 * Every dealership, by commercial standing.
 *
 * Grouped rather than sorted alphabetically, because the question this page
 * answers first is "who needs something from me today" — and a past-due
 * dealer group buried between two healthy ones is a page nobody scans.
 */
export default async function TenantsPage() {
  await requirePlatformAdmin()
  const tenants = await loadTenants()
  const now = nowMs()

  /*
    One row per rooftop collapses to one per group.

    Billing is an organization-level thing — a group signs one contract — so a
    forty-rooftop group listing forty identical PAST_DUE rows would bury every
    other tenant on the page.
  */
  const byOrg = new Map<string, { name: string; tenants: typeof tenants }>()
  for (const t of tenants) {
    const entry = byOrg.get(t.organizationId) ?? { name: t.organizationName, tenants: [] }
    entry.tenants.push(t)
    byOrg.set(t.organizationId, entry)
  }

  const groups = [...byOrg.entries()].map(([organizationId, { name, tenants: stores }]) => ({
    organizationId,
    name,
    stores,
    // Every store in a group shares its organization's status, so the first is
    // representative rather than arbitrary.
    status: stores[0]!.lifecycleStatus,
    changedAt: stores[0]!.lifecycleChangedAt,
    trialEndsAt: stores[0]!.trialEndsAt,
    staffCount: stores.reduce((n, s) => n + s.staffCount, 0),
  }))

  const NEEDS_ATTENTION = ['PAST_DUE', 'RESTRICTED', 'SUSPENDED', 'EXPIRED']
  const attention = groups.filter((g) => NEEDS_ATTENTION.includes(g.status))
  const healthy = groups.filter((g) => !NEEDS_ATTENTION.includes(g.status))

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <Link href="/admin" className="text-sm text-neutral-500 hover:underline">
        ← Operations
      </Link>

      <h1 className="mt-3 text-3xl font-bold tracking-tight">Dealerships</h1>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        {groups.length} dealer group{groups.length === 1 ? '' : 's'} ·{' '}
        {tenants.length} rooftop{tenants.length === 1 ? '' : 's'}
      </p>

      {attention.length > 0 && (
        <Section title={`Needs attention (${attention.length})`}>
          {attention.map((g) => (
            <GroupRow key={g.organizationId} group={g} now={now} />
          ))}
        </Section>
      )}

      <Section title={`Healthy (${healthy.length})`}>
        {healthy.length === 0 ? (
          <p className="p-4 text-sm text-neutral-500">Nothing here yet.</p>
        ) : (
          healthy.map((g) => <GroupRow key={g.organizationId} group={g} now={now} />)
        )}
      </Section>
    </main>
  )
}

interface Group {
  organizationId: string
  name: string
  stores: { storeName: string; lastSyncAt: Date | null }[]
  status: string
  changedAt: Date
  trialEndsAt: Date | null
  staffCount: number
}

function GroupRow({ group, now }: { group: Group; now: number }) {
  return (
    <Link
      href={`/admin/tenants/${group.organizationId}`}
      className="flex flex-wrap items-center justify-between gap-3 p-3 hover:bg-neutral-50 dark:hover:bg-neutral-900"
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold">{group.name}</p>
        <p className="text-xs text-neutral-500">
          {group.stores.length} rooftop{group.stores.length === 1 ? '' : 's'} ·{' '}
          {group.staffCount} staff · {group.stores.map((s) => s.storeName).slice(0, 3).join(', ')}
          {group.stores.length > 3 ? '…' : ''}
        </p>
      </div>
      <div className="flex items-center gap-3 text-xs text-neutral-500">
        {group.status === 'TRIAL' && group.trialEndsAt && (
          <span>trial ends {group.trialEndsAt.toISOString().slice(0, 10)}</span>
        )}
        <span>{ago(group.changedAt, now)}</span>
        <LifecycleBadge status={group.status} />
      </div>
    </Link>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-bold uppercase tracking-widest text-neutral-500">{title}</h2>
      <div className="mt-2 divide-y divide-neutral-100 rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
        {children}
      </div>
    </section>
  )
}
