import Link from 'next/link'
import { requirePlatformAdmin } from '@/lib/auth/session'
import { signOut } from '@/app/login/actions'
import {
  loadLeads, loadNeedsAttention, loadRecentJobRuns, loadTenants, loadUpcomingWalkthroughs,
} from '@/lib/platform/load'
import { isOnFounderDay } from '@/lib/crm/founder-day'
import { LifecycleBadge, ago } from './ui'
import { LocalTime } from './local-time'

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

/*
  `ago` comes from ./ui, where the tenant pages already take it from.

  A byte-identical copy lived here, in a file that was already importing its
  neighbour from that module. Two implementations of "how long ago" is how the
  console ends up rounding the same timestamp two different ways on two pages.
*/

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
  const [tenants, leads, runs, attention, walkthroughs] = await Promise.all([
    loadTenants(),
    // Five, because five are shown. The count on the tile above comes from its
    // own aggregate, so this is not what any number on the page is derived from.
    loadLeads(5),
    loadRecentJobRuns(10),
    loadNeedsAttention(new Date(now)),
    /*
      A list rather than a count, unlike everything else here: "when, and who"
      is the whole content of a walkthrough, and a number would send somebody
      to another page to read four words. See `loadUpcomingWalkthroughs`.

      Loaded twice on purpose — `loadNeedsAttention` fetches the same rows to
      count today's from them. Two small reads beat one shared one here: the
      alternative is the tile taking its number from whatever this page happens
      to have in hand, which makes the rollup depend on its caller and puts the
      count somewhere `stage.test.ts` cannot reach it. The agreement between
      the tile and the section below is worth one repeated query.
    */
    loadUpcomingWalkthroughs(7, new Date(now)),
  ])

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

      {/*
        The morning read.

        Every tile is something somebody has to do about it, which is the whole
        test for being here — a rollup carrying things you cannot act on is one
        people stop reading. Failed webhooks in particular appeared nowhere at
        all until now: Stripe stops retrying eventually, and a subscription
        that never activated because one delivery failed looks exactly like a
        customer who never paid.
      */}
      <div className="mt-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Stat label="Dealerships" value={String(tenants.length)} />
        <Stat
          label="Past due"
          value={String(attention.pastDue)}
          tone={attention.pastDue > 0 ? 'warn' : 'good'}
        />
        <Stat
          label="Restricted"
          value={String(attention.restricted)}
          tone={attention.restricted > 0 ? 'bad' : 'good'}
        />
        <Stat
          label="Suspended"
          value={String(attention.suspended)}
          tone={attention.suspended > 0 ? 'bad' : 'good'}
        />
        <Stat
          label="Trials ending in 7d"
          value={String(attention.trialsEndingSoon)}
          tone={attention.trialsEndingSoon > 0 ? 'warn' : 'good'}
        />
        <Stat
          label="Trials expired"
          value={String(attention.trialsExpired)}
          tone={attention.trialsExpired > 0 ? 'warn' : 'good'}
        />
        <Stat
          label="Failed webhooks"
          value={String(attention.failedWebhooks)}
          tone={attention.failedWebhooks > 0 ? 'bad' : 'good'}
        />
        <Stat
          label="Failing syncs"
          value={String(attention.failingSyncs)}
          tone={attention.failingSyncs > 0 ? 'bad' : 'good'}
        />
        <Stat
          /*
            "New leads", not "Leads not contacted".

            The label followed the old aggregate, which counted the `contacted`
            flag while the tab behind the link showed the derived NEW stage —
            so a lead nobody had rung but who had been sent a tour code was on
            the tile and absent from the tab it opened. The count comes from
            the derivation now, and NEW means nothing has happened at all, so
            the honest name for it is the stage's own.
          */
          label="New leads"
          value={String(attention.newLeads)}
          tone={attention.newLeads > 0 ? 'warn' : 'good'}
          href="/admin/leads?filter=new"
        />
        <Stat
          label="Stale integrations"
          value={String(needAttention.length)}
          tone={needAttention.length > 0 ? 'bad' : 'good'}
        />
        {/*
          The funnel, on the same rollup as the infrastructure, because the
          test for being here is the same: each of these is a thing somebody
          has to do something about today. A walkthrough at two o'clock is the
          most time-bound item on the whole page and it was visible nowhere.

          Every one links to the place that shows the leads it counted, and
          that is a property rather than an intention — each count is computed
          by the same predicate that decides what the destination contains.
          See `loadNeedsAttention`, and `stage.test.ts` where it is pinned.
        */}
        <Stat
          label="Walkthroughs today"
          value={String(attention.walkthroughsToday)}
          tone={attention.walkthroughsToday > 0 ? 'warn' : 'good'}
          /*
            Down the page, not off it.

            This one counts appointments rather than a stage, and a demo whose
            dealership has already been provisioned is on no stage tab that
            mentions walkthroughs — so a link to `?filter=walkthrough-booked`
            would name a number the destination cannot show. The section below
            renders exactly the rows this was counted from.
          */
          href="#walkthroughs"
        />
        <Stat
          label="Codes expiring unused"
          value={String(attention.codesExpiringUnused)}
          tone={attention.codesExpiringUnused > 0 ? 'warn' : 'good'}
          href="/admin/leads?filter=code-sent"
        />
        <Stat
          label="Leads gone quiet"
          value={String(attention.quietLeads)}
          tone={attention.quietLeads > 0 ? 'warn' : 'good'}
          href="/admin/leads"
        />
      </div>

      {/*
        This week, in full.

        The one section on this page that is not a count and not a health
        check. It is here because it is the only thing on the morning read with
        a time attached — everything else can be done at eleven or at four, and
        a demo cannot.

        Rendered even when empty, because the "Walkthroughs today" tile links
        to it by anchor: a section that disappears at zero is a link that
        scrolls nowhere, which is a worse answer than "nothing booked".
      */}
      <Section title="Walkthroughs this week" id="walkthroughs">
        {walkthroughs.length === 0 ? (
          <Empty>Nothing booked between now and next week.</Empty>
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {walkthroughs.map((w) => (
              <li key={w.leadId}>
                <Link
                  href={`/admin/leads/${w.leadId}`}
                  className="flex flex-wrap items-center justify-between gap-3 p-3 hover:bg-neutral-50 dark:hover:bg-neutral-900"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      {w.dealershipName}
                      {/*
                        Which rows the tile counted, said on the rows
                        themselves. The count is a filter over this list, so
                        marking its members is the whole of the explanation.
                      */}
                      {isOnFounderDay(w.walkthroughAt, new Date(now)) && (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                          today
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-neutral-500">{w.contactName}</p>
                  </div>
                  <span className="shrink-0 text-xs font-medium">
                    <LocalTime iso={w.walkthroughAt.toISOString()} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {attention.foreignWebhooks > 0 && (
        /*
          Should be zero, always. DealerTech bills from its own Stripe account,
          so an event without our metadata means something is pointed at the
          wrong account — worth an alarm rather than a tile, because the number
          being non-zero is itself the problem.
        */
        <p className="mt-3 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900 dark:bg-rose-950 dark:text-rose-200">
          {attention.foreignWebhooks} Stripe event(s) arrived without DealerTech metadata.
          Something may be pointed at the wrong Stripe account.
        </p>
      )}

      <Section title={`Dealerships (${tenants.length})`}>
        {tenants.length === 0 ? (
          <Empty>Nobody has signed up yet.</Empty>
        ) : (
          <>
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {tenants.map((t) => (
              <li key={t.storeId}>
                <Link
                  href={`/admin/tenants/${t.organizationId}`}
                  className="flex flex-wrap items-center justify-between gap-3 p-3 hover:bg-neutral-50 dark:hover:bg-neutral-900"
                >
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
                    {/*
                      Commercial standing next to integration health, on one
                      line. They are the two ways a tenant quietly stops being
                      a customer, and reading them together is the whole
                      purpose of this row.
                    */}
                    <LifecycleBadge status={t.lifecycleStatus} />
                    <SyncBadge at={t.lastSyncAt} status={t.lastSyncStatus} createdAt={t.createdAt} now={now} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          {/*
            The navigation gap, closed.

            `/admin/tenants` has existed for a phase with nothing linking to
            it: every route into a tenant went through a row of this list, so
            the searchable page with lifecycle status and MRR on it was
            reachable only by typing the URL or by going back from a tenant.
          */}
          <div className="border-t border-neutral-100 p-3 dark:border-neutral-800">
            <Link href="/admin/tenants" className="text-sm font-semibold hover:underline">
              Every dealership, with plan and standing →
            </Link>
          </div>
          </>
        )}
      </Section>

      {/*
        A preview, with the work on its own page.

        This was the full list with a provisioning form under every row, which
        pushed the job health this page exists for below the fold — and it was
        silently capped at twenty, so an older lead was simply not on the
        screen with nothing to say so. Five and a link is honest about being a
        summary.
      */}
      <Section title="Leads">
        {leads.length === 0 ? (
          <Empty>No inbound requests yet.</Empty>
        ) : (
          <>
            <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {leads.map((l) => (
                <li key={l.id}>
                  <Link
                    // The lead itself now, not the list it is on. The desk is
                    // where anything is done about it.
                    href={`/admin/leads/${l.id}`}
                    className="flex flex-wrap items-start justify-between gap-3 p-3 hover:bg-neutral-50 dark:hover:bg-neutral-900"
                  >
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
                        {l.role ? ` · ${l.role}` : ''}
                        {l.rooftops ? ` · ${l.rooftops} rooftop${l.rooftops === 1 ? '' : 's'}` : ''}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-neutral-500">{ago(l.createdAt, now)}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="border-t border-neutral-100 p-3 dark:border-neutral-800">
              <Link href="/admin/leads" className="text-sm font-semibold hover:underline">
                All leads, and what was said →
              </Link>
            </div>
          </>
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

function Stat({ label, value, tone, href }: {
  label: string; value: string; tone?: 'good' | 'warn' | 'bad'; href?: string
}) {
  const colour = tone === 'bad'
    ? 'text-rose-700 dark:text-rose-400'
    : tone === 'warn'
      ? 'text-amber-700 dark:text-amber-400'
      : ''

  const body = (
    <>
      <p className="text-xs font-bold uppercase tracking-widest text-neutral-500">{label}</p>
      <p className={`mt-1 text-3xl font-bold tabular-nums ${colour}`}>{value}</p>
    </>
  )

  const shell = 'rounded-xl border border-neutral-200 p-4 dark:border-neutral-800'

  if (href) {
    return (
      <Link href={href} className={`${shell} block hover:bg-neutral-50 dark:hover:bg-neutral-900`}>
        {body}
      </Link>
    )
  }
  return <div className={shell}>{body}</div>
}

function Section({ title, id, children }: {
  title: string; id?: string; children: React.ReactNode
}) {
  return (
    // `scroll-mt` so an anchored jump does not tuck the heading under the top
    // of the viewport — the tile above links here by fragment.
    <section className="mt-8 scroll-mt-6" id={id}>
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
