# DealerTech.io — SaaS Backend Plan

**Scope:** packaging and pricing, billing mechanics, feature gating, tenant
lifecycle and onboarding, and the platform admin console. Designed against the
codebase as it stands (49 tables, migrations 0000–0021, RLS as the isolation
boundary) and against the *actual* Stripe account state, inspected live on
2026-08-16 — not an assumed empty account.

This is a design document. Schema is stated as tables and constraints, state
machines as transition tables. No implementation code here; the build works
from this document.

A correction to the brief that produced this document: migrations run through
**0021** (`0021_close_the_write_side_of_rls.sql`), not 0019. New migrations
start at **0022**.

---

## 1. Recommendation summary

**Charge per rooftop, per month, on an annual term. One plan. Stripe is the
billing engine for both rails — card via Checkout for self-serve, invoice/ACH
with net terms for sales-led — so there is one lifecycle pipeline, not two.**

- **Unit: the rooftop** (`stores` row). A fixed ops director budgets per
  rooftop; every tool they already buy — Xtime, myKaarma, inspection software —
  is a per-rooftop line item they defend against the department's gross. Seats
  are unlimited, deliberately: the product's value compounds with every advisor,
  BDC rep and technician in it, and a seat price is a tax on the adoption that
  makes the data good.
- **Contract at the organization.** A dealer group signs once; rooftops are
  quantity on one subscription. Volume pricing by rooftop count, mirroring how
  The DAS Board already tiers (1–2, 3–10, 11–25, 26+) — the sales conversation
  Dan already knows how to have.
- **30-day pilot per organization, no card required.** Sales-led reality: the
  person approving a pilot is not holding the corporate card. Self-serve signup
  starts the same trial automatically.
- **Billing state never breaks the drive.** Non-payment degrades through an
  explicit ladder — grace, restricted, suspended — computed by a pure engine,
  and automatic degradation stops one rung short of lockout. Suspension is a
  human decision that leaves an audit row, never a webhook's side effect.
- **Access is ours; money is Stripe's.** Our `organizations.lifecycle_status`
  is the single source of truth for what a tenant can do. Stripe is the source
  of truth for what they owe and have paid. Webhooks and a nightly
  reconciliation move signals from the second to the first; nothing ever moves
  the other way except subscription creation and quantity changes.
- **Dedicated Stripe account.** DealerTech bills from its own Stripe account
  (`acct_1U57SyKD1OmZb0LX`, created 2026-08-16) under the same login as The
  DAS Board. Own keys, own webhook stream, own catalog, own balance, own
  DEALERTECH statement descriptor — the webhook cross-talk hazard a shared
  account would have carried never comes into existence. See §6.

---

## 2. Decisions locked, with the alternatives that lost

**Per-rooftop, not per-seat.**
Per-seat was rejected because it inverts the product's incentives. Prep sheets
get better with every technician entering measurements and every BDC rep
logging outcomes; a seat price teaches the store to share logins or leave the
techs out, and either one starves the engines. It also creates the worst
renewal conversation in software — "you grew, pay more" — with a buyer who
measures everything per rooftop. The DAS Board sells seats because its user *is*
the individual manager; DealerTech's user is the department.

**Per-rooftop, not usage-based.**
Per-RO or per-presented-menu metering was rejected on three grounds. A fixed
ops director cannot budget a variable line item and will discount the product
for that uncertainty. Our own counter becomes a disputed invoice — "you charged
us for 1,412 ROs, the DMS says 1,380" — which is precisely the
price-that-doesn't-match-the-invoice failure this product exists to kill,
committed by us against our own customer. And metering drags Stripe Meters,
usage records and estimation into the build for no revenue we cannot get from
a flat price. Usage data still gets collected — it is the health signal in §5
and §8 — it just isn't the price.

**Hybrid (base + usage) — deferred, not rejected.**
If enterprise groups later demand alignment, a per-rooftop base with a usage
kicker can be added as a new plan without schema change (the plan catalog is
data). Not at launch; complexity now, revenue later.

**One plan at launch, not Core/Pro tiers.**
Feature tiers were rejected for launch because there is no second-tier feature
list worth defending yet — the product is one integrated workflow, and holding
back, say, the coverage engine from a cheaper tier guts the demo. The
capability system (§4) ships anyway, as a seam: it gates lifecycle states at
launch and can gate plan tiers later without touching call sites.

**Annual term, billed monthly, as the default sales motion.**
Dealerships sign annual software agreements; monthly invoices keep the line
item small enough to sit inside a department budget. Month-to-month exists for
self-serve, at list price. Mid-term rooftop additions are a quantity bump with
standard Stripe proration; removals take effect at renewal (no mid-term
refunds — stated in the order form, not enforced by code). Cancellation =
`cancel_at_period_end`; access runs to the paid-through date, then the
lifecycle engine moves the tenant to CHURNED.

**Stripe, confirmed rather than presumed.**
Dan's sibling account already runs live subscription billing for The DAS
Board (14 products, a production webhook, card-collection subscriptions with
trials) — DealerTech gets its own account (§6.0), but the operational track
record is the same person's.
Dan's operational knowledge, the dashboard, and the dunning machinery are
already paid for. The only serious alternative for the invoice/net-terms rail
was a standalone AR process (QuickBooks + manual dunning); rejected because it
forks the lifecycle pipeline in half — every state in §4 would need two
implementations. Stripe Invoicing with `collection_method: send_invoice` keeps
ACH, net-30, and PO-numbered invoices inside the same subscription objects and
the same webhook stream.

**"Capability", not "entitlement".**
`entitlement` already means a customer's prepaid maintenance visits
(`src/lib/coverage/types.ts`), and overloading it would make half the coverage
engine read as billing code. `capability` is the word the codebase already
uses for "what a thing is allowed to do" (`DmsCapabilities`, honest and
consulted by the UI) — plan capabilities extend a precedent instead of
colliding with one.

**Support access leaves a row; there is no invisible impersonation.**
Re-affirmed from the existing design rather than newly decided. The admin
console gains lifecycle powers but still cannot read a dealership's customers;
reaching them requires a granted, time-boxed store role, which is a
`user_store_roles` row and an `audit_log` entry. See §7.

---

## 3. Data model

All new tables are created in migration **0022** (tables + grants + policies),
idempotent, applied through the ledger. Money amounts follow the existing
convention (`numeric`, dollars) except where a value mirrors Stripe, which is
stored as Stripe sends it (integer cents) and labelled `_cents` to make the
unit impossible to miss.

RLS posture summary, because it is the part that must not be improvised:

| Table | Scope | Tenant read | Tenant write | Platform read |
|---|---|---|---|---|
| `billing_accounts` | org | org billing roles | never (server actions via privileged path) | yes |
| `subscriptions` | org | org billing roles | never | yes |
| `subscription_changes` | org | org billing roles | never | yes |
| `lifecycle_events` | org | org billing roles | never | yes |
| `stripe_events` | platform-only | never | never | yes |
| `onboarding_steps` | store | store staff | store managers | yes |

“Org billing roles” = a user holding `ADMIN`, `SERVICE_MANAGER` or
`FIXED_OPS_DIRECTOR` at **any active store in the organization**. This is the
codebase's first org-scoped policy; the policy body is an `EXISTS` over
`user_store_roles` joined to `stores` on `organization_id`, keyed off
`auth.uid()` as everywhere else. Platform read follows the migration-0016
pattern (a policy granting `platform_admins` holders SELECT), because the
admin console runs on the scoped connection and must see billing without being
able to see customers.

Billing **writes** never come from a tenant session. They come from the
webhook handler, the reconciliation cron, and platform-admin server actions —
all legitimately on the privileged `getDb()` path ("no user is the subject" /
"platform bootstrap"), and each new call site gets the comment
`src/db/README.md` demands, naming its row in that file's table. That table
itself gains a row: *webhook handlers authenticated by provider signature*.

### 3.1 `billing_accounts` — one per organization

The commercial identity of a dealer group. Created lazily: the first time a
trial converts or a platform admin attaches billing.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `organization_id` | uuid, unique, FK organizations, cascade | one account per org |
| `stripe_customer_id` | text, unique, nullable | null until first Stripe contact |
| `collection_mode` | enum `CARD` \| `INVOICE` | which rail; see §6 |
| `billing_email` | text | invoices and dunning go here, not to the admin who signed up |
| `billing_name` | text nullable | legal entity name if it differs from the org |
| `po_number` | text nullable | echoed onto every Stripe invoice via custom fields |
| `net_terms_days` | integer nullable | null for CARD; 30/45/60 for INVOICE |
| `tax_exempt` | boolean default false | some dealer groups are; feeds Stripe customer tax status |
| `notes` | text nullable | platform-facing |
| `created_at` / `updated_at` | timestamptz | |

**Not stored here:** card numbers, bank accounts, anything PCI. Stripe holds
payment instruments; we hold the pointer.

### 3.2 `subscriptions` — the local mirror

Mirror, not master. Every row corresponds to a Stripe subscription; columns are
denormalised from Stripe by the webhook/reconciler so pages never call the
Stripe API to render.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `billing_account_id` | uuid FK, cascade | |
| `stripe_subscription_id` | text unique nullable | null only for `plan_key = 'COMPED'` |
| `plan_key` | text | resolves against the code-defined plan catalog (§5) |
| `status` | enum `TRIALING` \| `ACTIVE` \| `PAST_DUE` \| `CANCELED` \| `COMPED` | Stripe's vocabulary plus ours |
| `rooftop_quantity` | integer | what we believe we are billing for |
| `current_period_end` | timestamptz nullable | |
| `cancel_at_period_end` | boolean default false | |
| `trial_ends_at` | timestamptz nullable | |
| `created_at` / `updated_at` | timestamptz | |

**Invariant, checked by the reconciler nightly:** `rooftop_quantity` must equal
the count of active stores in the org. Drift in either direction goes on the
admin console's needs-attention list rather than being silently corrected —
a store deactivated mid-dispute and a store added without a quantity bump are
both conversations, not data errors.

### 3.3 `subscription_changes` — append-only commercial history

Who changed what, commercially: plan, quantity, trial extension, comp, cancel.
One row per change with `changed_by_user_id` (null = system), old/new values as
JSON text, and a `reason` the UI requires for human-initiated changes. This is
the billing analogue of `audit_log` and every write here also writes
`audit_log` (`entity_type = 'subscription'`).

### 3.4 `organizations.lifecycle_status` + `lifecycle_events`

Migration 0022 adds to `organizations`:

| Column | Type | Notes |
|---|---|---|
| `lifecycle_status` | enum, see §4 | default `TRIAL` for new, backfilled per §9 |
| `lifecycle_changed_at` | timestamptz | |

`lifecycle_events` is the append-only record of every transition: org id, from,
to, actor (`SYSTEM` \| `WEBHOOK` \| `RECONCILER` \| `PLATFORM_ADMIN`),
`actor_user_id` nullable, `reason` text, `created_at`. Same
revoked-never-deleted philosophy as `platform_admins`.

### 3.5 `stripe_events` — raw webhook ledger, platform-only

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `stripe_event_id` | text **unique** | the idempotency key; `ON CONFLICT DO NOTHING` |
| `event_type` | text | |
| `livemode` | boolean | test events must be visibly test |
| `payload` | text | raw JSON, exactly as received |
| `relevant` | boolean | false = carried `metadata.app ≠ dealertech`; stored anyway, skipped |
| `processed_at` | timestamptz nullable | null = received, not yet applied |
| `error` | text nullable | processing failure, for replay |
| `created_at` | timestamptz | |

No tenant policy at all — FORCE RLS with platform-only SELECT. Raw payloads
carry billing detail no tenant should see.

### 3.6 `onboarding_steps` — store-scoped setup progress

One row per store per step key (`LABOR_RATE`, `TAX_RATES`, `REAUTH_THRESHOLDS`,
`QUIET_HOURS`, `TEAM_INVITED`, `OP_CODE_MAPPING`, `DMS_CONNECTED`,
`HISTORY_IMPORTED`, `FIRST_MENU_PRESENTED`), with `status`
(`PENDING`/`DONE`/`SKIPPED`), `completed_at`, `completed_by_user_id`. Step keys
live in code; the table records progress, so adding a step is a code change,
not a migration. Store-scoped RLS identical to every other store table.
`FIRST_MENU_PRESENTED` is written by the system, not tickable by a human — it
is the activation metric (§8) and lying to it would only lie to us.

---

## 4. Lifecycle state machines

### 4.1 Organization lifecycle — the single source of truth for access

```
LEAD ──provision──▶ TRIAL ──convert──▶ ACTIVE ◀──recover── PAST_DUE
                      │                  │  ▲                 │
                      │ expire           │  └──resolve──┐     │ ladder (14d)
                      ▼                  ▼              │     ▼
                   EXPIRED           CANCELED*       RESTRICTED
                      │                                 │
                      └──convert──▶ ACTIVE   suspend────▼──── (platform only)
                                                    SUSPENDED ──▶ CHURNED
COMPED: enterable from any live state by a platform admin; behaves as ACTIVE.
* CANCELED = cancel_at_period_end reached; terminal path to CHURNED after 30d.
```

LEAD is not a database state — it is a `demo_requests` row, as today.

| From | To | Trigger | Actor |
|---|---|---|---|
| — | TRIAL | provisioning (self-serve or sales-led) | system |
| TRIAL | ACTIVE | subscription becomes active (first payment or invoice issued) | webhook |
| TRIAL | EXPIRED | `trial_ends_at` passed, no subscription | reconciler |
| TRIAL | TRIAL | trial extended (`trial_ends_at` moved) | platform admin |
| EXPIRED | ACTIVE | late conversion | webhook |
| ACTIVE | PAST_DUE | `invoice.payment_failed` / invoice past due | webhook |
| PAST_DUE | ACTIVE | `invoice.paid` | webhook |
| PAST_DUE | RESTRICTED | 14 days past due | reconciler |
| RESTRICTED | ACTIVE | payment resolves | webhook |
| RESTRICTED | SUSPENDED | human decision, reason required | **platform admin only** |
| SUSPENDED | ACTIVE | human decision | platform admin |
| ACTIVE | CANCELED | period end reached with `cancel_at_period_end` | webhook |
| CANCELED / SUSPENDED / EXPIRED | CHURNED | 30 days in state | reconciler |
| any live state | COMPED | comp granted, reason required | platform admin |
| CHURNED | TRIAL | win-back re-provisioning | platform admin |

Illegal transitions throw in the pure engine — there is no
`UPDATE organizations SET lifecycle_status` anywhere except the one function
that also writes `lifecycle_events`.

**The hard principle, and the one deliberate deviation from deny-by-default.**
Everywhere else in this codebase, a missing configuration refuses (the cron
secret, the price book). Access gating inverts that on purpose: an ACTIVE
organization with a missing or contradictory billing record resolves to **full
access, plus a loud row on the platform console**. The cost asymmetry is
reversed here — a cron endpoint falling open lets a stranger run jobs, but
access falling closed locks an advisor out at 9am over our own bookkeeping.
Fail open for the drive, fail loud to us. Stated here so nobody "fixes" it.

### 4.2 The degradation ladder

Computed from `(lifecycle_status, days_in_status)` by the pure engine; nothing
reads billing tables at render time.

| Level | Who sees what | Enforced where |
|---|---|---|
| `FULL` | everything | — |
| `GRACE` (PAST_DUE, days 0–14) | everything; banner to ADMIN / SERVICE_MANAGER / FIXED_OPS_DIRECTOR only. Advisors see nothing — the drive is not the place to learn about a card. | layout banner |
| `RESTRICTED` (day 14+) | drive, prep sheets, presentation, follow-up all work. Blocked: team invites, data export, DMS connection changes, new-store provisioning. Banner to all managers: "billing needs attention". | action guards |
| `SUSPENDED` (human only) | read-only: records viewable, no writes, no presentations. Sign-in works and says why. | access seam |
| `EXPIRED` trial | same as SUSPENDED plus a self-serve convert path | access seam |
| `CHURNED` | sign-in works, data export works (their data is theirs), nothing else | access seam |

Notifications at each automatic transition go to `billing_email` plus every
org billing-role holder — through the existing prompt-only mechanics (no SMS,
v1 rule stands).

Enforcement lives at **one seam**: `getSession()` already loads the active
store; it additionally resolves the org's access level once per request
(cached like the session), and `requireAccess(level)` guards the handful of
restricted actions the way `requireUser()` guards pages. RLS is deliberately
NOT the enforcement point — billing state is commercial, not a tenant-isolation
boundary, and encoding it in policies would make every past-due tenant look
like a security incident.

Scheduled jobs consult the same engine: the pricing sync skips SUSPENDED and
CHURNED tenants (logged, not silent), keeps running for everything else —
a store that recovers on day 20 should not come back to a stale price book.

---

## 5. Engines — pure, in `src/lib/`, tested like the others

**`src/lib/billing/plans.ts`** — the plan catalog as data. Plan key, display
name, per-rooftop monthly cents by volume band (1–2, 3–10, 11–25, 26+ —
bands mirror The DAS Board's), trial days, Stripe price `lookup_key` per band.
Prices also exist in Stripe; the catalog binds them by `lookup_key` (the
existing DAS Board prices don't use lookup keys — ours all do, so code never
holds a `price_...` id).

**`src/lib/billing/lifecycle.ts`**
- `transition(current, event, asOf) → { next, effect } | IllegalTransition` —
  the whole §4.1 table, data-driven.
- Tests: every legal transition, every illegal one, the 14-day and 30-day
  clocks (boundary days exactly), COMPED from each live state.

**`src/lib/billing/access.ts`**
- `resolveAccess(status, statusChangedAt, asOf) → { level, blockedActions, banner: { audience, message } | null }`
- Tests: the full ladder, grace boundary at exactly day 14, the fail-open
  branch for missing billing state, CHURNED export-only.

**`src/lib/billing/proration.ts`**
- `quantityFor(activeStoreCount)`, `bandFor(quantity)`,
  `previewChange(sub, newQuantity, asOf)` — our own arithmetic for the admin
  UI's "this will change the invoice by X" preview. Stripe's proration is
  authoritative at invoice time; this must agree with it, and a test pins the
  agreement for the standard cases (mid-period add, band crossing).

**`src/lib/billing/stripe-map.ts`**
- Pure translation between Stripe event/subscription payloads and our mirror
  columns, including `isOurs(object) → boolean` (the metadata namespace
  check). Tests: fixture payloads for every subscribed event type, foreign
  (DAS Board) payloads rejected, malformed metadata rejected.

**`src/lib/billing/reconcile.ts`**
- `diff(localSub, stripeSub, activeStoreCount) → Discrepancy[]` — status
  drift, quantity drift, period-end drift; each tagged auto-fixable or
  needs-human. Tests: each drift class, the no-drift case, COMPED (no Stripe
  counterpart, never a discrepancy).

**`src/lib/onboarding/steps.ts`**
- Step definitions, `blocking | nagging | measured` classification, and
  `progress(storeState) → { done, next, activated }`. Tests: each step's
  completion predicate against fixture store states.

I/O wrappers (`load.ts`, webhook handler, cron runner) stay thin, follow the
existing pattern, and hold no decisions. All of them live on the privileged
path with the mandated README comment; none opens a transaction inside
`withUserScope` (pool is `max: 1` — a nested transaction is a deadlock, not a
slow query).

---

## 6. Stripe integration

### 6.0 The accounts, as they actually exist (inspected 2026-08-16, live mode)

**DealerTech's own account is `acct_1U57SyKD1OmZb0LX`** — created for this
plan, empty, activation pending (EIN, bank, DEALERTECH descriptor are a
dashboard task before the first live charge; test mode works immediately).
Everything DealerTech builds targets this account and only this account.

The sibling account `acct_1RPqKcCFEHXBg4hU` ("The DAS Board") was inspected
as precedent — it is not empty and not dormant:

- **14 active products / 27 active prices**, all DAS Board: four dealership
  tiers ($579 / $499 / $449 / $399 per month by group size), seat add-ons
  ($5–$25), bundles, plus one-time variants of each.
- **One production webhook**: `https://thedasboard.com/api/stripe-webhook`,
  subscribed to `checkout.session.completed`, `customer.subscription.*`,
  `setup_intent.succeeded`, `invoice.paid`, `invoice.payment_failed`.
- **Live subscriptions exist** (a trialing $579 dealership-tier sub among
  them). Card-only; **no ACH configured or in use anywhere**. Trials of 14–30
  days with `end_behavior: create_invoice`.
- Newer DAS Board objects carry a metadata namespace (`das_board_product`,
  `das_board_price`, `config_key`); older ones and subscriptions use ad-hoc
  metadata (`tier`, `signupRequestId`). No `lookup_key` anywhere.
- DAS Board's flow creates a **new one-off product and price per signup**,
  then deactivates the price. DealerTech will not copy this: fixed catalog,
  `lookup_key`-bound, so reporting doesn't fragment across hundreds of
  single-use products.

### 6.1 What the dedicated account settles, and what it still requires

The account split dissolves the hazards a shared account would have carried:
no webhook cross-talk (each account has its own event stream — The DAS
Board's handler never sees a DealerTech event, and vice versa), the
account-level statement descriptor simply says DEALERTECH, and the two
businesses' financials never mix. What remains:

1. **Activation before the first live charge.** Business details, EIN, bank
   account, DEALERTECH descriptor — a dashboard task, on the pre-launch
   checklist (§9). Test mode needs none of it.
2. **Restricted API key anyway.** The deployment gets a **restricted key**
   (customers, subscriptions, invoices, checkout, billing portal, prices —
   read/write as needed; everything else denied), never the account secret
   key. The blast-radius argument is smaller now but the habit is the same
   one every other secret in this codebase follows. Refuse-when-unset.
3. **Metadata namespace, demoted to hygiene.** `metadata.app = "dealertech"`
   and `metadata.organization_id` still go on every object — no longer
   load-bearing for event filtering, still the thing that makes any future
   audit, export, or migration unambiguous. `isOurs()` stays in the handler
   as a cheap invariant check rather than a survival mechanism.

### 6.2 Object mapping and sources of truth

| Ours | Stripe | Source of truth |
|---|---|---|
| `billing_accounts` | Customer | ours for identity/terms; Stripe for payment instruments |
| `subscriptions` (mirror) | Subscription | **Stripe**, mirrored by webhook + reconciler |
| plan catalog (code) | Product + Prices via `lookup_key` | ours for shape; Stripe for the billed amount |
| `organizations.lifecycle_status` | — | **ours**, exclusively; Stripe is an input |
| rooftop count | Subscription item quantity | **ours** (active stores); pushed to Stripe on change |
| invoices, dunning, receipts | Invoice | Stripe entirely; we deep-link, never re-render |

Every Customer, Subscription and Checkout Session we create carries
`metadata.app = "dealertech"` and `metadata.organization_id = <uuid>`.
Products/prices carry `metadata.app` as well.

Card rail: Checkout Session (mode `subscription`) → Billing Portal for
self-service card updates. Invoice rail: same subscription objects with
`collection_method: send_invoice`, `days_until_due` from `net_terms_days`, PO
number as an invoice custom field; Stripe emails the invoice with its hosted
pay page (card or ACH debit). **Enabling ACH debit in the account is a
pre-launch dashboard task — it is not on today.** W-9: our static document,
linked from the admin console; nothing to build.

### 6.3 Webhooks

New endpoint `POST /api/webhooks/stripe`, added to the public prefixes exactly
as `/api/cron` was — public in the routing sense only. Guard: Stripe signature
verification against a dedicated endpoint secret; unset secret refuses every
request. Same doctrine, new authenticator.

Subscribed events: `checkout.session.completed`,
`customer.subscription.created|updated|deleted`, `invoice.paid`,
`invoice.payment_failed`, `invoice.marked_uncollectible`.

Processing, in order, per delivery:
1. Verify signature. 2. Insert into `stripe_events`
   (`ON CONFLICT (stripe_event_id) DO NOTHING`; conflict → 200, done — retries
   and duplicates die here). 3. `isOurs()` invariant check — an object without
   our metadata should be impossible in a dedicated account; mark
   `relevant = false`, alert, 200. **4. Re-fetch the subscription from Stripe
   and mirror from the fetch, not the event payload** — out-of-order delivery
   is solved by never trusting event ordering; the fetch is current by
   definition. 5. Feed the pure lifecycle engine; apply any transition.
   6. Mark processed; on error, record and return 500 so Stripe retries.

### 6.4 Reconciliation and dunning

Nightly reconciler (new cron route, `CRON_SECRET` pattern, wired into the
existing scheduled-function setup): for each org with a Stripe subscription,
fetch, `diff()`, auto-fix the mechanical drifts (mirror columns), surface the
judgment ones (quantity vs active stores, status contradictions) on the
platform console. Also advances the day-14 and day-30 clocks of §4. Failure
mode matches the pricing sync: refusal is a correct outcome, `needsAttention`
in the body, 200.

Dunning: Stripe Smart Retries + its reminder emails do the mechanical chasing
on both rails. Our ladder consumes the outcomes; we do not build retry logic.

---

## 7. The platform admin console

Today `/admin` is one page: tenants, leads, sync runs, provisioning. It grows
into a small console with the same spine and both hard constraints intact:
**no path to a dealership's customer data without a granted store role that
leaves a row**, and **every state-changing action writes `audit_log`**.

Information architecture:

- **`/admin`** — the morning read. Needs-attention rollup: past-due and
  restricted tenants, reconciler discrepancies, failed webhook processing,
  stale syncs, trials expiring within 7 days, uncontacted leads. Everything
  links into a tenant.
- **`/admin/tenants`** — list with lifecycle status, plan, rooftops, MRR
  (computed from the catalog — no Aggregate-of-Stripe calls to render a page),
  activation state, last sync.
- **`/admin/tenants/[orgId]`** — the tenant page, four blocks:
  *Commercial* — lifecycle history (`lifecycle_events`), subscription mirror,
  deep links into the Stripe dashboard for invoices and payment state (we
  never re-render Stripe's UI).
  *Operational* — stores, staff counts, pending invites, sync and job health,
  onboarding progress per store, activation metric.
  *Actions* — extend trial (days + reason), comp (reason), convert to paid
  (starts Checkout or creates the invoice-rail subscription), change quantity
  (with `previewChange` shown), suspend (reason, RESTRICTED-only precondition),
  reactivate, cancel at period end, begin win-back. Every one is a server
  action: platform-admin check → pure engine → `lifecycle_events` +
  `subscription_changes` + `audit_log` (`store_id` null, `entity_type`
  `'organization'`/`'subscription'`) → Stripe call where applicable.
  *Support access* — grant self or a colleague a named role at a named store
  for a fixed term (default 24h): writes `user_store_roles` with an expiry
  the session loader enforces, plus `audit_log`. Visible to the dealership on
  their own `/team` page — by design.
- **`/admin/leads`** — today's list, plus convert-to-trial (invokes the
  existing sales-led provisioning) and manual outcome notes.

Permission model: `platform_admins` stays a single flag for now — the honest
description of a company whose entire platform staff is Dan. What changes:
every console mutation is audited (the grant/revoke ledger already exists;
actions now match it), and the seam for finer roles later is one nullable
`role` column on `platform_admins` plus checks in the actions — deliberately
not built until a second human exists. 404-for-strangers behaviour is
unchanged and extends to every new `/admin` route.

---

## 8. Onboarding and activation

Lifecycle answers "may they use it"; onboarding answers "can it help them yet".
Two different questions, deliberately separate tables.

**Blocking at signup (already true, kept):** dealership name, franchise make
from the known list, state, door rate, admin account. Nothing new becomes
blocking — every additional blocking field costs signups and nothing else on
the list is needed before first render.

**Nagged, per store, via `onboarding_steps` and a checklist panel:** tax
rates, reauth thresholds (the defaults are legally conservative zeros — the
nag is "set these with your own advice", not "we picked for you"), quiet
hours, team invited, op-code mapping / price book, DMS connection **or**
history import.

**The cold-start step is the launch-critical one.** `import_batches` exists
and nothing writes to it; the CSV import of service history and declined
services gets built in Phase D (§11) and its completion is the
`HISTORY_IMPORTED` step. A prep sheet over an empty history is a menu of
guesses — the engines already degrade honestly (unverified intervals, LOW
confidence), but honest-and-empty does not sell a renewal.

**Activation metric — one number:** *days from provisioning to first customer
menu presented* (first presentation-session row, any of the three routes;
recorded as `FIRST_MENU_PRESENTED`, system-written). Secondary health signals
on the tenant page, not targets: prep sheets viewed per appointment-day,
menus presented per week, distinct active staff per week. A tenant that never
presents a menu is a churn certainty regardless of what the invoice says —
the console shows activation next to billing status for exactly that reason.

---

## 9. Migration and rollout

Numbering continues from the actual ledger head:

- **0022** — billing core: enums, `billing_accounts`, `subscriptions`,
  `subscription_changes`, `lifecycle_events`, `stripe_events`,
  `organizations.lifecycle_status` (+ `lifecycle_changed_at`), grants,
  policies (org-scoped tenant read where stated, platform read, FORCE RLS,
  write-side closed per the 0021 pattern).
- **0023** — `onboarding_steps` + policies.
- **0024** — backfill: every existing organization gets
  `lifecycle_status = 'COMPED'` and a `lifecycle_events` row
  (`actor = 'SYSTEM'`, reason `'pre-billing backfill'`). COMPED, not TRIAL —
  nothing existing may degrade, and the statuses get corrected by hand from
  the console afterwards.

`.env.local` points at production, so 0022–0024 land in production the moment
`db:apply` runs locally — that is how every migration here has shipped, and
these are written to be safe under it: additive DDL, no destructive statements,
idempotent, and the backfill grants access rather than removing any. The write
path (webhook → lifecycle) gets exercised end-to-end against the throwaway
Docker database (`db:test:up` + Stripe test clocks + CLI event forwarding)
before the endpoint secret is ever set in production — per the README, that is
the only safe way to exercise a write path.

Rollout order gates risk: schema first (inert), engines + tests, admin console
reading real lifecycle state, then the webhook endpoint in test mode, then
account activation (EIN, bank, DEALERTECH descriptor — §6.1 item 1), then
live restricted keys, ACH enablement, and the first real Checkout — with
`stripe_events` watched for processing errors and any `relevant = false`
surprises during the first week.

New environment variables, all refuse-when-unset:
`STRIPE_SECRET_KEY` (restricted key on the DealerTech account,
`acct_1U57SyKD1OmZb0LX`), `STRIPE_WEBHOOK_SECRET`.

---

## 10. Open questions for Dan

Business calls, not technical ones. Each has a recommendation; none is decided
by this document, and the schema absorbs any answer.

1. **Price point.** Per-rooftop monthly, by band. The DAS Board tops out at
   $579/rooftop; DealerTech replaces more of the workflow and drives measurable
   gross recovery, and fixed-ops tools in this space (Xtime, myKaarma tiers)
   sit roughly at $1,000–$2,500/rooftop/month — *that range is a market guess,
   not research; validate it against the design-partner conversations.*
   My placeholder for modelling: **$1,195 / $995 / $895 / $795** by band.
   Nothing anywhere hardcodes it; it lives in the catalog and in Stripe.
2. **Annual commitment: required or preferred?** Recommendation: required for
   the invoice/net-terms rail, optional (month-to-month at list) for
   self-serve card. Sales-led buyers expect a term; self-serve buyers bounce
   off one.
3. **Card required to start a self-serve trial?** Recommendation: no —
   matches the sales motion, costs some tire-kickers, and the EXPIRED state
   plus console visibility handles them. Yes would double self-serve
   conversion mechanics but suppress signups.
4. **Trial length.** Recommendation: 30 days (DAS Board's own dealership-tier
   trial is 30). Extensions are a console action with a reason, so 30 is a
   default, not a cap.
5. **Net terms offered at launch.** Recommendation: net-30 only, ACH debit
   strongly preferred, checks not supported (a check has no webhook — it
   would fork the pipeline §1 exists to keep whole). Net-45/60 by exception,
   set per `billing_accounts` row.
6. **Who signs — org or rooftop?** This plan assumes **org signs, rooftops are
   quantity**. If real deals arrive rooftop-by-rooftop with separate P&Ls
   wanting separate invoices, the model bends (one subscription per store,
   `billing_account` still org-level) — say so before Phase B, not after.
7. **Discount authority.** Stripe coupons per subscription, recorded in
   `subscription_changes` with a reason. Is any discount standing (multi-year,
   design partner), and what is the floor?
8. **Design-partner terms.** Recommendation: COMPED status + a named
   `subscription_changes` reason, so the console always shows exactly what is
   being given away and to whom. Free-forever handshakes with no record are
   how comps outlive their justification.
9. ~~The DAS Board webhook handler verification~~ and
   ~~separate Stripe account, revisited once~~ — **both resolved 2026-08-16**:
   Dan created a dedicated DealerTech account (`acct_1U57SyKD1OmZb0LX`), which
   makes cross-talk impossible and the account question moot. What replaces
   them: **activate the DealerTech account** (business details, EIN, bank,
   DEALERTECH statement descriptor) before the first live charge. Test mode
   works today.

---

## 11. Phased build order

Each phase ships something worth having on its own; nothing later repaints an
earlier decision.

**Phase A — lifecycle without money.**
Migrations 0022–0024, `lifecycle.ts` + `access.ts` engines with full tests,
session seam resolving access, degradation banners, cron skip behaviour,
tenant list + tenant page (commercial block minus Stripe links), lifecycle
actions (trial/extend/comp/suspend/reactivate), support-access grants,
audited throughout. *Worth alone:* pilots and comps become managed, visible,
and audited instead of tribal. Nothing bills, so nothing can bill wrongly.

**Phase B — the card rail.**
Plan catalog + Stripe products/prices (namespaced, lookup keys), restricted
key, webhook endpoint + `stripe_events` + `stripe-map.ts`, Checkout
conversion from trial (self-serve and console-initiated), Billing Portal,
reconciler, account activation, test-clock suite for the full
trial→active→past-due→recovered arc. *Worth alone:* self-serve revenue
end-to-end, and every later rail reuses this pipeline unchanged.

**Phase C — the invoice rail and the ladder in anger.**
`send_invoice` subscriptions, net terms, PO custom fields, ACH enablement,
dunning-driven PAST_DUE→RESTRICTED automation with its notifications,
`proration.ts` + quantity management (add-a-rooftop) with preview. *Worth
alone:* the way dealerships actually pay, which is the way DealerTech actually
gets bought.

**Phase D — onboarding and activation.**
`onboarding_steps` + checklist UI, the CSV history importer over
`import_batches` (the cold-start fix — largest single work item in this plan
and the one with the most product risk), activation metric wired to the
console, trial-expiry nag flow. *Worth alone:* tenants reach value measurably
faster, and the console finally distinguishes "paying" from "succeeding".

**Deferred, with the seam named:** feature tiers (capability system),
per-seat or usage components (catalog + subscription items), Stripe Tax
(`automatic_tax` flip once nexus is real), finer platform roles (column on
`platform_admins`), self-serve plan changes (console-only until then).
