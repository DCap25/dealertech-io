import Link from 'next/link'
import { requirePlatformAdmin } from '@/lib/auth/session'
import { loadLeadBoard, type LeadOnBoard } from '@/lib/platform/load'
import { ALL_LEAD_STAGES, STAGE_LABEL } from '@/lib/crm/stage'
import { StageChip, ago, filterForStage, stageForFilter } from '../ui'

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
 * The pipeline: every inbound demo request and how far it has got.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A PAGE AND NOT A LONGER LIST ON /admin
 * ---------------------------------------------------------------------------
 * The operations page is the morning read: a rollup of things somebody has to
 * act on today. Leads were a twenty-row list sitting in the middle of it with
 * a provisioning form under every one, which pushed the job health that page
 * exists for below the fold. Worse, twenty was a cap nobody could see.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE ARE STAGES NOW, HAVING ARGUED AGAINST THEM
 * ---------------------------------------------------------------------------
 * `recordLeadOutcome` said a stage enum would be wrong at this size, and the
 * reasoning was right about the thing it was refusing: a vocabulary invented
 * before there is a sales process produces stages nobody agrees on and a board
 * that is always slightly out of date. What changed is not the size of the
 * sales team — it is still one person — but the number of facts the product
 * records. Codes are issued and redeemed, walkthroughs are booked, tenants are
 * provisioned, first menus are presented. Every one of those already says
 * where a deal stands, and they were scattered across four screens.
 *
 * So the stages here are computed, never stored (`src/lib/crm/stage.ts`).
 * Nobody drags a card, nothing goes out of date, and the tab counts and the
 * rows under them come from one pass over the same facts — see `loadLeadBoard`.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS NOT HERE
 * ---------------------------------------------------------------------------
 * Owners, assignment, quotas, a next-action date. One person is selling. The
 * work on a single lead — the call, the code, the booking, provisioning — all
 * moved to its own page, because a list with five forms under every row is a
 * wall you scroll past rather than a list you scan.
 */
export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>
}) {
  await requirePlatformAdmin()

  const { filter } = await searchParams
  /*
    `?filter=new` still lands here, and lands on the right tab.

    It is the link on the morning read's "Leads not contacted" tile and it
    predates the pipeline, so it maps onto the NEW stage rather than becoming a
    dead parameter that silently shows everything.
  */
  const selected = stageForFilter(filter)

  // One instant for every relative time and every stage on the page. A stage
  // computed from a fresh clock per row can put two leads booked in the same
  // second on opposite sides of an expiry boundary.
  const now = nowMs()
  const { leads, counts, total } = await loadLeadBoard(new Date(now))

  const shown = selected ? leads.filter((l) => l.stage === selected) : leads

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <Link href="/admin" className="text-sm text-neutral-500 hover:underline">
        ← Operations
      </Link>

      <h1 className="mt-3 text-3xl font-bold tracking-tight">Leads</h1>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        Demo requests from the marketing site, and how far each has got. Every stage below is
        computed from something that happened — a call logged, a tour code redeemed, a walkthrough
        booked, a dealership provisioned — so nothing here can disagree with the record it is drawn
        from. Open a lead to do anything about it.
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        <Tab href="/admin/leads" active={!selected}>
          All ({total})
        </Tab>
        {ALL_LEAD_STAGES.map((stage) => (
          <Tab
            key={stage}
            href={`/admin/leads?filter=${filterForStage(stage)}`}
            active={selected === stage}
            muted={counts[stage] === 0}
          >
            {STAGE_LABEL[stage]} ({counts[stage]})
          </Tab>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="mt-6 rounded-xl border border-neutral-200 p-4 text-sm text-neutral-500 dark:border-neutral-800">
          {selected === 'NEW'
            ? 'Everyone has been rung. Nothing waiting.'
            : selected
              ? 'Nothing at this stage.'
              : 'No inbound requests yet.'}
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {shown.map((lead) => <Card key={lead.id} lead={lead} now={now} />)}
        </ul>
      )}
    </main>
  )
}

/**
 * One lead, at a glance.
 *
 * The whole card is a link to the desk, and the two contact details are links
 * out of it. That last part reverses an earlier decision — the addresses used
 * to be deliberately selectable text on the argument that a `tel:` handler is
 * whatever the desktop happens to have registered. What changed is that this
 * became the page email actually gets sent from: the tour-code panel prefills
 * a message, and a console that composes an email and then asks you to copy an
 * address out of it by hand is doing the hard half and refusing the easy one.
 */
function Card({ lead, now }: { lead: LeadOnBoard; now: number }) {
  return (
    <li className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            <Link href={`/admin/leads/${lead.id}`} className="hover:underline">
              {lead.dealershipName}
            </Link>
            <span className="ml-2 align-middle"><StageChip stage={lead.stage} /></span>
          </p>
          <p className="mt-0.5 text-xs text-neutral-500">
            {lead.name}
            {lead.role ? ` · ${lead.role}` : ''}
            {lead.rooftops ? ` · ${lead.rooftops} rooftop${lead.rooftops === 1 ? '' : 's'}` : ''}
            {lead.dms ? ` · ${lead.dms}` : ''}
          </p>
          <p className="mt-1 font-mono text-xs">
            <a href={`mailto:${lead.email}`} className="text-neutral-600 hover:underline dark:text-neutral-400">
              {lead.email}
            </a>
            {lead.phone && (
              <>
                <span className="text-neutral-400"> · </span>
                <a href={`tel:${lead.phone.replace(/[^+\d]/g, '')}`} className="text-neutral-600 hover:underline dark:text-neutral-400">
                  {lead.phone}
                </a>
              </>
            )}
          </p>
        </div>
        <div className="shrink-0 text-right text-xs text-neutral-500">
          <p>{ago(lead.createdAt, now)}</p>
          <p className="mt-0.5">{lead.because}</p>
        </div>
      </div>

      {/*
        The nag, and only when there is one.

        `nextStep` stays quiet on a lead where the next move is somebody else's
        — a booked walkthrough that has not happened yet needs nothing from
        anybody. A hint on every row is a hint nobody reads.
      */}
      {lead.nextStep && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {lead.nextStep}
        </p>
      )}

      <p className="mt-2">
        <Link
          href={`/admin/leads/${lead.id}`}
          className="text-xs font-semibold hover:underline"
        >
          Open the lead →
        </Link>
      </p>
    </li>
  )
}

function Tab({ href, active, muted, children }: {
  href: string; active: boolean; muted?: boolean; children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className={`touch-target flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold ${
        active
          ? 'border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900'
          : muted
            // Empty stages stay on the page rather than disappearing: the shape
            // of the funnel is the information, and a tab that vanishes when it
            // empties makes "nothing toured this month" invisible.
            ? 'border-neutral-200 text-neutral-400 hover:bg-neutral-100 dark:border-neutral-800 dark:text-neutral-600 dark:hover:bg-neutral-900'
            : 'border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900'
      }`}
    >
      {children}
    </Link>
  )
}
