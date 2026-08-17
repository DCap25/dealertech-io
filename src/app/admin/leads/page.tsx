import Link from 'next/link'
import { headers } from 'next/headers'
import { requirePlatformAdmin } from '@/lib/auth/session'
import { loadLeadCounts, loadLeads } from '@/lib/platform/load'
import { knownMakes } from '@/lib/warranty'
import { ProvisionForm } from '../provision-form'
import { OutcomeForm } from './outcome-form'
import { ago } from '../ui'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Leads' }

/**
 * The wall clock, hoisted out of the component.
 *
 * A request-scoped input like the session, not part of rendering — and the
 * linter rejects reading one during a render outright. Same shape as the
 * operations page and the tenant page.
 */
const nowMs = () => Date.now()

/**
 * Every inbound demo request, and what was done about it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A PAGE AND NOT A LONGER LIST ON /admin
 * ---------------------------------------------------------------------------
 * The operations page is the morning read: a rollup of things somebody has to
 * act on today. Leads were a twenty-row list sitting in the middle of it with
 * a provisioning form under every one, which pushed the job health that page
 * exists for below the fold. Worse, twenty was a cap nobody could see — a lead
 * from six weeks ago simply was not on the screen, and nothing said so.
 *
 * So the summary keeps the count and the newest few; this holds all of them,
 * and it is the only place with room to record what happened on the call.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS NOT HERE
 * ---------------------------------------------------------------------------
 * A pipeline, stages, owners, or a next-action date. See `recordLeadOutcome` —
 * a vocabulary invented before there is a sales process to describe produces
 * stages nobody agrees on. Did anyone ring them, and what did they say.
 */
export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>
}) {
  await requirePlatformAdmin()

  const { filter } = await searchParams
  const uncontactedOnly = filter === 'new'

  // One instant for every relative time on the page — see the note on `ago`.
  const now = nowMs()

  const [leads, counts] = await Promise.all([
    loadLeads(200, { uncontactedOnly }),
    // Aggregated, not derived from the list above — which is filtered, and so
    // cannot know how many contacted leads exist. See `loadLeadCounts`.
    loadLeadCounts(),
  ])

  // Built server-side so a copied invitation link is right behind a proxy or
  // on a custom domain rather than whatever the browser happens to think.
  const host = (await headers()).get('host') ?? ''
  const protocol = host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https'
  const origin = `${protocol}://${host}`
  const makes = knownMakes()

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <Link href="/admin" className="text-sm text-neutral-500 hover:underline">
        ← Operations
      </Link>

      <h1 className="mt-3 text-3xl font-bold tracking-tight">Leads</h1>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        Demo requests from the marketing site. Nothing here is a tenant yet — provisioning one
        creates the dealership and an invitation, and marks the lead contacted.
      </p>

      <div className="mt-5 flex gap-2">
        <Tab href="/admin/leads" active={!uncontactedOnly}>
          All ({counts.total})
        </Tab>
        <Tab href="/admin/leads?filter=new" active={uncontactedOnly}>
          Not contacted ({counts.uncontacted})
        </Tab>
      </div>

      {leads.length === 0 ? (
        <p className="mt-6 rounded-xl border border-neutral-200 p-4 text-sm text-neutral-500 dark:border-neutral-800">
          {uncontactedOnly
            ? 'Everyone has been rung. Nothing waiting.'
            : 'No inbound requests yet.'}
        </p>
      ) : (
        <ul className="mt-6 space-y-4">
          {leads.map((l) => (
            <li
              key={l.id}
              className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">
                    {l.dealershipName}
                    {!l.contacted && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                        new
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-neutral-500">
                    {l.name}
                    {l.role ? ` · ${l.role}` : ''}
                  </p>
                  {/*
                    Selectable rather than a mailto/tel link. The job here is to
                    put the number into a phone or a CRM, and a link that opens
                    whatever the desktop has registered for `tel:` is a
                    detour — three people have a different answer to that.
                  */}
                  <p className="mt-1 select-all font-mono text-xs text-neutral-600 dark:text-neutral-400">
                    {l.email}
                    {l.phone ? ` · ${l.phone}` : ''}
                  </p>
                </div>
                <div className="shrink-0 text-right text-xs text-neutral-500">
                  <p>{ago(l.createdAt, now)}</p>
                  {l.contactedAt && (
                    <p className="mt-0.5">rung {ago(l.contactedAt, now)}</p>
                  )}
                </div>
              </div>

              {/*
                The qualifiers, on one line. Rooftops is the single best one we
                can ask for on a form: it decides whether this is a self-serve
                signup or a conversation with an accounts payable department.
              */}
              <p className="mt-2 text-xs text-neutral-500">
                {[
                  l.rooftops ? `${l.rooftops} rooftop${l.rooftops === 1 ? '' : 's'}` : null,
                  l.dms ? `DMS: ${l.dms}` : null,
                  l.source ? `via ${l.source}` : null,
                  l.referrer ? `from ${l.referrer}` : null,
                ].filter(Boolean).join(' · ') || 'No qualifiers given.'}
              </p>

              {l.message && (
                <p className="mt-2 rounded-lg bg-neutral-50 px-3 py-2 text-xs italic text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
                  &ldquo;{l.message}&rdquo;
                </p>
              )}

              <OutcomeForm leadId={l.id} notes={l.notes} contacted={l.contacted} />

              <ProvisionForm
                leadId={l.id}
                dealershipName={l.dealershipName}
                email={l.email}
                makes={makes}
                origin={origin}
              />
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}

function Tab({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`touch-target rounded-lg border px-3 py-1.5 text-sm font-semibold ${
        active
          ? 'border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900'
          : 'border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900'
      }`}
    >
      {children}
    </Link>
  )
}
