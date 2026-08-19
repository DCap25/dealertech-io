# DealerTech.io

**A selling tool for service advisors. A customer relationship builder second.**

Get the order right, because it decides what gets built. This is a sales tool —
it exists to help an advisor present everything, pitch the right work, and
close it. The relationship and the record-keeping are what make the selling
work over years instead of one visit, but they serve the sale; the sale does
not serve them. A feature that does not make an advisor better in front of a
customer is not a priority here, however good it would look on a CRM feature
list.

> DealerTech is the service advisor's primary daily workspace.
> The DMS is the system of record.

That line governs almost every technical decision in this repo. If you read
nothing else, read it twice. We do not replace the dealership's DMS — we sit on
top of it, make the advisor brilliant at their job for the ninety seconds they
have with each customer, and hand the result back to the DMS in a form it
accepts.

---

## 1. Why this exists

### The problem, stated honestly

Most people hate taking their car to a dealership. Not because the work is bad,
but because of what the conversation feels like:

- They think the service advisor is inventing work to hit a number.
- Nobody explains **why** a thing is needed in language a human understands.
- They have no idea what they already paid for. They bought a service contract
  three years ago at the finance desk and have never once been told it covers
  the thing being quoted.
- The price quoted at the counter and the price on the invoice are different.

Meanwhile the advisor is not a villain. They are standing in a drive with eight
cars, four phones ringing, a technician's inspection they have not read, and a
DMS screen that shows them a repair order number and almost nothing about the
human being in front of them. They miss coverage the customer owns. They forget
to present the safety item. They guess at a price. And every one of those
misses reads to the customer as a lie.

### The insight

**Service advisors are salespeople, and the best salespeople are the
trustworthy ones.** They build relationships, they know the product, and they
never pitch something they cannot stand behind.

That is the whole strategy. We are unapologetically building a tool to sell
more work — we just think the highest-selling advisor in the country is the one
the customer believes. So every feature here arms the advisor to present
everything and pitch the right thing:

- They know **exactly what coverage the customer already owns**, so the first
  number on the screen is what the customer does *not* have to pay — which is
  also the single most effective opener in the business.
- They can **see the vehicle's history instantly**, so what they pitch is what
  the car actually needs, and they can say why.
- They can **show, not tell** — an animation of what a 3mm brake pad means,
  next to this vehicle's own measurement.
- **Nothing gets missed.** The engine ranks every opportunity on the car, so
  the safety item is presented even on the eighth write-up of the morning.
- They never quote a price the DMS will not honour.

The relationship layer — history, coverage, follow-up on declined work, cadence
— is what turns one good conversation into a decade of them. It is second in
priority, not second in importance.

### The vision

Turn the tablet around and have nothing to hide. Every customer-facing screen
in this product is built so it can be physically handed to the customer
mid-conversation without a single thing on it needing to be explained away.

That is the whole bet: the dealership that is most transparent wins the
customer for the life of the vehicle, and that dealership needs software that
makes transparency the path of least resistance rather than an act of
discipline.

---

## 2. Principles that the code actually enforces

These are not aspirations. Each one is load-bearing, and violating it will
break tests or reviews.

**Never quote a price the DMS will not charge.**
Menu prices resolve from the store's own op-code price book, pulled from the
DMS every morning. Where no op code matches, the customer is shown *"Price to
be confirmed"* rather than our estimate, and the item is excluded from every
total. Showing $84 and invoicing $106 is the exact argument this product exists
to prevent, and it does not matter that our estimate was reasonable.

**A preference is not an authorization.**
A customer tapping "Yes" records what they *want*. The advisor still authorises
the work the way they always have. Authorization law varies by state (written
estimate thresholds, re-authorization when the price moves — see California
§9884.9), and a tablet that quietly created a legal record we had not got right
would be worse than one that does not try.

**We advise; we do not adjudicate.**
The coverage engine carries a permanent disclaimer: the administrator or OEM
decides claims, not us. Every determination ships with a reasoning trace
(`FIRED` / `SKIPPED` / `NOT_APPLICABLE` per rule) and a confidence level that
only ever downgrades, so an advisor can see why we think something is covered
and judge it themselves.

**Tier comes from measurement, never from a choice.**
An advisor can include an item, exclude it, or reorder it *within* its tier.
They cannot promote something into "Needs attention now". If they could, the
tier would stop meaning anything and the customer would be right to stop
believing it.

**Deny by default, everywhere.**
Route protection is an explicit allowlist (`src/lib/auth/routes.ts`) — adding a
page protects it automatically. Row-level security is FORCEd on every table.
The cron endpoint refuses every request when its secret is unset rather than
falling open.

**Customer-facing data is a whitelist, not a filter.**
`buildDeviceSnapshot` constructs the customer view field by field. Adding a
field to `Opportunity` does not add it to what a tablet receives — somebody has
to decide to send it. A test asserts `talkTrack`, `closeProbability`,
`priorityScore`, `estimatedAmount`, `likelyPayer`, `sourceId`, `type` and
`urgency` never appear at any depth.

**Pure engines, thin screens.**
Everything in `src/lib/` that decides something is I/O-free and unit-tested.
The UI is a renderer over it; the nightly job calls the same functions.

---

## 3. What has been built

### The advisor's day

| Surface | Route | What it does |
|---|---|---|
| Today's drive | `/drive` | The day's appointments, ranked |
| Prep sheet | `/drive/[appointmentId]` | The core screen: coverage, warranty, history, ranked opportunities, talk tracks |
| Write-up | `/advisor/write-up/[appointmentId]` | Start the visit |
| Repair order | `/advisor/ro/[roId]` | Work the RO, close and deliver |
| Scorecard | `/advisor/scorecard` | The advisor's own numbers |
| Follow-up | `/follow-up` | Declined work and cadence tasks, per vehicle |
| Customers / vehicles | `/customers`, `/vehicles/[vehicleId]` | Records, ownership, coverage, visit history |
| BDC | `/bdc` | Outbound desk |
| Manager | `/manager` | Department board |
| Team | `/team` | Roster: invite, change role, remove, restore |

### The customer conversation

The same menu reaches a customer three ways, and **all three now render from
one derivation** (`buildDeviceSnapshot`):

1. **In person** — the advisor turns their screen around (`PresentMenu`).
2. **On a paired tablet** — `/present`, claimed by an advisor, authenticated by
   its own bearer token, handed a frozen snapshot it cannot query behind.
3. **On the customer's own phone** — `/m/[token]`, a 12-hour single-visit link
   sent after the technician has been under the car.

Plus **on paper** (`PrintableMenu`) — different markup, same data, because a
drive with one dead tablet still has customers on it.

Every item offers three answers of equal visual weight, with *Not today* first:

> **Not today** · **Call me about this** · **Yes**

"Call me about this" is the answer customers want most often and no menu ever
offers. A buried decline is read instantly, and once a customer has spotted it
they discount the brake warning too — which was the one that mattered.

### The engines (`src/lib/`)

| Module | What it decides |
|---|---|
| `coverage/` | Does an active contract or factory term cover this component? With a full reasoning trace and a confidence that only downgrades. |
| `warranty/` | Factory term snapshots — basic, powertrain, emissions — by make, in-service date and mileage. |
| `prep-sheet/` | **The opportunity engine.** Takes a vehicle's history, returns a ranked list of what to sell, who pays, and what to say. |
| `taxonomy/` | Component groups — the join between an inspection item, an op code, a coverage term and an explainer. |
| `menu/` | The advisor's curation: what goes on the customer menu, in what order, with what totals. |
| `presentation/` | Decisions (`ACCEPTED` / `DECLINED` / `CALL_ME` / `PENDING`), menu links, re-authorization when a price moves. |
| `explainer/` | 20 animated explanations (brakes, tyres, fluids, alignment…) shown *before* the choice, with this vehicle's own worst reading. |
| `pricing/` | The morning op-code price sync and its reconciliation. |
| `odometer/` | Rollback detection — an odometer cannot go backwards, and each explanation for why it appears to has different consequences. |
| `reconcile/` | Settles declines and follow-up tasks when an RO closes, scoped per vehicle. |
| `cadence/` | Scheduled follow-up rules and tasks. |
| `performance/` | Visit outcomes and advisor scorecards. |
| `pairing/` | Tablet pairing codes and the customer-safe device snapshot. |
| `dms/` | The adapter contract, mappers, hand-off records, authorization notes. |
| `billing/` | The commercial layer: the lifecycle state machine, the access ladder it drives, Stripe mapping and webhooks, reconciliation, proration, and cancellation. Everything that decides is pure; `subscription-ops.ts` and `run.ts` do the I/O. |
| `team/`, `invites/`, `manager/`, `platform/` | Roster, invitations, department board, tenant provisioning. |
| `copilot/` | Claude-backed assistant, two competences behind one panel: visit coaching over the prep sheet context, and app help grounded on a checked-in, role-sliced product guide covering every surface — a completeness test walks the route tree, so a new page fails the suite until the guide learns it. Reachable from a floating launcher on every workspace page (never on a customer surface) and from the prep sheet's own entry. Falls back to a mock provider with no API key. |

### The DMS boundary

`DmsAdapter` (`src/lib/dms/adapter.ts`) is deliberately small and deliberately
humble:

- `pullDriveBundle` — a day of appointments, vehicles, inspections, history
- `pullVehicleDetail` — one vehicle in full
- `pullPriceBook` — `null` means "do not ask me this"; `[]` means "this store
  prices nothing", which is also what an expired credential looks like, so the
  sync refuses to act on it
- `pullCoverages` — re-runnable on demand
- `pushHandOff` — writes whatever the target genuinely supports (an RO comment,
  a recommendation record, a note) and **reports which**. Nothing assumes we can
  create priced lines.
- `pushFollowUpOutcome`

Adapters that cannot do something refuse identically via `unsupported()`, so
the UI has one shape to render regardless of vendor. `DMS_ADAPTER=mock` with
`DMS_MOCK_SCENARIO` drives development and the seeded demo.

### Platform / tenancy

- `/signup` creates a brand-new tenant. `/invite/[token]` grants exactly the
  role named when the invitation was issued — 32 random bytes, SHA-256 at rest,
  raw value never persisted.
- Staff roles: `ADVISOR`, `BDC`, `TECHNICIAN`, `DISPATCHER`, `PARTS`,
  `CASHIER`, `SERVICE_MANAGER`, `FIXED_OPS_DIRECTOR`, `ADMIN`. Managing staff
  requires one of the last three, with last-manager lockout guards.
- `/admin` is the platform console — the morning read (a needs-attention
  rollup), tenants, provisioning, sync runs. `/admin/tenants/[orgId]` is one
  dealer group in full, with every commercial action on it; `/admin/leads` is
  the inbound demo requests and what was said on the call. All of it returns
  **404** to a non-platform-admin rather than 403, so it does not announce
  itself.

### Scheduled work

`netlify/functions/pricing-sync.mts` fires at 11:00 UTC daily and POSTs to
`/api/cron/pricing`, which pulls each store's priced operations and brings the
local book into line. Both it and `npm run pricing:sync` run the same engine —
no second implementation to drift.

---

## 4. Stack and layout

Next.js 16.3 (App Router) · React 19.2 · TypeScript strict with
`noUncheckedIndexedAccess` · Tailwind v4 · Drizzle ORM over postgres.js ·
Supabase (auth + Postgres) · Vitest 4 · Netlify (`opennextjs-netlify`).

```
src/
  app/          routes — see the table above
  components/   prep-sheet/, present/, explainer/, copilot/, ui/
  lib/          the engines — pure, I/O-free, unit-tested
  db/
    schema/     48 tables across tenancy, customers, service, coverage,
                communication, retention, devices, documents, handoffs,
                integration, marketing
    migrations/ 0000–0019, hand-written and idempotent
    scoped.ts   withUserScope() — runs work as the authenticated role
scripts/        migrations, seeds, RLS verification, sync runners, smoke
netlify/        the scheduled pricing sync
```

**~1,020 unit tests across 50 files.** Every engine has one.

### Security model

Auth is Supabase (`@supabase/ssr`). Multi-tenancy is enforced in the database,
not in queries: RLS is FORCEd on every table and policies key off `auth.uid()`.
`withUserScope()` opens a transaction, `SET LOCAL ROLE authenticated`, and sets
`request.jwt.claims` — so a page that forgets a `WHERE store_id = ?` returns
nothing rather than another dealership's customers.

Bearer credentials (invitations, menu links, device tokens) are all the same
shape: 32 random bytes, SHA-256 stored, raw value never written down.

---

## 5. Working in this repo — read this before you touch anything

### Hard rules

- **`npm run db:push` is deliberately sabotaged.** `drizzle-kit push` drops
  every RLS policy in the database. Use `npm run db:apply`, which runs the
  hand-written migrations through the `_applied_migrations` ledger. See
  `src/db/README.md`.
- **`.env.local` and production point at the same Supabase database.** A local
  write is a live write. Verify with reads; think before you insert.
- **Do not push on every change.** Netlify build minutes are a real cost —
  commit locally and push in batches when asked.
- **Do not change the pure engines' interfaces or the `DmsAdapter` contract**
  casually. They are the seams the whole product hangs off.
- **No SMS sending in v1** (TCPA). Links are delivered by copy-and-paste.
- The repo is **private** — proprietary product code.

### Where to start reading

1. `src/lib/prep-sheet/build.ts` — the opportunity engine. Everything the
   advisor sees comes from here.
2. `src/lib/coverage/engine.ts` — `evaluateCoverage`, the reasoning trace.
3. `src/lib/pairing/snapshot.ts` — the whitelist that defines what a customer
   is ever allowed to see.
4. `src/components/present/service-menu.tsx` — the screen the product is judged
   on.
5. `src/lib/auth/routes.ts` and `src/db/README.md` — the two security seams.

The code is heavily commented, and the comments explain **why**, often
including what went wrong before. They are worth reading; several of them are
the only record of a bug that took a long time to find.

### Related docs

- `DEPLOYING.md` — Netlify setup, environment variables, Supabase redirects,
  storage, the morning sync
- `src/db/README.md` — migrations, the `db:push` trap, closing the RLS gap
- `AGENTS.md` / `CLAUDE.md` — this Next.js version has breaking changes from
  training data; read `node_modules/next/dist/docs/` before writing code

---

## 6. Known gaps

Stated plainly so nobody discovers them the hard way.

- **`admindan@dealertech.io` needs its password rotated.** Platform admin, so
  it reaches every tenant's operational data. The demo staff accounts were
  rotated off the committed default; this one has not been.
- No error monitoring, no CI pipeline, no integration tests.
- Rate limiting is per-instance and in-memory (`src/lib/rate-limit/`), which
  stops the cheap version and not a distributed one. A shared store is the
  honest fix when it is worth the dependency.
- `advisor/actions.ts` still has no test coverage of its own; the write paths
  are exercised by hand and by `src/db/transaction.test.ts`.

### Rotating the credentials

```bash
# Demo staff. Prints the new password once — put it in a password manager.
npm run demo:rotate

# Any single account, platform admin included. Prints it once.
npm run platform:rotate -- admindan@dealertech.io

# Confirm who holds platform access.
npm run platform:list
```

Rotation is its own script for a reason, and **two** other scripts wear the
disguise convincingly.

`auth:provision --repair` looks like it would do this and does not: repair only
fires when an auth id has drifted from its application row, and when the ids
match — which is the normal case — it reports `ok` and changes no password at
all. It also deletes and recreates the account it repairs, which is right for a
broken link and wrong for a password change.

`platform:create` takes a password argument and is idempotent on the account,
which sounds like a rotation and is not. Its second branch — the one taken for
an address that already exists — ensures the platform grant and never touches
the password. It prints "already has an account", exits 0, and the old password
keeps working. This was documented here as the way to rotate a platform admin
and did not work; `platform:rotate` is the thing that does.

Neither script revokes existing sessions. Supabase keeps issued tokens valid
until they expire, so a rotation locks out a future sign-in and not a current
one. Sign out everywhere from the Supabase dashboard if that matters.

If one-tap sign-in stops working locally after a rotation, set
`NEXT_PUBLIC_DEMO_PASSWORD` in `.env.local` to the new value. Without it the
demo cards fill the address only.

### Two things that turned out not to be bugs

Recorded because both were listed here as defects for a while and both cost
somebody an afternoon:

- **"Newly-introduced Tailwind classes never reach the stylesheet."** They do.
  The dev server was serving a stale CSS chunk, which happens if `next build`
  is run while `next dev` is running — the build clobbers `.next` underneath
  it. Symptom: the stylesheet byte count does not change when you add a class.
  Fix: stop the dev server, delete `.next`, start it again.
- **"`sr-only` renders visibly."** Same cause. Tailwind 4.3 defines `sr-only`
  and emits it correctly; a clean rebuild takes the generated sheet from
  84,729 to 89,285 bytes and a real `.sr-only` element computes
  `position: absolute; width: 1px; clip-path: inset(50%)`.

If a class seems to be missing, check the byte count before checking Tailwind.
