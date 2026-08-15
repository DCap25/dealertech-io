import { headers } from 'next/headers'
import { requirePlatformAdmin } from '@/lib/auth/session'
import { signOut } from '@/app/login/actions'
import { loadLeads, loadRecentJobRuns, loadTenants } from '@/lib/platform/load'
import { knownMakes } from '@/lib/warranty'
import { ProvisionForm } from './provision-form'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Platform' }

/**
 * The wall clock, and deliberately not `demoNow()`.
 *
 * Every dealership-facing surface runs on the frozen demo day so a screenshot
 * taken today still matches the app next month. This console does not: it
 * watches real infrastructure — when a sync actually ran, when a tenant
 * actually signed up — and staleness measured against a fixed date in the past
 * would eventually report every healthy job as overdue.
 *
 * Hoisted out of the component because reading a clock is a request-scoped
 * input like the session or the headers, not part of rendering. Same shape as
 * the `const DAY = () => demoNow()` every other page uses.
 */
const nowMs = () => Date.now()

/**
 * Every relative time on this page is measured from one instant.
 *
 * `now` is taken once when the page renders and threaded down rather than each
 * helper reading the clock for itself. Two badges rendered a millisecond apart
 * disagreeing is not a bug anybody would ever notice, but a page that reads the
 * clock in four places is one where "36 hours" quietly means four different
 * things — and it is the reason the linter objects to calling Date.now() during
 * a render at all.
 */
function ago(d: Date | null, now: number): string {
  if (!d) return 'never'
  const hours = Math.floor((now - d.getTime()) / 3_600_000)
  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/**
 * A sync older than this is not "recent", it is "not running".
 *
 * Thirty-six hours rather than twenty-four, so a job that slips by an hour and
 * a clock change in the same week do not both raise an alarm.
 */
const STALE_HOURS = 36

/**
 * Has this dealership been around long enough to have been synced?
 *
 * A store provisioned twenty minutes ago has not missed anything — the next
 * scheduled run has simply not happened yet. Flagging it red anyway is how a
 * status column stops being read: the first thing every new tenant does is
 * light up as a problem, and people learn that the colour means nothing.
 */
function awaitingFirstSync(createdAt: Date, lastSyncAt: Date | null, now: number): boolean {
  return !lastSyncAt && now - createdAt.getTime() < STALE_HOURS * 3_600_000
}

function SyncBadge({ at, status, createdAt, now }: {
  at: Date | null; status: string | null; createdAt: Date; now: number
}) {
  if (awaitingFirstSync(createdAt, at, now)) {
    return (
      <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
        awaiting first sync
      </span>
    )
  }
  const stale = !at || now - at.getTime() > STALE_HOURS * 3_600_000
  const tone = !at || stale || status !== 'OK'
    ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200'
    : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${tone}`}>
      {!at ? 'never synced' : stale ? `stale · ${ago(at, now)}` : status === 'OK' ? ago(at, now) : status}
    </span>
  )
}

export default async function AdminPage() {
  const session = await requirePlatformAdmin()
  // One instant for the whole page. See the notes on `nowMs` and `ago`.
  const now = nowMs()
  const [tenants, leads, runs] = await Promise.all([
    loadTenants(),
    loadLeads(20),
    loadRecentJobRuns(10),
  ])

  // Built server-side so the copied invitation link is right behind a proxy
  // or on a custom domain rather than whatever the browser happens to think.
  const host = (await headers()).get('host') ?? ''
  const protocol = host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https'
  const origin = `${protocol}://${host}`
  const makes = knownMakes()

  const uncontacted = leads.filter((l) => !l.contacted)
  const needAttention = tenants.filter(
    (t) => !awaitingFirstSync(t.createdAt, t.lastSyncAt, now)
      && (!t.lastSyncAt || t.lastSyncStatus !== "OK"),
  )

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-widest text-neutral-500">
          DealerTech · Platform
        </p>
        {/*
          A form, not a link.

          This was a link to /auth/sign-out, and that route does not exist — so
          the only way out of the console 404'd, and DealerTech staff had no way
          to sign out at all. UserBadge, which carries the sign-out button
          everywhere else, resolves through getCurrentUser() and returns null
          for an account with no dealership, so it was never an option here.

          Posting the action also keeps signing out off a GET, where a prefetch
          or a crawler can trip it.
        */}
        <div className="flex items-center gap-3 text-sm text-neutral-500">
          <span>{session.name}</span>
          <form action={signOut}>
            <button type="submit" className="touch-target rounded-lg px-2 py-1 hover:underline">
              Sign out
            </button>
          </form>
        </div>
      </div>

      <h1 className="mt-3 text-3xl font-bold tracking-tight">Operations</h1>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        {/*
          Said out loud on the page, not just in a migration comment. Somebody
          will eventually try to answer a support question here and needs to
          know why they cannot.
        */}
        Dealerships, signups and job health. This console deliberately cannot reach any
        dealership&rsquo;s customers — that needs a role at the store, which leaves a record.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Dealerships" value={String(tenants.length)} />
        <Stat
          label="Need attention"
          value={String(needAttention.length)}
          tone={needAttention.length > 0 ? 'bad' : 'good'}
        />
        <Stat
          label="Leads not contacted"
          value={String(uncontacted.length)}
          tone={uncontacted.length > 0 ? 'warn' : 'good'}
        />
      </div>

      <Section title={`Dealerships (${tenants.length})`}>
        {tenants.length === 0 ? (
          <Empty>Nobody has signed up yet.</Empty>
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {tenants.map((t) => (
              <li key={t.storeId} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">
                    {t.storeName}
                    {!t.isActive && (
                      <span className="ml-2 rounded bg-neutral-200 px-1.5 py-0.5 text-xs dark:bg-neutral-800">
                        inactive
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-neutral-500">
                    {[t.organizationName, t.franchiseMake ?? 'multi-brand', t.state]
                      .filter(Boolean).join(' · ')}
                  </p>
                </div>
                <div className="flex items-center gap-4 text-xs text-neutral-500">
                  <span>{t.staffCount} staff</span>
                  {t.pendingInvites > 0 && <span>{t.pendingInvites} invited</span>}
                  <SyncBadge at={t.lastSyncAt} status={t.lastSyncStatus} createdAt={t.createdAt} now={now} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Signups and demo requests (${leads.length})`}>
        {leads.length === 0 ? (
          <Empty>No inbound requests yet.</Empty>
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {leads.map((l) => (
              <li key={l.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">
                    {l.dealershipName}
                    {!l.contacted && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                        new
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-neutral-500">
                    {l.name}
                    {l.role ? ` · ${l.role}` : ''} · {l.email}
                    {l.phone ? ` · ${l.phone}` : ''}
                  </p>
                  <p className="mt-0.5 text-xs text-neutral-500">
                    {[
                      l.rooftops ? `${l.rooftops} rooftop${l.rooftops === 1 ? '' : 's'}` : null,
                      l.dms ? `DMS: ${l.dms}` : null,
                    ].filter(Boolean).join(' · ')}
                  </p>
                  {l.message && (
                    <p className="mt-1 max-w-2xl text-xs italic text-neutral-600 dark:text-neutral-400">
                      “{l.message}”
                    </p>
                  )}
                  <ProvisionForm
                    leadId={l.id}
                    dealershipName={l.dealershipName}
                    email={l.email}
                    makes={makes}
                    origin={origin}
                  />
                </div>
                <span className="shrink-0 text-xs text-neutral-500">{ago(l.createdAt, now)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Recent price syncs">
        {runs.length === 0 ? (
          <Empty>
            The morning sync has not run yet. It needs CRON_SECRET set on the site — without it
            the endpoint refuses every request rather than falling open.
          </Empty>
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {runs.map((r, i) => (
              <li key={`${r.storeId}-${i}`} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{r.storeName}</p>
                  <p className="text-xs text-neutral-500">{r.summary}</p>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  {r.quarantinedCount > 0 && (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                      {r.quarantinedCount} held back
                    </span>
                  )}
                  <span className={r.status === 'OK' ? 'text-neutral-500' : 'font-medium text-rose-700 dark:text-rose-400'}>
                    {r.status}
                  </span>
                  <span className="text-neutral-500">{ago(r.startedAt, now)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </main>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'warn' | 'bad' }) {
  const colour = tone === 'bad'
    ? 'text-rose-700 dark:text-rose-400'
    : tone === 'warn'
      ? 'text-amber-700 dark:text-amber-400'
      : ''
  return (
    <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
      <p className="text-xs font-bold uppercase tracking-widest text-neutral-500">{label}</p>
      <p className={`mt-1 text-3xl font-bold tabular-nums ${colour}`}>{value}</p>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-bold uppercase tracking-widest text-neutral-500">{title}</h2>
      <div className="mt-2 rounded-xl border border-neutral-200 dark:border-neutral-800">
        {children}
      </div>
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="p-4 text-sm text-neutral-500">{children}</p>
}
