// Not `server-only`: the provisioning path is also reachable from a CLI script
// when a dealership is stood up ahead of a demo. It still cannot reach a
// browser — it imports the scoped database client.
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm'
import { getDb, schema } from '@/db/client'
import { withCurrentUserScope } from '@/db/scoped'
import { lifecycleHistory } from '@/lib/billing/store'
import type { LifecycleStatus } from '@/lib/billing/lifecycle'
import { monthlyTotalCents } from '@/lib/billing/plans'
import { loadProgressForPlatform } from '@/lib/onboarding/load'
import type { OnboardingProgress } from '@/lib/onboarding/steps'
import {
  ALL_LEAD_STAGES, deriveStage, hasCodeExpiringUnused, hasGoneQuiet, isNewLead, nextStep,
  type LeadFacts, type LeadStage,
} from '@/lib/crm/stage'
import { isOnFounderDay, startOfFounderDay } from '@/lib/crm/founder-day'

/**
 * The operational view of the platform.
 *
 * Every query here runs under the caller's row-level security, exactly like the
 * dealership surfaces do. That is deliberate: the admin console is not allowed
 * a privileged connection, so the boundary between "operational metadata" and
 * "a dealership's customers" is enforced by the same policies as everything
 * else rather than by this file remembering to be careful. Migration 0016 is
 * where that boundary is actually drawn.
 *
 * The practical consequence is worth stating: a platform admin who queries
 * customers through here gets nothing back. Not an error, not a partial list —
 * nothing. That is the design working.
 */

export interface TenantSummary {
  storeId: string
  storeName: string
  organizationId: string
  organizationName: string
  franchiseMake: string | null
  state: string | null
  isActive: boolean
  createdAt: Date
  staffCount: number
  pendingInvites: number
  /** Last price sync, so a silently broken integration is visible. */
  lastSyncAt: Date | null
  lastSyncStatus: string | null
  lastSyncSummary: string | null
  /** Where they stand commercially. Read next to sync health, deliberately. */
  lifecycleStatus: LifecycleStatus
  lifecycleChangedAt: Date
  trialEndsAt: Date | null
  /**
   * What this rooftop's group bills per month, in cents.
   *
   * Computed from the catalog and the group's rooftop count rather than asked
   * of Stripe. Rendering this page must not depend on a third-party API being
   * up, and an aggregate-of-Stripe call per tenant would make the one screen
   * somebody leaves open all day the slowest in the product.
   *
   * Null for a group with no subscription — a trial or a comp bills nothing,
   * and showing them a number would misstate the pipeline.
   */
  monthlyCents: number | null
}

export async function loadTenants(): Promise<TenantSummary[]> {
  return withCurrentUserScope(async (db) => {
    const stores = await db
      .select({
        storeId: schema.stores.id,
        storeName: schema.stores.name,
        organizationId: schema.organizations.id,
        organizationName: schema.organizations.name,
        franchiseMake: schema.stores.franchiseMake,
        state: schema.stores.state,
        isActive: schema.stores.isActive,
        createdAt: schema.stores.createdAt,
        lifecycleStatus: schema.organizations.lifecycleStatus,
        lifecycleChangedAt: schema.organizations.lifecycleChangedAt,
        trialEndsAt: schema.organizations.trialEndsAt,
      })
      .from(schema.stores)
      .innerJoin(schema.organizations, eq(schema.organizations.id, schema.stores.organizationId))
      .orderBy(schema.stores.name)

    if (stores.length === 0) return []

    /*
      Counted in one pass each rather than per store.

      A group with forty rooftops would otherwise be a hundred and twenty
      round trips, and this page is the one somebody leaves open all day.
    */
    const staff = await db
      .select({
        storeId: schema.userStoreRoles.storeId,
        n: sql<number>`count(*)::int`,
      })
      .from(schema.userStoreRoles)
      .where(eq(schema.userStoreRoles.isActive, true))
      .groupBy(schema.userStoreRoles.storeId)

    const invites = await db
      .select({
        storeId: schema.storeInvitations.storeId,
        n: sql<number>`count(*)::int`,
      })
      .from(schema.storeInvitations)
      .where(and(
        isNull(schema.storeInvitations.acceptedAt),
        isNull(schema.storeInvitations.revokedAt),
      ))
      .groupBy(schema.storeInvitations.storeId)

    // Newest sync per store. DISTINCT ON is the one place raw SQL beats the
    // query builder for readability.
    const syncs = await db.execute(sql`
      SELECT DISTINCT ON (store_id)
        store_id, started_at, status, summary
      FROM pricing_sync_runs
      ORDER BY store_id, started_at DESC
    `) as unknown as {
      store_id: string; started_at: string; status: string; summary: string
    }[]

    /*
      Rooftops per group, so MRR is the group's bill rather than a rooftop's
      share of it. Volume pricing means the two are not proportional — the
      per-rooftop rate depends on how many the group has.
    */
    const rooftopsByOrg = new Map<string, number>()
    for (const s of stores) {
      if (!s.isActive) continue
      rooftopsByOrg.set(s.organizationId, (rooftopsByOrg.get(s.organizationId) ?? 0) + 1)
    }

    const billed = await db
      .select({
        organizationId: schema.billingAccounts.organizationId,
        status: schema.subscriptions.status,
      })
      .from(schema.subscriptions)
      .innerJoin(
        schema.billingAccounts,
        eq(schema.billingAccounts.id, schema.subscriptions.billingAccountId),
      )

    // Only a subscription that actually bills counts toward MRR. A cancelled
    // or comped one is revenue that is not arriving.
    const billingOrgs = new Set(
      billed.filter((b) => b.status === 'ACTIVE' || b.status === 'PAST_DUE')
        .map((b) => b.organizationId),
    )

    const staffBy = new Map(staff.map((s) => [s.storeId, s.n]))
    const invitesBy = new Map(invites.map((i) => [i.storeId, i.n]))
    const syncBy = new Map(syncs.map((s) => [s.store_id, s]))

    return stores.map((s) => {
      const sync = syncBy.get(s.storeId)
      return {
        ...s,
        staffCount: staffBy.get(s.storeId) ?? 0,
        pendingInvites: invitesBy.get(s.storeId) ?? 0,
        lastSyncAt: sync ? new Date(sync.started_at) : null,
        lastSyncStatus: sync?.status ?? null,
        lastSyncSummary: sync?.summary ?? null,
        monthlyCents: billingOrgs.has(s.organizationId)
          ? monthlyTotalCents(rooftopsByOrg.get(s.organizationId) ?? 0)
          : null,
      }
    })
  })
}

/**
 * What needs somebody today, across every tenant.
 *
 * ---------------------------------------------------------------------------
 * THE PAGE EXISTS TO ANSWER ONE QUESTION
 * ---------------------------------------------------------------------------
 * "What needs me?" — and it could not answer it. The console listed stale
 * syncs and uncontacted leads and nothing else, so a failed webhook appeared
 * nowhere at all, a past-due dealership looked identical to a healthy one
 * until somebody opened its page, and a trial ending on Friday was invisible
 * until it had ended.
 *
 * Each count below is a thing somebody has to do something about. Anything
 * that is merely interesting belongs on a tenant page, not here — a rollup
 * that includes things you cannot act on is one people stop reading.
 *
 * Counted rather than listed. The numbers are the alarm; the tenant pages
 * behind them are where the detail lives.
 */
export interface NeedsAttention {
  /** Behind on payment but still working. Recoverable, and worth a call. */
  pastDue: number
  /** Past grace: administrative surface withdrawn. Escalating. */
  restricted: number
  /** Switched off by a human. Here so nobody forgets one is switched off. */
  suspended: number
  /** Trials ending within a week — the window where a call still changes it. */
  trialsEndingSoon: number
  /** Expired trials nobody converted. */
  trialsExpired: number
  /**
   * Webhook deliveries the handler accepted and could not apply.
   *
   * Invisible everywhere else. Stripe stops retrying eventually, and a
   * subscription that never activated because one event failed looks exactly
   * like a customer who never paid.
   */
  failedWebhooks: number
  /** Stripe events that carried no DealerTech metadata. Should be zero. */
  foreignWebhooks: number
  /** Price syncs that refused or failed on their last run. */
  failingSyncs: number
  /**
   * Leads at stage NEW: nobody rang, no code, nothing.
   *
   * Named for the stage rather than for the `contacted` flag, because it is
   * counted from the stage. It used to be a `contacted = false` aggregate
   * while the tab it links to showed derived NEW, so a lead nobody had rung
   * but who had been sent a tour code appeared on the tile and not on the tab.
   */
  newLeads: number
  /*
    The funnel, on the same rollup as the infrastructure.

    Deliberately here rather than on the leads page. Every other tile is a
    thing somebody has to do today and so are these — a walkthrough at two
    o'clock is the most time-bound item on the whole page, and it was visible
    nowhere until the pipeline existed.
  */
  /**
   * Booked for today where Dan is, and not yet marked held.
   *
   * Counted from the same list the "Walkthroughs this week" section renders,
   * so the tile cannot name a number the section does not show — including a
   * lead that has already been provisioned, which is on no stage tab that
   * mentions walkthroughs and would otherwise be countable and unreachable.
   */
  walkthroughsToday: number
  /** Live tour codes nobody has opened, running out within three days. */
  codesExpiringUnused: number
  /** Leads where nothing has happened for a week. See `hasGoneQuiet`. */
  quietLeads: number
}

/**
 * Runs privileged, and only counts.
 *
 * `stripe_events` is platform-only by policy so the scoped connection would
 * see it fine, but the sync and lifecycle counts span every tenant and the
 * page is a rollup rather than a tenant view. Integers only — the same line
 * drawn in loadProgressForPlatform: counting is not reading.
 *
 * The funnel counts are the exception, and it is a deliberate one. Every one
 * of them comes from `loadLeadFacts` and the pure predicates in
 * `src/lib/crm/stage.ts` — the same functions the pipeline chips are drawn
 * with — rather than from a `WHERE` clause restating the rule in SQL.
 *
 * The rule each tile has to satisfy: **every lead it counts appears at the
 * place it links to.** A tile that disagrees with its own destination is worse
 * than a missing tile, because the disagreement only shows up after somebody
 * clicks. Three of them were wrong on exactly that, each in its own way — an
 * inline condition with no lost/provisioned exclusions, a `contacted = false`
 * aggregate under a link to the derived NEW tab, and a UTC calendar day under
 * a link to a stage tab a provisioned lead cannot be on. All three now ask the
 * derivation, and `stage.test.ts` pins the agreement rather than trusting it.
 *
 * The walkthrough tile is the one that resolves it by moving the destination
 * instead: it counts from the list the page's own "this week" section renders
 * and links there, because a demo that has already been provisioned is a real
 * appointment on a real morning and belongs on the count.
 */
export async function loadNeedsAttention(asOf = new Date()): Promise<NeedsAttention> {
  const db = getDb()

  const byStatus = await db
    .select({ status: schema.organizations.lifecycleStatus, n: sql<number>`count(*)::int` })
    .from(schema.organizations)
    .groupBy(schema.organizations.lifecycleStatus)

  const countFor = (status: LifecycleStatus) =>
    byStatus.find((r) => r.status === status)?.n ?? 0

  const soon = new Date(Date.now() + 7 * 86_400_000)
  const [endingSoon] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.organizations)
    .where(and(
      eq(schema.organizations.lifecycleStatus, 'TRIAL'),
      isNotNull(schema.organizations.trialEndsAt),
      lte(schema.organizations.trialEndsAt, soon),
    ))

  const [failedHooks] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.stripeEvents)
    .where(isNotNull(schema.stripeEvents.error))

  const [foreignHooks] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.stripeEvents)
    .where(eq(schema.stripeEvents.relevant, false))

  /*
    The newest sync per store, then the ones that did not say OK.

    DISTINCT ON rather than a window function for the same reason loadTenants
    uses it — this is the one place raw SQL reads better than the builder.
  */
  const failing = (await db.execute(sql`
    SELECT count(*)::int AS n FROM (
      SELECT DISTINCT ON (store_id) status
      FROM pricing_sync_runs
      ORDER BY store_id, started_at DESC
    ) latest
    WHERE latest.status <> 'OK'
  `)) as unknown as { n: number }[]

  /*
    The funnel, derived rather than queried — see the header.

    Three counts over one pass of the facts, each through the predicate that
    also decides what the destination shows.
  */
  const facts = await loadLeadFacts()
  let newLeads = 0
  let codesExpiringUnused = 0
  let quietLeads = 0
  for (const f of facts.values()) {
    if (isNewLead(f, asOf)) newLeads += 1
    if (hasCodeExpiringUnused(f, asOf)) codesExpiringUnused += 1
    if (hasGoneQuiet(f, asOf)) quietLeads += 1
  }

  /*
    Counted from the list the page renders, not from a second query.

    A `walkthrough_at::date = now()::date` aggregate was both the wrong day —
    UTC, so an evening demo in Texas fell on tomorrow — and a number nothing on
    the page could be relied on to show. Taking the count from the rows
    themselves makes the tile a summary of the section beneath it, which is
    what a count linking to a list should be.
  */
  const upcoming = await loadUpcomingWalkthroughs(7, asOf)
  const walkthroughsToday = upcoming.filter((w) => isOnFounderDay(w.walkthroughAt, asOf)).length

  return {
    walkthroughsToday,
    codesExpiringUnused,
    quietLeads,
    pastDue: countFor('PAST_DUE'),
    restricted: countFor('RESTRICTED'),
    suspended: countFor('SUSPENDED'),
    trialsEndingSoon: endingSoon?.n ?? 0,
    trialsExpired: countFor('EXPIRED'),
    failedWebhooks: failedHooks?.n ?? 0,
    foreignWebhooks: foreignHooks?.n ?? 0,
    failingSyncs: failing[0]?.n ?? 0,
    newLeads,
  }
}

export interface Lead {
  id: string
  name: string
  email: string
  phone: string | null
  dealershipName: string
  role: string | null
  rooftops: number | null
  dms: string | null
  message: string | null
  /**
   * Where they came from, captured without cookies or third-party scripts.
   *
   * Carried on the full leads page and not on the operations summary. It is
   * the difference between a referral and a cold form fill, which changes how
   * the call opens — but it is not worth a line on the morning read.
   */
  source: string | null
  referrer: string | null
  contacted: boolean
  contactedAt: Date | null
  /** The current position. The history is in `lead_events`. */
  notes: string | null
  /** The pipeline facts (migration 0035). There is no stage column. */
  walkthroughAt: Date | null
  walkthroughDoneAt: Date | null
  lostAt: Date | null
  lostReason: string | null
  provisionedOrgId: string | null
  createdAt: Date
}

/**
 * Inbound demo requests.
 *
 * These have been captured since the marketing site went up and never shown
 * anywhere, which means every one of them has sat unread. Ordered uncontacted
 * first and newest first within that, because a three-day-old lead nobody rang
 * is worth more attention than a fresh one somebody already has.
 *
 * Reads under the console's own row-level security, which works here and is
 * worth saying why: migration 0016 grants platform staff a read policy on
 * `demo_requests`, and 0017 added the table grant that policy needed to mean
 * anything. Both were required — a policy without a grant raises "permission
 * denied", which looks nothing like a policy problem.
 */
export async function loadLeads(limit = 50, opts: { uncontactedOnly?: boolean } = {}): Promise<Lead[]> {
  return withCurrentUserScope(async (db) => {
    const rows = await db
      .select()
      .from(schema.demoRequests)
      .where(opts.uncontactedOnly ? eq(schema.demoRequests.contacted, false) : undefined)
      .orderBy(schema.demoRequests.contacted, desc(schema.demoRequests.createdAt))
      .limit(limit)

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      phone: r.phone,
      dealershipName: r.dealershipName,
      role: r.role,
      rooftops: r.rooftops,
      dms: r.dms,
      message: r.message,
      source: r.source,
      referrer: r.referrer,
      contacted: r.contacted,
      contactedAt: r.contactedAt,
      notes: r.notes,
      walkthroughAt: r.walkthroughAt,
      walkthroughDoneAt: r.walkthroughDoneAt,
      lostAt: r.lostAt,
      lostReason: r.lostReason,
      provisionedOrgId: r.provisionedOrgId,
      createdAt: r.createdAt,
    }))
  })
}

/*
  `loadLeadCounts` used to live here: two aggregates for the All and
  Not-contacted tabs, counted separately from the list because the list was
  filtered and so could not say how many contacted leads existed.

  The pipeline made it a liability rather than a safeguard. Nine tabs counted
  by one query and rendered from another is nine chances for "Toured (3)" to
  sit above a list of two — the same failure it was written to prevent,
  multiplied. `loadLeadBoard` derives the counts and the rows from one pass
  over the same facts, so they cannot disagree by construction.
*/

/**
 * Everything `deriveStage` needs, for every lead, in four queries.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT PER LEAD
 * ---------------------------------------------------------------------------
 * The obvious shape is a helper taking a lead id, called in a map. Two hundred
 * leads would be six hundred round trips, and each scoped call is its own
 * transaction on a pool that is `max: 1` behind a pooler — they serialise into
 * a page that takes minutes. Same reasoning `loadTenants` and the leads page
 * already follow: aggregate once, join in memory.
 *
 * ---------------------------------------------------------------------------
 * WHICH CONNECTION, AND THE ONE PLACE IT CHANGES
 * ---------------------------------------------------------------------------
 * Leads, codes and events all read scoped: platform staff have a read policy
 * and the matching grant on each (0016/0017, 0033, 0035), so the console's
 * reads run under the same row-level security as everything else.
 *
 * The first-menu lookup cannot. `presentation_sessions` is withheld from
 * platform staff by 0016 — deliberately, it is a dealership's own activity —
 * so a scoped query returns nothing and every provisioned tenant would read as
 * "never live". It runs privileged and asks for one aggregate per
 * organisation, which is the same line `loadProgressForPlatform` draws and the
 * same number it already surfaces as `daysToFirstMenu`: counting is not
 * reading.
 */
export async function loadLeadFacts(): Promise<Map<string, LeadFacts>> {
  const rows = await withCurrentUserScope(async (db) => {
    const leads = await db
      .select({
        id: schema.demoRequests.id,
        contacted: schema.demoRequests.contacted,
        contactedAt: schema.demoRequests.contactedAt,
        walkthroughAt: schema.demoRequests.walkthroughAt,
        walkthroughDoneAt: schema.demoRequests.walkthroughDoneAt,
        provisionedOrgId: schema.demoRequests.provisionedOrgId,
        lostAt: schema.demoRequests.lostAt,
        lostReason: schema.demoRequests.lostReason,
      })
      .from(schema.demoRequests)

    /*
      Four numbers per lead in one pass.

      `filter (where ...)` is parenthesised before every cast for the reason
      `loadLeadCounts` states: `count(*) filter (...)::int` parses by luck.
      The live-and-unused expiry is the soonest moment a code that could still
      be walked stops being walkable — which is the only expiry worth a nudge.
    */
    const codes = (await db.execute(sql`
      SELECT
        demo_request_id,
        (count(*))::int AS issued,
        (count(*) FILTER (WHERE uses > 0))::int AS redeemed,
        max(created_at) AS last_issued_at,
        min(expires_at) FILTER (
          WHERE revoked_at IS NULL AND uses = 0 AND expires_at > now()
        ) AS live_unused_expires_at
      FROM demo_tour_codes
      WHERE demo_request_id IS NOT NULL
      GROUP BY demo_request_id
    `)) as unknown as {
      demo_request_id: string
      issued: number
      redeemed: number
      last_issued_at: string | null
      live_unused_expires_at: string | null
    }[]

    const activity = await db
      .select({
        demoRequestId: schema.leadEvents.demoRequestId,
        last: sql<string | null>`max(${schema.leadEvents.occurredAt})`,
      })
      .from(schema.leadEvents)
      .groupBy(schema.leadEvents.demoRequestId)

    return { leads, codes, activity }
  })

  const orgIds = [...new Set(rows.leads.map((l) => l.provisionedOrgId).filter((id): id is string => Boolean(id)))]
  const firstMenuByOrg = await firstMenuByOrganization(orgIds)

  const codesBy = new Map(rows.codes.map((c) => [c.demo_request_id, c]))
  const activityBy = new Map(rows.activity.map((a) => [a.demoRequestId, a.last]))

  const facts = new Map<string, LeadFacts>()
  for (const lead of rows.leads) {
    const code = codesBy.get(lead.id)
    facts.set(lead.id, {
      contacted: lead.contacted,
      contactedAt: lead.contactedAt,
      codesIssued: code?.issued ?? 0,
      codesRedeemed: code?.redeemed ?? 0,
      lastCodeIssuedAt: asDate(code?.last_issued_at ?? null),
      liveCodeExpiresAt: asDate(code?.live_unused_expires_at ?? null),
      walkthroughAt: lead.walkthroughAt,
      walkthroughDoneAt: lead.walkthroughDoneAt,
      provisionedOrgId: lead.provisionedOrgId,
      firstMenuAt: lead.provisionedOrgId ? firstMenuByOrg.get(lead.provisionedOrgId) ?? null : null,
      lostAt: lead.lostAt,
      lostReason: lead.lostReason,
      lastActivityAt: asDate(activityBy.get(lead.id) ?? null),
    })
  }
  return facts
}

/** Postgres hands aggregates back as strings through `execute`. */
function asDate(value: string | Date | null): Date | null {
  if (!value) return null
  return value instanceof Date ? value : new Date(value)
}

/**
 * When each organisation first put a menu in front of a customer.
 *
 * Privileged and aggregate-only, for the reason `loadLeadFacts` sets out
 * above: 0016 withholds `presentation_sessions` from platform staff, so the
 * scoped answer is silence rather than an error and every tenant would look
 * like it had never activated.
 */
async function firstMenuByOrganization(organizationIds: string[]): Promise<Map<string, Date>> {
  if (organizationIds.length === 0) return new Map()

  const db = getDb()
  const rows = await db
    .select({
      organizationId: schema.stores.organizationId,
      first: sql<string | null>`min(${schema.presentationSessions.startedAt})`,
    })
    .from(schema.presentationSessions)
    .innerJoin(schema.stores, eq(schema.stores.id, schema.presentationSessions.storeId))
    .where(inArray(schema.stores.organizationId, organizationIds))
    .groupBy(schema.stores.organizationId)

  const out = new Map<string, Date>()
  for (const row of rows) {
    const at = asDate(row.first)
    if (at) out.set(row.organizationId, at)
  }
  return out
}

/** A lead with the stage the facts prove, and the one thing to do about it. */
export interface LeadOnBoard extends Lead {
  stage: LeadStage
  because: string
  nextStep: string | null
}

/**
 * The pipeline: every lead, its stage, and the counts behind the tabs.
 *
 * One loader rather than a list query plus a count query, deliberately. The
 * counts and the rows are derived from the same facts in the same pass, so a
 * tab reading "Toured (3)" over a list of two is not a thing that can happen.
 * See the note where `loadLeadCounts` used to be.
 */
export async function loadLeadBoard(asOf = new Date()): Promise<{
  leads: LeadOnBoard[]
  counts: Record<LeadStage, number>
  total: number
}> {
  const [leads, facts] = await Promise.all([loadLeads(LEAD_BOARD_LIMIT), loadLeadFacts()])

  const counts = Object.fromEntries(ALL_LEAD_STAGES.map((s) => [s, 0])) as Record<LeadStage, number>

  const onBoard = leads.map((lead) => {
    /*
      A lead with no facts row cannot happen — both come from the same table —
      but the fallback is cheaper than a non-null assertion that would throw
      the whole console away if it ever did.
    */
    const f = facts.get(lead.id) ?? emptyFacts(lead)
    const { stage, because } = deriveStage(f, asOf)
    counts[stage] += 1
    return { ...lead, stage, because, nextStep: nextStep(f, asOf) }
  })

  return { leads: onBoard, counts, total: onBoard.length }
}

/**
 * How many leads the board will show.
 *
 * Higher than the two hundred the list used to cap at, and stated rather than
 * silent: the counts on the tabs are derived from the rows below them, so a
 * lead beyond this limit is missing from both and the two still agree. At a
 * founder's volume the cap is theoretical; it exists so the page cannot become
 * unbounded without somebody choosing that.
 */
const LEAD_BOARD_LIMIT = 500

function emptyFacts(lead: Lead): LeadFacts {
  return {
    contacted: lead.contacted,
    contactedAt: lead.contactedAt,
    codesIssued: 0,
    codesRedeemed: 0,
    lastCodeIssuedAt: null,
    liveCodeExpiresAt: null,
    walkthroughAt: lead.walkthroughAt,
    walkthroughDoneAt: lead.walkthroughDoneAt,
    provisionedOrgId: lead.provisionedOrgId,
    firstMenuAt: null,
    lostAt: lead.lostAt,
    lostReason: lead.lostReason,
    lastActivityAt: null,
  }
}

export interface LeadEvent {
  id: string
  kind: string
  body: string
  occurredAt: Date
  authorName: string | null
}

/**
 * One lead in full, or null.
 *
 * Null covers a bad uuid and a caller row-level security returned nothing to,
 * identically — the detail page turns both into a 404, like every other id in
 * this console. It does not announce itself to people who should not be here.
 */
export async function loadLeadDetail(leadId: string, asOf = new Date()): Promise<{
  lead: LeadOnBoard
  events: LeadEvent[]
  organizationName: string | null
} | null> {
  const found = await withCurrentUserScope(async (db) => {
    const [row] = await db
      .select()
      .from(schema.demoRequests)
      .where(eq(schema.demoRequests.id, leadId))
      .limit(1)

    if (!row) return null

    // Sequential rather than Promise.all: one transaction is one connection,
    // so parallel queries inside a scope serialise anyway. See src/db/README.md.
    const events = await db
      .select({
        id: schema.leadEvents.id,
        kind: schema.leadEvents.kind,
        body: schema.leadEvents.body,
        occurredAt: schema.leadEvents.occurredAt,
        authorName: schema.users.fullName,
      })
      .from(schema.leadEvents)
      .leftJoin(schema.users, eq(schema.users.id, schema.leadEvents.createdByUserId))
      .where(eq(schema.leadEvents.demoRequestId, leadId))
      .orderBy(desc(schema.leadEvents.occurredAt))

    const org = row.provisionedOrgId
      ? (await db
          .select({ name: schema.organizations.name })
          .from(schema.organizations)
          .where(eq(schema.organizations.id, row.provisionedOrgId))
          .limit(1))[0] ?? null
      : null

    return { row, events, organizationName: org?.name ?? null }
  })

  if (!found) return null

  const { row, events, organizationName } = found

  const codes = await withCurrentUserScope(async (db) => db
    .select({
      issued: sql<number>`(count(*))::int`,
      redeemed: sql<number>`(count(*) FILTER (WHERE ${schema.demoTourCodes.uses} > 0))::int`,
      lastIssuedAt: sql<string | null>`max(${schema.demoTourCodes.createdAt})`,
      liveUnusedExpiresAt: sql<string | null>`min(${schema.demoTourCodes.expiresAt}) FILTER (
        WHERE ${schema.demoTourCodes.revokedAt} IS NULL
          AND ${schema.demoTourCodes.uses} = 0
          AND ${schema.demoTourCodes.expiresAt} > now()
      )`,
    })
    .from(schema.demoTourCodes)
    .where(eq(schema.demoTourCodes.demoRequestId, leadId)))

  const firstMenu = row.provisionedOrgId
    ? (await firstMenuByOrganization([row.provisionedOrgId])).get(row.provisionedOrgId) ?? null
    : null

  const facts: LeadFacts = {
    contacted: row.contacted,
    contactedAt: row.contactedAt,
    codesIssued: codes[0]?.issued ?? 0,
    codesRedeemed: codes[0]?.redeemed ?? 0,
    lastCodeIssuedAt: asDate(codes[0]?.lastIssuedAt ?? null),
    liveCodeExpiresAt: asDate(codes[0]?.liveUnusedExpiresAt ?? null),
    walkthroughAt: row.walkthroughAt,
    walkthroughDoneAt: row.walkthroughDoneAt,
    provisionedOrgId: row.provisionedOrgId,
    firstMenuAt: firstMenu,
    lostAt: row.lostAt,
    lostReason: row.lostReason,
    lastActivityAt: events[0]?.occurredAt ?? null,
  }

  const { stage, because } = deriveStage(facts, asOf)

  return {
    lead: {
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      dealershipName: row.dealershipName,
      role: row.role,
      rooftops: row.rooftops,
      dms: row.dms,
      message: row.message,
      source: row.source,
      referrer: row.referrer,
      contacted: row.contacted,
      contactedAt: row.contactedAt,
      notes: row.notes,
      walkthroughAt: row.walkthroughAt,
      walkthroughDoneAt: row.walkthroughDoneAt,
      lostAt: row.lostAt,
      lostReason: row.lostReason,
      provisionedOrgId: row.provisionedOrgId,
      createdAt: row.createdAt,
      stage,
      because,
      nextStep: nextStep(facts, asOf),
    },
    events,
    organizationName,
  }
}

export interface UpcomingWalkthrough {
  leadId: string
  dealershipName: string
  contactName: string
  walkthroughAt: Date
}

/**
 * Walkthroughs from the start of today until a week out, soonest first.
 *
 * A list rather than a count, unlike everything else on the morning read, and
 * for a stated reason: the other tiles answer "how many", this one answers
 * "when, and who" — which is the whole content of the item. A number would
 * send somebody to another page to read four words. The "Walkthroughs today"
 * tile is then counted from these rows rather than from a query of its own.
 *
 * ---------------------------------------------------------------------------
 * FROM MIDNIGHT, NOT FROM NOW
 * ---------------------------------------------------------------------------
 * A demo at nine this morning has to still be on the list at eleven. Starting
 * the window at the current instant would drop it the moment it began, which
 * on the one item with a deadline attached is the wrong direction to fail —
 * and it would take "Walkthroughs today" down with it, since that count is a
 * filter over these rows.
 *
 * Midnight where Dan is, not midnight UTC. See `src/lib/crm/founder-day.ts`.
 *
 * No stage filter. A lead that has already been provisioned still has a demo
 * in the diary at two o'clock, and the two conditions that genuinely mean
 * "there is nothing to attend" — held, or lost — are the two that are here.
 */
export async function loadUpcomingWalkthroughs(
  days = 7,
  asOf = new Date(),
): Promise<UpcomingWalkthrough[]> {
  const from = startOfFounderDay(asOf)
  const until = new Date(asOf.getTime() + days * 86_400_000)

  return withCurrentUserScope(async (db) => {
    const rows = await db
      .select({
        leadId: schema.demoRequests.id,
        dealershipName: schema.demoRequests.dealershipName,
        contactName: schema.demoRequests.name,
        walkthroughAt: schema.demoRequests.walkthroughAt,
      })
      .from(schema.demoRequests)
      .where(and(
        isNotNull(schema.demoRequests.walkthroughAt),
        isNull(schema.demoRequests.walkthroughDoneAt),
        isNull(schema.demoRequests.lostAt),
        gte(schema.demoRequests.walkthroughAt, from),
        lte(schema.demoRequests.walkthroughAt, until),
      ))
      .orderBy(schema.demoRequests.walkthroughAt)
      .limit(20)

    return rows.map((r) => ({ ...r, walkthroughAt: r.walkthroughAt! }))
  })
}

export interface JobRun {
  storeId: string
  storeName: string
  status: string
  summary: string
  quarantinedCount: number
  startedAt: Date
}

/**
 * One dealer group in full, for the tenant page.
 *
 * Returns null rather than throwing when the id does not resolve — which
 * covers both a bad uuid in the URL and, importantly, a caller who is not
 * platform staff: the RLS policies simply return no rows, and the page turns
 * that into a 404 like every other unknown id. The console does not announce
 * itself to people who should not be looking at it.
 *
 * Note what this deliberately does not fetch: a single customer, vehicle or
 * repair order. The policies would refuse anyway (migration 0016), but the
 * query does not ask, so nobody reading this file later mistakes the console
 * for something that can.
 */
export async function loadTenantDetail(organizationId: string) {
  return withCurrentUserScope(async (db) => {
    const [org] = await db
      .select({
        id: schema.organizations.id,
        name: schema.organizations.name,
        slug: schema.organizations.slug,
        lifecycleStatus: schema.organizations.lifecycleStatus,
        lifecycleChangedAt: schema.organizations.lifecycleChangedAt,
        trialEndsAt: schema.organizations.trialEndsAt,
        createdAt: schema.organizations.createdAt,
      })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, organizationId))
      .limit(1)

    if (!org) return null

    const stores = await db
      .select({
        id: schema.stores.id,
        name: schema.stores.name,
        franchiseMake: schema.stores.franchiseMake,
        state: schema.stores.state,
        laborRate: schema.stores.laborRate,
        isActive: schema.stores.isActive,
        createdAt: schema.stores.createdAt,
      })
      .from(schema.stores)
      .where(eq(schema.stores.organizationId, organizationId))
      .orderBy(schema.stores.name)

    const storeIds = stores.map((s) => s.id)

    // Sequential rather than Promise.all: one transaction is one connection,
    // so parallel queries inside a scope serialise anyway. See src/db/README.md.
    const staff = storeIds.length === 0 ? [] : await db
      .select({
        // The role row's own id, not the user's — revoking support access
        // targets one grant, and a person can hold a role at several rooftops.
        roleId: schema.userStoreRoles.id,
        storeId: schema.userStoreRoles.storeId,
        userId: schema.userStoreRoles.userId,
        name: schema.users.fullName,
        email: schema.users.email,
        role: schema.userStoreRoles.role,
        expiresAt: schema.userStoreRoles.expiresAt,
        lastSeenAt: schema.users.lastSeenAt,
      })
      .from(schema.userStoreRoles)
      .innerJoin(schema.users, eq(schema.users.id, schema.userStoreRoles.userId))
      .where(and(
        eq(schema.userStoreRoles.isActive, true),
        inArray(schema.userStoreRoles.storeId, storeIds),
      ))

    /*
      Invitations, for the go-live checklist.

      "Has the administrator we invited actually accepted?" is the first
      question of onboarding and the console could not answer it: the link is
      shown once at provisioning and then vanishes, so a tenant that never
      accepted looked identical to one that did. Read scoped — 0016 lets
      platform staff match the invitation policy, which is the same route
      `createInvitation` takes to write one.

      The token hash is deliberately not selected. It is a bearer credential
      and nothing on the page can do anything with it; re-inviting issues a
      fresh one.
    */
    const invitations = storeIds.length === 0 ? [] : await db
      .select({
        id: schema.storeInvitations.id,
        storeId: schema.storeInvitations.storeId,
        email: schema.storeInvitations.email,
        role: schema.storeInvitations.role,
        acceptedAt: schema.storeInvitations.acceptedAt,
        revokedAt: schema.storeInvitations.revokedAt,
        expiresAt: schema.storeInvitations.expiresAt,
        createdAt: schema.storeInvitations.createdAt,
      })
      .from(schema.storeInvitations)
      .where(inArray(schema.storeInvitations.storeId, storeIds))
      .orderBy(desc(schema.storeInvitations.createdAt))

    const history = await lifecycleHistory(db, organizationId)

    /*
      Onboarding progress per rooftop, next to the commercial state.

      Deliberately on the same page as billing rather than a separate screen.
      A tenant that never presents a menu is a churn certainty whatever their
      invoice says, and the two facts are only useful side by side — "paying
      and never activated" is the row worth a phone call, and it is invisible
      if the numbers live apart.
    */
    const onboarding: {
      storeId: string
      storeName: string
      progress: OnboardingProgress
      /** For the go-live checklist. Counted, never read — see below. */
      appointmentCount: number
      /** Follow-up rules on this rooftop. Zero means an empty worklist for ever. */
      cadenceRuleCount: number
    }[] = []
    for (const store of stores) {
      /*
        Count-only and privileged — see loadProgressForPlatform.

        Read under the console's own row-level security this returns zero for
        op codes, declines, roster and presentations, because migration 0016
        withholds all four from platform staff. Every tenant would report "0 of
        8 steps, never presented", which is worse than showing nothing: it
        renders plausibly and is wrong in the same direction every time.
      */
      const p = await loadProgressForPlatform(store.id)
      if (!p) continue
      /*
        One integer, on the same privileged connection and for the same
        reason. `appointments` is a dealership's own diary and 0016 withholds
        it from platform staff, so a scoped count is always zero — and the
        go-live row would read "nothing booked" for every tenant on the
        platform, which is worse than not showing it: it renders plausibly and
        is wrong in the same direction every time.
      */
      const appointmentCount = await appointmentCountFor(store.id)
      /*
        And the count that makes a silent failure visible.

        Provisioning creates the default rules now, but every tenant stood up
        before that has none — and `generateTasks` produces nothing without
        them, for ever. Their follow-up screen reads "nothing to work" rather
        than "nobody set this up", which is indistinguishable from the product
        deciding there is no work. Nothing else on this page would ever say so.
      */
      const cadenceRuleCount = await cadenceRuleCountFor(store.id)
      onboarding.push({
        storeId: store.id,
        storeName: store.name,
        progress: p,
        appointmentCount,
        cadenceRuleCount,
      })
    }

    const [billing] = await db
      .select({
        id: schema.billingAccounts.id,
        stripeCustomerId: schema.billingAccounts.stripeCustomerId,
        collectionMode: schema.billingAccounts.collectionMode,
        billingEmail: schema.billingAccounts.billingEmail,
        poNumber: schema.billingAccounts.poNumber,
        netTermsDays: schema.billingAccounts.netTermsDays,
      })
      .from(schema.billingAccounts)
      .where(eq(schema.billingAccounts.organizationId, organizationId))
      .limit(1)

    const subscription = billing
      ? (await db
          .select({
            id: schema.subscriptions.id,
            // Carried so the console can deep-link into Stripe rather than
            // re-render its billing UI — see the tenant page.
            stripeSubscriptionId: schema.subscriptions.stripeSubscriptionId,
            planKey: schema.subscriptions.planKey,
            status: schema.subscriptions.status,
            rooftopQuantity: schema.subscriptions.rooftopQuantity,
            currentPeriodEnd: schema.subscriptions.currentPeriodEnd,
            cancelAtPeriodEnd: schema.subscriptions.cancelAtPeriodEnd,
          })
          .from(schema.subscriptions)
          .where(eq(schema.subscriptions.billingAccountId, billing.id))
          .limit(1))[0] ?? null
      : null

    return {
      org, stores, staff, invitations, history, onboarding,
      billing: billing ?? null, subscription,
    }
  })
}

/** Appointments on one rooftop's books, ever. Privileged, and only a count. */
async function appointmentCountFor(storeId: string): Promise<number> {
  const db = getDb()
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.appointments)
    .where(eq(schema.appointments.storeId, storeId))
  return row?.n ?? 0
}

/**
 * Follow-up rules on one rooftop, active or not.
 *
 * Deliberately not filtered to active. A store that has switched all eight of
 * its rules off has made a decision, and nagging them about it on our console
 * would be second-guessing a setting they own. The row exists to catch stores
 * that never had any — which is every tenant provisioned before the defaults
 * arrived.
 */
async function cadenceRuleCountFor(storeId: string): Promise<number> {
  const db = getDb()
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.cadenceRules)
    .where(eq(schema.cadenceRules.storeId, storeId))
  return row?.n ?? 0
}

export type TenantDetail = NonNullable<Awaited<ReturnType<typeof loadTenantDetail>>>

/** Recent price syncs across every tenant, worst first. */
export async function loadRecentJobRuns(limit = 25): Promise<JobRun[]> {
  return withCurrentUserScope(async (db) => {
    const rows = await db
      .select({
        storeId: schema.pricingSyncRuns.storeId,
        storeName: schema.stores.name,
        status: schema.pricingSyncRuns.status,
        summary: schema.pricingSyncRuns.summary,
        quarantinedCount: schema.pricingSyncRuns.quarantinedCount,
        startedAt: schema.pricingSyncRuns.startedAt,
      })
      .from(schema.pricingSyncRuns)
      .innerJoin(schema.stores, eq(schema.stores.id, schema.pricingSyncRuns.storeId))
      .orderBy(desc(schema.pricingSyncRuns.startedAt))
      .limit(limit)
    return rows
  })
}
