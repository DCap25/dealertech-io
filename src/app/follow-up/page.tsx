import Link from 'next/link'
import { WorkspaceNav } from '@/components/auth/workspace-nav'
import { Card } from '@/components/ui/primitives'
import { loadWorklist } from '@/lib/cadence/worklist'
import { getDefaultStore } from '@/lib/prep-sheet/load'
import {
  filterItems, groupByUrgency, ownerFrom, summarize, triggerMeta,
  type FollowUpItem, type FollowUpOwner,
} from '@/lib/follow-up/view'
import type { CadenceTrigger } from '@/lib/cadence'
import { requireUser } from '@/lib/auth/session'
import { FollowUpCard } from './follow-up-card'
import { demoDayEnd } from '@/lib/demo-day'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Follow-ups' }

/** The seeded dealership lives on a fixed date so the demo is stable. */
const ASOF = () => demoDayEnd()
/** A day's worklist plus the next few days, so nothing arrives as a surprise. */
const LOOKAHEAD_DAYS = 3

function money(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

/**
 * Tabs depend on who is looking.
 *
 * An advisor's "mine" is the advisor queue; a BDC rep's "mine" is the BDC
 * queue. Showing everyone the same three tabs was fine when nobody was
 * identified — now that they are, the first tab should be their own work.
 */
function ownerTabsFor(role: string): { key: FollowUpOwner | 'ALL'; label: string }[] {
  const mine: FollowUpOwner = role === 'BDC' ? 'BDC' : 'ADVISOR'
  const other: FollowUpOwner = mine === 'BDC' ? 'ADVISOR' : 'BDC'
  return [
    { key: mine, label: 'My follow-ups' },
    { key: other, label: other === 'BDC' ? 'BDC' : 'Advisors' },
    { key: 'ALL', label: 'Everything' },
  ]
}

function Chip({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className={`touch-target inline-flex items-center rounded-full border px-3.5 py-2 text-xs font-semibold transition ${
        active
          ? 'border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900'
          : 'border-[var(--border)] hover:border-neutral-900 dark:hover:border-neutral-300'
      }`}
    >
      {children}
    </Link>
  )
}

export default async function FollowUpPage({
  searchParams,
}: {
  searchParams: Promise<{ owner?: string; trigger?: string; focus?: string }>
}) {
  const params = await searchParams
  const user = await requireUser()
  const ownerTabs = ownerTabsFor(user.role)
  const store = await getDefaultStore()

  if (!store) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="text-xl font-bold">No store found</h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">
          Run <code className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">npm run db:seed</code>,
          then <code className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">npm run cadence:run</code>.
        </p>
      </main>
    )
  }

  // Default to their own queue rather than the whole store.
  const owner = (ownerTabs.find((t) => t.key === params.owner)?.key ??
    ownerTabs[0]!.key) as FollowUpOwner | 'ALL'
  const trigger = params.trigger
  const highValueOnly = params.focus === 'money'

  const worklist = await loadWorklist(store.id, ASOF(), undefined, LOOKAHEAD_DAYS)

  /**
   * The cadence engine ranked these; we only attach the owner it already
   * recorded on the rule and hand the list to the presentation layer.
   */
  const items: FollowUpItem[] = worklist.items.map((i) => ({
    ...i,
    owner: ownerFrom(i.assignToRole),
    smsConsent: i.smsConsent,
  }))

  const all = summarize(items, ASOF())
  const visible = filterItems(items, { owner, trigger, highValueOnly })
  const sections = groupByUrgency(visible, ASOF())
  const shown = summarize(visible, ASOF())

  const queryFor = (patch: Record<string, string | undefined>) => {
    const q = new URLSearchParams()
    const merged = { owner: params.owner, trigger: params.trigger, focus: params.focus, ...patch }
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v)
    const s = q.toString()
    return s ? `/follow-up?${s}` : '/follow-up'
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-5 sm:px-6 sm:py-8">
      <header className="border-b border-[var(--border)] pb-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-neutral-500">
              {store.name} · {user.name}
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Follow-ups</h1>
          </div>
          <WorkspaceNav current="follow-up" />
        </div>
        <p className="mt-1 text-neutral-600 dark:text-neutral-400">
          Money that leaks after the visit. Work top to bottom — it is already ranked.
        </p>
      </header>

      <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-neutral-500">Calls waiting</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{shown.count}</p>
        </Card>
        <Card className="px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-neutral-500">Overdue</p>
          <p
            className={`mt-1 text-2xl font-bold tabular-nums ${
              shown.overdueCount > 0 ? 'text-rose-700 dark:text-rose-400' : ''
            }`}
          >
            {shown.overdueCount}
          </p>
        </Card>
        <Card className="px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-neutral-500">On the table</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{money(shown.value)}</p>
        </Card>
        <Card className="px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-neutral-500">High value</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{shown.highValueCount}</p>
        </Card>
      </section>

      {/* Owner first — a rep should land on their own list, not the store's. */}
      <div className="mt-5 flex flex-wrap gap-2">
        {ownerTabs.map((tab) => {
          const count =
            tab.key === 'ALL'
              ? all.count
              : (all.byOwner.find((o) => o.owner === tab.key)?.count ?? 0)
          return (
            <Chip key={tab.key} href={queryFor({ owner: tab.key })} active={owner === tab.key}>
              {tab.label} <span className="ml-1.5 opacity-60">{count}</span>
            </Chip>
          )
        })}
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        <Chip href={queryFor({ focus: highValueOnly ? undefined : 'money' })} active={highValueOnly}>
          Money leaks only
        </Chip>
        <Chip href={queryFor({ trigger: undefined })} active={!trigger}>
          All types
        </Chip>
        {all.byTrigger.map((t) => (
          <Chip
            key={t.trigger}
            href={queryFor({ trigger: t.trigger })}
            active={trigger === t.trigger}
          >
            {t.label} <span className="ml-1.5 opacity-60">{t.count}</span>
            {t.value > 0 && <span className="ml-1 opacity-60">· {money(t.value)}</span>}
          </Chip>
        ))}
      </div>

      {sections.length === 0 ? (
        <Card className="mt-5 p-10 text-center">
          <p className="text-lg font-bold">
            {all.count === 0 ? 'Nothing to chase today.' : 'Nothing in this filter.'}
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-neutral-500">
            {all.count === 0
              ? 'Every follow-up the cadence engine generated has been worked or snoozed. New ones appear as visits close, quotes go stale, and coverage runs down.'
              : 'Widen the filter, or take the whole list.'}
          </p>
          {all.count > 0 && (
            <Link
              href="/follow-up"
              className="touch-target mt-4 inline-block rounded-xl bg-neutral-900 px-4 py-2.5 text-sm font-bold text-white dark:bg-white dark:text-neutral-900"
            >
              Show everything
            </Link>
          )}
        </Card>
      ) : (
        <div className="mt-5 space-y-6">
          {sections.map((section) => (
            <section key={section.urgency}>
              <div className="flex items-baseline justify-between gap-3">
                <h2
                  className={`text-xs font-bold uppercase tracking-[0.15em] ${
                    section.urgency === 'OVERDUE'
                      ? 'text-rose-700 dark:text-rose-400'
                      : 'text-neutral-500'
                  }`}
                >
                  {section.label}
                </h2>
                <p className="text-xs text-neutral-500">{section.items.length}</p>
              </div>
              <ul className="mt-2 space-y-3">
                {section.items.map((item) => (
                  <FollowUpCard
                    key={item.id}
                    item={item}
                    storeName={store.name}
                    asOf={ASOF().toISOString()}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <p className="mt-8 text-xs leading-relaxed text-neutral-500">
        Outcomes are logged here so the cadence engine stops chasing what is already handled. Your
        DMS notes stay in your DMS — we do not try to own the customer record.
      </p>
    </main>
  )
}
