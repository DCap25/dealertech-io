import Link from 'next/link'
import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { requirePlatformAdmin } from '@/lib/auth/session'
import { loadLeadDetail } from '@/lib/platform/load'
import { listTourCodes } from '@/lib/demo-tour/store'
import { knownMakes } from '@/lib/warranty'
import { ProvisionForm } from '../../provision-form'
import { LocalTime } from '../../local-time'
import { StageChip, ago } from '../../ui'
import { OutcomeForm } from '../outcome-form'
import { TourCodes } from '../tour-codes'
import { WalkthroughPanel } from './walkthrough'
import { LostControls, NoteForm } from './lead-forms'

export const dynamic = 'force-dynamic'

/**
 * The wall clock, hoisted out of the component.
 *
 * A request-scoped input like the session, not part of rendering — and one
 * instant for the whole page, so the stage chip, the timeline and the tour
 * codes cannot disagree about what "now" means.
 */
const nowMs = () => Date.now()

export async function generateMetadata({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params
  const detail = await loadLeadDetail(leadId)
  return { title: detail?.lead.dealershipName ?? 'Lead' }
}

/**
 * One lead, and everywhere it can go from here.
 *
 * ---------------------------------------------------------------------------
 * WHY THE WORK MOVED OFF THE LIST
 * ---------------------------------------------------------------------------
 * The list used to carry a notes form, a tour-code panel and a provisioning
 * form under every row — three collapsed forms per lead, on a page whose job
 * is triage. Scanning fifty leads meant scrolling past a hundred and fifty
 * buttons. So the list answers "who needs me" and this answers "what do I do
 * about them", which is also the only place with room for the timeline.
 *
 * 404 on an unknown id, exactly like the tenant page, and for the same two
 * reasons at once: a bad uuid and a caller row-level security returned nothing
 * to are indistinguishable here, and the console does not announce itself to
 * people who should not be looking at it.
 */
export default async function LeadPage({ params }: { params: Promise<{ leadId: string }> }) {
  await requirePlatformAdmin()
  const { leadId } = await params

  const now = nowMs()
  const detail = await loadLeadDetail(leadId, new Date(now))
  if (!detail) notFound()

  const { lead, events, organizationName } = detail
  const codes = await listTourCodes({ demoRequestId: leadId, asOf: new Date(now) })

  // Built server-side so a copied invitation link is right behind a proxy or
  // on a custom domain rather than whatever the browser happens to think.
  const host = (await headers()).get('host') ?? ''
  const protocol = host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https'
  const origin = `${protocol}://${host}`

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <Link href="/admin/leads" className="text-sm text-neutral-500 hover:underline">
        ← Leads
      </Link>

      <header className="mt-3 flex flex-wrap items-start justify-between gap-4 border-b border-neutral-200 pb-5 dark:border-neutral-800">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight">{lead.dealershipName}</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {lead.name}
            {lead.role ? ` · ${lead.role}` : ''}
            {' · arrived '}
            {ago(lead.createdAt, now)}
          </p>
          <p className="mt-1 font-mono text-sm">
            <a href={`mailto:${lead.email}`} className="hover:underline">{lead.email}</a>
            {lead.phone && (
              <>
                <span className="text-neutral-400"> · </span>
                <a href={`tel:${lead.phone.replace(/[^+\d]/g, '')}`} className="hover:underline">
                  {lead.phone}
                </a>
              </>
            )}
          </p>
        </div>
        <div className="text-right">
          <StageChip stage={lead.stage} />
          {/*
            The fact behind the chip, not a restatement of it. A stage nobody
            can trace back to an event is the unfalsifiable board that deriving
            the stage exists to avoid — so it is printed where the stage is.
          */}
          <p className="mt-1 max-w-[16rem] text-xs text-neutral-500">{lead.because}</p>
        </div>
      </header>

      {lead.nextStep && (
        <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {lead.nextStep}
        </p>
      )}

      {/*
        The qualifiers, on one line. Rooftops is the single best one the form
        can ask for: it decides whether this is a self-serve signup or a
        conversation with an accounts payable department.
      */}
      <p className="mt-4 text-xs text-neutral-500">
        {[
          lead.rooftops ? `${lead.rooftops} rooftop${lead.rooftops === 1 ? '' : 's'}` : null,
          lead.dms ? `DMS: ${lead.dms}` : null,
          lead.source ? `via ${lead.source}` : null,
          lead.referrer ? `from ${lead.referrer}` : null,
        ].filter(Boolean).join(' · ') || 'No qualifiers given.'}
      </p>

      {lead.message && (
        <p className="mt-2 rounded-lg bg-neutral-50 px-3 py-2 text-sm italic text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
          &ldquo;{lead.message}&rdquo;
        </p>
      )}

      {lead.provisionedOrgId && (
        /*
          The link the console could not draw at all before 0035. Provisioning
          created an organisation and forgot which lead it came from, so
          answering "did this prospect become a customer" meant matching
          dealership names by eye on another page.
        */
        <p className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm dark:border-emerald-800 dark:bg-emerald-950">
          <span className="font-semibold text-emerald-900 dark:text-emerald-200">
            This lead is a tenant.
          </span>{' '}
          <Link
            href={`/admin/tenants/${lead.provisionedOrgId}`}
            className="font-semibold underline underline-offset-2"
          >
            {organizationName ?? 'Open the dealership'} →
          </Link>
        </p>
      )}

      <Section title="Where it stands">
        <OutcomeForm leadId={lead.id} notes={lead.notes} contacted={lead.contacted} />
      </Section>

      <Section title="Walkthrough">
        <WalkthroughPanel
          leadId={lead.id}
          dealershipName={lead.dealershipName}
          walkthroughAt={lead.walkthroughAt?.toISOString() ?? null}
          walkthroughDoneAt={lead.walkthroughDoneAt?.toISOString() ?? null}
        />
      </Section>

      {/*
        Above provisioning, deliberately, because it comes first in time: a
        walkthrough is booked and toured long before anybody stands up their
        dealership. A lead that never gets a code usually never gets a tenant.
      */}
      <Section title="Tour codes">
        <div className="p-4">
          <TourCodes
            leadId={lead.id}
            dealershipName={lead.dealershipName}
            contactName={lead.name}
            contactEmail={lead.email}
            origin={origin}
            codes={codes}
            now={now}
          />
        </div>
      </Section>

      <Section title="Their dealership">
        <div className="p-4">
          {lead.provisionedOrgId ? (
            <p className="text-sm text-neutral-500">
              Already provisioned. Standing up a second dealership from the same lead would create
              a duplicate organisation nobody asked for — add a rooftop from the tenant page
              instead.
            </p>
          ) : (
            <ProvisionForm
              leadId={lead.id}
              dealershipName={lead.dealershipName}
              email={lead.email}
              makes={knownMakes()}
              origin={origin}
            />
          )}
        </div>
      </Section>

      <Section title="Outcome">
        <LostControls
          leadId={lead.id}
          lostAt={lead.lostAt?.toISOString() ?? null}
          lostReason={lead.lostReason}
        />
      </Section>

      {/*
        The history the single notes field could never be. Append-only by
        convention — nothing in the application updates or deletes one of these
        — so what somebody wrote in March still says it in September.
      */}
      <Section title={`Timeline (${events.length})`}>
        <NoteForm leadId={lead.id} />
        {events.length === 0 ? (
          <p className="border-t border-neutral-100 p-4 text-sm text-neutral-500 dark:border-neutral-800">
            Nothing written down yet.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100 border-t border-neutral-100 dark:divide-neutral-800 dark:border-neutral-800">
            {events.map((e) => (
              <li key={e.id} className="p-3">
                <p className="flex flex-wrap items-baseline gap-2 text-xs text-neutral-500">
                  <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-semibold uppercase tracking-wide dark:bg-neutral-800">
                    {e.kind.toLowerCase()}
                  </span>
                  <LocalTime iso={e.occurredAt.toISOString()} />
                  {e.authorName && <span>· {e.authorName}</span>}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm">{e.body}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </main>
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
