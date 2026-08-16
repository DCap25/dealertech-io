# Brief: scope the SaaS backend

A prompt to hand to a model (Fable) in this repo. The output is `docs/SAAS_PLAN.md`.
This file is the input, not the deliverable — delete it once the plan exists, or
keep it as the record of what was asked for.

---

You are scoping the SaaS backend for DealerTech.io. Read the codebase before you
design anything — this is a mature repo with strong, deliberate invariants, and a
plan that violates them is worse than no plan.

## Your task

Produce a design document at `docs/SAAS_PLAN.md`, in the house style of the
existing `docs/PLAN.md` (decisions stated plainly, with the reasoning and the
rejected alternatives kept, not just the conclusion).

DO NOT WRITE IMPLEMENTATION CODE. No migrations, no route handlers, no
components. Schema is expressed as tables/columns/constraints in prose or
markdown tables; state machines as diagrams or transition tables. Another agent
builds from this document afterwards — your job is to make that build
unambiguous, not to start it.

## Read first (in this order)

1. `PROJECT_OVERVIEW.md` — the product thesis and the principles the code enforces
2. `docs/PLAN.md` — the original build plan, for voice and for decisions already locked
3. `src/db/schema/tenancy.ts` — organizations, stores, users, user_store_roles,
   platform_admins, store_invitations, audit_log
4. `src/db/schema/marketing.ts` — demo_requests (the lead table, deliberately NOT store-scoped)
5. `src/db/schema/integration.ts` — dms_connections, sync_runs, import_batches
6. `src/db/scoped.ts` and `src/db/README.md` — the RLS model and the migration ledger
7. `src/lib/invites/provision.ts` — how a tenant is stood up today
8. `src/app/signup/actions.ts` — the self-serve path
9. `src/app/admin/page.tsx` + `src/lib/platform/load.ts` — the entire admin console today
10. `src/lib/auth/session.ts` and `src/lib/auth/routes.ts` — the permission seams

## What exists today (verified, do not re-derive)

- 49 tables, 22 hand-written idempotent migrations applied through an
  `_applied_migrations` ledger. `npm run db:push` is deliberately replaced with a
  script that errors, because `drizzle-kit push` drops every RLS policy.
- Multi-tenancy: `organizations` → `stores` (rooftops) → `user_store_roles`
  (many-to-many, a person can advise at one rooftop and manage another).
- Isolation is RLS, FORCEd on every table, keyed off `auth.uid()`, entered via
  `withUserScope()`. Some paths still use the privileged `getDb()` — notably
  `MockDmsAdapter` and everything unauthenticated (device tokens, menu links,
  invites, cron).
- Tenant provisioning: `provisionTenant()` creates auth user → org → store →
  ADMIN role, with compensating deletes on failure. Two entry points: self-serve
  `/signup` and sales-led provisioning from a lead in `/admin`.
- `/admin` is the platform console. It lists tenants, leads, and price-sync runs,
  and returns 404 (not 403) to non-platform-admins so it does not announce itself.
  It is read-only apart from provisioning and marking a lead contacted.
- Staff roles: ADVISOR, BDC, TECHNICIAN, DISPATCHER, PARTS, CASHIER,
  SERVICE_MANAGER, FIXED_OPS_DIRECTOR, ADMIN.
- Scheduled work runs as a Netlify function POSTing to `/api/cron/pricing`,
  authenticated by a shared secret that refuses every request when unset.

## What does NOT exist

There are zero billing primitives. No Stripe dependency, no plan, subscription,
invoice, payment, seat, or usage table. No concept of a trial, a contract term, a
paid vs unpaid tenant, or a feature gate. `stores.is_active` is the only on/off
switch and nothing consults it for commercial reasons.

**Naming collision to avoid:** `entitlement` in this codebase means a *customer's*
prepaid maintenance visits (`src/lib/coverage/types.ts`). Do not use that word for
SaaS plan features. Find a different term and say why in the doc.

## Scope these five areas

**1. Packaging and pricing.** What do we charge for, and per what unit? Evaluate
per-rooftop, per-seat/advisor, usage-based (per RO or per presented menu), and
hybrid — against how dealerships actually buy fixed-ops software and how a fixed
ops director defends a line item. Recommend one, state the rejected alternatives
and why. Cover: dealer groups with one contract and many rooftops, pilots at a
single store, annual term with monthly billing, mid-term rooftop additions and
proration, and what happens at renewal and cancellation.

**2. Billing mechanics.** Stripe is the presumed processor — justify or replace
it. Map our objects to Stripe's (Customer, Subscription, SubscriptionItem, Price,
Meter) and say exactly which of ours is the source of truth for what. Design for:
webhook idempotency and out-of-order delivery, storing raw events, reconciliation
when Stripe and our tables disagree, dunning, and — critically — dealerships that
will not pay by card. ACH, invoicing, PO numbers, net-30/60, and W-9s are the norm
in this industry, not an edge case. Decide whether we support them at launch.

A Stripe MCP server is connected to this session. Authenticate to it and inspect
the existing account state — products, prices, customers, webhook endpoints,
whether anything has been configured at all — before designing the object mapping.
Design against what is actually there rather than against an empty account you
assumed.

**3. Feature gating and non-payment.** How does the app know what a tenant is
entitled to, and where is that enforced (route, loader, engine, or database)?
State a hard principle and design to it: **a billing problem must never break the
drive.** An advisor standing in front of a customer at 9am cannot be locked out
because a card expired. Define the degradation ladder — grace period, banner,
read-only, suspension — with the delays and who gets told at each step. This
should read like the rest of the codebase's failure handling: the cron endpoint
refuses rather than falling open; the DMS push returns `ok: false` rather than
throwing at an advisor mid-drive.

**4. Signup, configuration and onboarding.** The current signup collects
dealership name, franchise make, state, door rate, and an admin account, then
drops the user at `/team`. Design the real lifecycle: lead → trial/pilot →
paid → active → past due → suspended → churned, as an explicit state machine with
the allowed transitions and who can trigger each. Then design the configuration a
dealership must complete before the product is actually useful — labor rates, tax
rates, reauthorization thresholds, quiet hours, op-code mapping, DMS connection,
historical data import (`import_batches` exists and is unused) — and say which
steps are blocking, which are nags, and how we measure whether a tenant ever
reached value. Cold start is the launch risk: prep sheets are worthless without
service history.

**5. The admin panel.** Specify what DealerTech staff need that the current
console does not have: tenant detail pages, subscription and payment state,
lifecycle actions (extend trial, comp an account, suspend, reactivate), usage and
health per tenant, sync and job observability, impersonation or support access,
and lead → tenant conversion. Two hard constraints: the console must keep its
property of not reaching a dealership's customer data without a role that leaves a
row behind, and every state-changing action must land in `audit_log`. Specify the
information architecture and the permission model, including whether
`platform_admins` needs to become more than one flag.

## Constraints you must respect

- **RLS is the isolation boundary.** For every table you propose, state its RLS
  posture: is it store-scoped, org-scoped, or platform-only? Which policies? What
  reads it, under which role? Billing data is org-scoped, not store-scoped —
  work out what that means for a dealer group and for `auth.uid()` policies.
- **Migrations are hand-written and idempotent**, applied through the ledger.
  Number them from 0020. Never propose `db:push`.
- **Deny by default**, everywhere. New routes are protected unless explicitly
  listed public. Secrets absent means refuse, not fall open.
- **Pure engines, thin screens.** Anything that decides something (proration,
  gating, lifecycle transitions) belongs in `src/lib/` as I/O-free, unit-tested
  functions the UI and the cron job both call. There are 786 passing tests and
  every engine has one; say what tests each new engine needs.
- **Bearer credentials have one shape here**: 32 random bytes, SHA-256 at rest,
  raw value never persisted. Match it if you introduce any.
- `.env.local` points at the production Supabase database. Any plan involving data
  backfill must say so and be safe under that fact.

## Deliverable

`docs/SAAS_PLAN.md`, structured as:

1. Recommendation summary — the packaging and billing model in one page
2. Decisions locked, with rejected alternatives and why
3. Data model — new tables, columns, constraints, indexes, RLS posture each
4. Lifecycle state machines — tenant, subscription, and their interaction
5. Engines — what goes in `src/lib/`, function signatures, test obligations
6. Stripe integration — object mapping, webhook set, idempotency, reconciliation
7. Admin panel — IA, permission model, audit obligations
8. Onboarding — required configuration, blocking vs non-blocking, activation metric
9. Migration and rollout plan — including what happens to tenants that already exist
10. **Open questions for Dan** — every decision that is a business call rather than
    a technical one, stated as a specific question with the options and your
    recommendation. Do not silently pick a price point or a contract term.
11. Phased build order — what ships first, what each phase is worth on its own,
    and what can be deferred without painting us into a corner

Be opinionated and concrete. Where you are guessing about how dealerships buy
software, say that you are guessing and mark it for Dan. The worst outcome is a
document that reads as confident everywhere and is quietly wrong about the
commercial model.
