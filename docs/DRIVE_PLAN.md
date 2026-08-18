# The Drive, Grown Up — Scheduling, Assignment, and the Advisor's Book

**Scope:** three asks, scoped together because they are one feature wearing
three hats. (1) See and book appointments beyond today — tomorrow, the week —
for one advisor and for the dealership. (2) The sales-to-service handoff: a
sold car's first service appointment, booked at delivery, assigned to the
right advisor. (3) The advisor CRM: the relationship and its history in one
place, not seven tables.

**Status:** scoping document. Decisions and reasoning stated plainly,
alternatives kept. Nothing here is built; §6 is the build order.

Written 2026-08-18, grounded against the code as of `8c1136a` (post
menu-review campaign). Where this document says "exists", it was read in the
schema or the code, not assumed.

---

## 1. What already exists — more than the ask assumes

The scheduling substrate is largely built. This matters because the wrong
conclusion from the ask is "we need an appointments system"; the right one is
"we need views, a booking surface, and rules on top of the one we have."

| Piece | State | Where |
|---|---|---|
| Appointment lifecycle | **Exists.** `SCHEDULED → CONFIRMED → ARRIVED → IN_SERVICE → READY → DELIVERED`, plus `NO_SHOW` / `CANCELLED` | `appointmentStatusEnum`, `service.ts` |
| Advisor assignment field | **Exists**, nullable — an unassigned appointment is already representable | `appointments.advisorId` |
| The queries the views need | **Exist as indexes**: `(storeId, scheduledAt)` for the dealership week, `(advisorId, scheduledAt)` for the advisor's book | `appointments_store_scheduled_idx`, `appointments_advisor_idx` |
| Date-range plumbing | **Exists.** `pullDriveBundle(storeId, {from, to})` takes a range; `loadDriveDay` just calls it with one day | `adapter.ts`, `load.ts` |
| A future-day view | **Half-exists.** `/drive?date=` renders any single day already | `drive/page.tsx` |
| Booking attribution | **Exists.** `source` enum (`PHONE`, `WALK_IN`, `ONLINE`, `BDC`, `ADVISOR`, `DMS_SYNC`, `CAMPAIGN`, `RECALL`), `createdBy` | `appointmentSourceEnum` |
| Booking outcomes wired to retention | **Exists.** `cadenceTasks.resultingAppointmentId`, `campaignTargets.resultingAppointmentId`, `callLogs.resultingAppointmentId` — the whole retention engine is already measured in appointments set | `retention.ts` |
| CSI-bearing fields | **Exist**: `promisedAt` ("what the customer was told"), `transportType` (waiter/loaner/shuttle), `customerConcerns` (never overwritten) | `service.ts` |
| History raw material | **Exists, scattered**: appointments, ROs + lines, declined services, presentation sessions (menus shown, decisions, authorisations), hand-off receipts, prep-sheet outcomes, call logs, customer notes, mileage readings | seven schema files |

The genuine gaps:

1. **No week or dealership view** — the drive renders one day, implicitly "mine".
2. **No booking surface** — nothing in DealerTech creates an appointment;
   rows come from the seed or (in principle) `DMS_SYNC`.
3. **No capacity model** — nothing says how many cars a Tuesday can take.
4. **No assignment rules** — `advisorId` is a column with no policy.
5. **No sales-side actor** — `userRoleEnum` has no `SALES`; the person the
   handoff ask starts with cannot log in, and no `source` value names a
   delivery introduction.
6. **No owning advisor** — `customers` has no relationship field, so
   "their advisor" is not a fact the system can know.
7. **No timeline** — the history exists but no surface reads it as one story.

---

## 2. The architectural decision everything else sits on

**D1 — Who owns the appointment book?**

The repo's governing line is *"DealerTech is the advisor's primary daily
workspace. The DMS is the system of record."* Scheduling is where that line
gets tested, because an appointment book has to be writable, and the
`DmsAdapter` is deliberately humble: `canPullAppointments` exists,
**no push-appointment capability exists at all**, and `pushHandOff` writes
"whatever the target genuinely supports and reports which."

- *(a) DealerTech is the book.* Appointments are created and live here;
  the DMS pull merges in anything booked on the other side (dedupe via
  `externalRefs`, which exists for exactly this). Nothing is pushed to the
  DMS in v1 — the appointment reaches the DMS the same way everything else
  does, as part of the hand-off when the visit is written up.
- *(b) The DMS is the book; DealerTech is a viewer.* Booking means deep-link
  or swivel-chair into the DMS scheduler. Nothing to build, nothing to drift —
  and nothing sellable: the sales-to-service handoff and the BDC worklist both
  die here, because the people doing them don't have DMS seats.
- *(c) Two-way sync.* The full integration: push bookings into the DMS
  scheduler per vendor. The correct end state and a per-vendor tar pit —
  every scheduler API is different, some don't exist, and a half-working push
  is worse than none (two books that *almost* agree).

**DECIDED (Dan, 2026-08-18): (a) — DealerTech owns the book.** The
recommendation below stands as the reasoning of record.

**Recommendation: (a), stated as policy in the adapter's own vocabulary.**
`PLAN.md`'s locked decisions already put appointments in DealerTech's scope
("Appointments + coverage arbitration + opportunity engine. DMS keeps the RO,
parts, invoicing, accounting"). The seed and mock adapter already work this
way. Add `canPushAppointment: false` to `DmsCapabilities` now — not to build
the push, but so the day a vendor supports it, the capability flag and the
`unsupported()` refusal pattern are already the shape, and no UI has to
change. (Per the repo rule: this touches the `DmsAdapter` contract, so it is
called out here rather than done casually — it is one additive boolean, and
every adapter answers `false` in v1.)

The consequence to state honestly on every surface: **an appointment booked in
DealerTech is not in the DMS until the visit is handed off.** A store that
runs its loaner fleet or shuttle off the DMS scheduler needs to know that.
The booking screen should say it the way the hand-off panel says "the mock
doesn't persist" — plainly, once, where it's true.

---

## 3. Views — the calendar the drive grows into

**D2 — What the advisor and the manager each see.**

**DECIDED (Dan, 2026-08-18): the schedule is the advisor's, not the tech's.**
This overrides the shop-capacity framing an earlier draft of this section
carried. The scheduling unit in DealerTech is the **advisor's book**: an
appointment is booked into a named advisor's schedule (or the unassigned
pool), the week reads as advisors' books side by side, and technician
capacity is not modelled here at all — that is dispatch, and dispatch is the
DMS's (D3). The product line that settles it: *DealerTech is a service
advisor sales tool, a CRM, and a scheduler layer.* The advisor is the unit of
everything else in this product — the drive, the scorecard, the hand-off, the
owning relationship — so the advisor is the unit of the schedule too.

One point from the earlier framing survives, demoted from structure to
guardrail: books that fill unevenly are how lanes starve while one writer
drowns. That is handled by D4's balanced assignment and D3's per-advisor
caps, not by pretending the schedule belongs to the shop.

So, three views over one query surface:

1. **Today (exists)** — the drive as it is: ranked prep sheets, opportunity
   totals. Becomes the `day` case of the range loader. Default for `ADVISOR`,
   filtered to *their* appointments plus the unassigned pool (see D4) — an
   advisor's day is their book plus what they might claim.
2. **Week** — the advisor's book across seven days: appointment cards by
   time, colour by status, a per-day load bar against *their* capacity (D3).
   The dealership week — default for `SERVICE_MANAGER` /
   `FIXED_OPS_DIRECTOR` — is the same days with **one column per advisor's
   book** (plus the unassigned pool), which is also where uneven books become
   visible at a glance. The toggle is **Mine / Everyone**, and it is a
   filter, not a permission — any advisor may look at the store's week (they
   cover for each other; hiding it buys nothing), but *editing* another
   advisor's assignment is manager-gated (D4).
3. **Vehicle/customer's next visit** — not a calendar; the CRM timeline's
   forward edge (D6). The same appointment rows, read from the other end.

Mechanics: `loadDriveDay(storeId, from, to)` already takes a range — the
week view is `loadDriveRange` with the prep-sheet build made lazy (building
40 full prep sheets to paint a week of cards is waste; the week wants
appointment + customer + vehicle + a cheap flag for "safety item present",
and builds the sheet when a card opens). This is a read-model split, not a
new engine: `buildPrepSheet` stays the only authority on opportunities.

Date handling follows `demo-day.ts` conventions — the demo store lives on a
fixed date and every view derives from `demoNow()`, so the week view is
screenshot-stable like everything else.

---

## 4. Capacity and booking

**D3 — What "full" means.**

**DECIDED (Dan, 2026-08-18): tech hours are DMS territory.** *DealerTech is a
service advisor sales tool, a CRM, and a scheduler layer* — capacity here
means the capacity of the advisor's book, never the shop floor's. Recast
accordingly: with D2's decision that the schedule is the advisor's, "full"
is a fact about a *book*, not about the building.

Options, in ascending fidelity:

- *(a) Nothing.* Book anything anywhere. That is today, minus the UI. It is
  also how one advisor's Monday 8am takes five write-ups and the product gets
  blamed.
- *(b) Advisor-book caps over store hours.* Store scheduling rules give the
  frame (open hours per weekday, slot length); the caps live on the book:
  **max appointments per advisor per slot** (how many customers one writer
  can greet at 8:00 — usually 1–2) and **max per advisor per day** (a
  writes-per-day number, which is also the number D4's balanced assignment
  weighs against). A store-level **max waiters per slot** stays as the one
  building-level warning worth keeping — the lounge holds so many people
  whoever's books they sit in, and `transportType` already knows who waits.
  The dealership-week totals are *derived* — the sum of the books plus the
  unassigned pool — never a separately-managed shop number that can disagree
  with them.
- *(c) Tech-hours dispatch.* Real shop capacity is technician hours by
  skill, which is dispatching — the DMS's, per the decision above and
  `PLAN.md`'s locked scope ("DMS keeps the RO, parts…"), and a swamp of
  per-store truth we cannot see.

**Recommendation within the decision: (b).** And per the menu builder's own
precedent (`menuWarnings`): **capacity warns, it does not block.** "Marcus is
at 4 of 4 write-ups for Tuesday morning" is a sentence for the booker — who
may know exactly why a fifth is fine; a hard refusal teaches them to book it
as a phone note instead, and the system loses the appointment *and* the
truth. The one hard stop worth having is outside store hours, and even that
needs a manager override for the 7am tow-in, because tow-ins happen.

New table sketch (one, plus a pure engine `src/lib/scheduling/`):

```
scheduling_rules  store_id · weekday · open_time · close_time · slot_minutes
                  max_per_advisor_slot · max_per_advisor_day · max_waiters_per_slot
```

Per-advisor overrides (a senior writer who takes more, a trainee capped low)
can be a later nullable column on the roster, not a v1 table. Pure and tested
like everything else that decides: `slotsForDay(rules, day)`,
`bookLoad(slots, appointments, advisorId)`, `capacityWarnings(...)` — the UI
renders over it, the booking action calls the same functions.

**The booking surface** is one form used by every role that books (advisor,
BDC, manager, sales — D5): customer/vehicle search-or-create, date + slot
picker painted with load, transport type, concerns verbatim, advisor
assignment per D4, `source` set by who is booking. It writes the local row;
`createdBy` and `source` make every book attributable. The BDC page and the
cadence worklist link into it with the customer pre-filled and
`resulting_appointment_id` wired back — the retention engine's "did the call
produce a booking" measurement starts actually measuring.

---

## 5. Assignment — whose customer is this

**D4 — How an appointment gets an advisor.**

The industry-practice frame, stated as the reasoning rather than appealed to
as authority: advisor continuity is a retention lever — a customer who "has a
guy" comes back to the guy — and the sales-side analogue is exactly the CRM
discipline `PLAN.md` opens with. But continuity competes with load balance
(the senior advisor accretes everyone) and with shift reality (their guy is
off Tuesdays). So assignment is a **cascade with an audit trail**, not a rule:

1. **Requested advisor.** The customer asked, or the salesperson introduced
   one (D5). Honour it even when lopsided — this is the relationship the
   product exists to build. If that advisor is off that day, the booker sees
   it at booking time and chooses: different day, or different advisor —
   never a silent reassignment.
2. **Owning advisor.** `customers.owning_advisor_id` (new, nullable, with
   `owning_advisor_since` and a source — see D6). Same off-shift behaviour.
3. **Balanced pool.** No relationship exists: round-robin across advisors,
   weighted by that day's assigned count (the D3 soft cap), skipping anyone
   off. Deliberately boring — fancy routing (skill, gross history) is tuning
   nobody asked for.
4. **Unassigned.** A store may prefer to leave the morning pool open and let
   advisors claim at write-up — `advisorId` is already nullable, and some
   drives genuinely work as a first-free-writer line. Store-level setting:
   auto-assign at booking vs assign at arrival. Both are real operating
   models; picking one in code would be the product overruling the store.

Every assignment records **who and why**: `assigned_by` (user or `SYSTEM`),
`assignment_reason` (`REQUESTED · OWNING · BALANCED · CLAIMED · MANUAL`).
That column is what makes the scorecard fair (an advisor's numbers mean
nothing if nobody knows how their book was dealt) and the disputes short.
Reassignment: self-serve to *claim* unassigned; manager-gated to *take*
assigned; always logged to the same trail.

---

## 6. The sales-to-service handoff

**D5 — The delivery introduction, and who the salesperson even is.**

The practice being encoded, because it is the reasoning: the highest-leverage
retention moment a dealership owns is vehicle delivery. The customer is
standing in the building, happy, keys in hand. A walk to the service drive, a
named advisor shaking their hand, and the first maintenance visit already on
the calendar converts a sales customer into a service customer at the moment
of maximum goodwill — and the first service visit is the strongest predictor
of whether the store ever sees the car again. That is the workflow to make
*easier than not doing it*.

The blocking fact: **there is no sales-side actor.** `userRoleEnum` has nine
roles and none of them sell cars. Three ways in:

- *(a) A `SALES` role* with a deliberately tiny surface: one page — "introduce
  a customer to service" — that creates/finds the customer and vehicle, books
  the first appointment through the same D3/D4 machinery, and optionally names
  the introduced advisor. No drive, no prep sheets, no customer lists beyond
  their own deliveries. Deny-by-default already protects every other route.
- *(b) A delivery link* — the sales desk gets a tokened link (the repo's
  32-byte/SHA-256 pattern, a third use of it) that opens the introduction form
  with no account at all. Zero onboarding, and zero attribution — "the sales
  desk" booked it, not a person, and the salesperson's follow-through (the
  thing the sales manager wants on a report) is unmeasurable.
- *(c) BDC books on sales' behalf.* No new surface, and the introduction
  stops being an introduction — a phone call two days later is precisely the
  degraded version of this workflow that best practice exists to replace.

**Recommendation: (a).** The role is one enum value; the surface is one page;
the roster machinery (`/team`, invitations, role guards) already exists and
generalises. (b) is a reasonable *later* addition for stores whose sales
floor will never log into anything, but it should be the fallback, not the
design — attribution is half the point. Schema deltas:

```
userRoleEnum        + 'SALES'
appointmentSource   + 'SALES_INTRO'      (the delivery introduction)
appointments        + introduced_advisor_id  uuid null   (who was walked over to)
                    + sold_by_user_id        uuid null   (the salesperson — attribution)
                    + visit_context          'FIRST_SERVICE' | null
```

`visit_context: FIRST_SERVICE` is what the drive renders differently: a
first-service customer gets the red-carpet treatment cues on the prep sheet
(new owner, sold last month, coverage sold with the car — the coverage engine
already knows about the contracts F&I sold; this is where that pays off).
Assignment flows through D4 unchanged: introduced advisor = a step-1
"requested" assignment with `assignment_reason: REQUESTED`; no introduction =
the balanced pool. The scheduling default the form should push toward: book
the first service **at delivery, dated by the maintenance schedule**
(`maintenanceSchedules` exists and knows the interval; ~5k miles / 6 months
out at the customer's driving pace once `avgMilesPerDay` exists, the interval
default until then), with the cadence engine (already built) owning the
reminder as the date approaches.

What deliberately stays out: sales-side CRM (desking, ups, deals). One page,
one workflow, or this becomes a second product.

---

## 7. The advisor CRM — history as one story

**D6 — What "keeps the history" means concretely.**

Two separate things are being asked for, and they have different costs:

**The relationship (new fact):** `customers.owning_advisor_id`, nullable,
with `owning_advisor_since` and `owning_advisor_source`
(`SALES_INTRO · FIRST_VISIT · REQUESTED · MANAGER_SET`). Set automatically at
the moments the relationship actually forms — the delivery introduction (D5),
or the first completed visit with an advisor when no owner exists — and
editable by a manager. Never silently reassigned by traffic patterns; a
relationship the system moves on its own isn't one. This single column is
what makes D4 step 2 possible and the advisor's book ("my customers")
queryable at all.

**The timeline (new read, no new writes):** every event already stored,
merged and rendered per customer/vehicle in reverse-chronological order:

| Event | Source table (exists) |
|---|---|
| Appointment booked / kept / no-show | `appointments` (+ its status timestamps) |
| Menu presented, on what, answers, authorisation | `presentation_sessions` (channel, sequence, decisions, `authorizedSnapshot`) |
| RO opened / closed, lines | `repair_orders`, `ro_lines` |
| Work declined, resurfaced, resolved | `declined_services` |
| Visit outcomes per opportunity | `prep_sheet_outcomes` |
| Hand-offs pushed to the DMS | hand-off receipts (`handoffs.ts`) |
| Calls made, result | `call_logs` |
| Cadence tasks fired / completed | `cadence_tasks` |
| Notes | `customer_notes` (pinned already surface on the prep sheet) |
| Odometer trail | `mileage_readings` |

This is a read-model in `src/lib/timeline/` (pure assembly over typed
fetches, same shape as every other engine) plus rendering on
`/customers/[id]` and `/vehicles/[vehicleId]`, and a compressed "last visit,
next visit, open threads" card on the prep sheet itself — the ninety-second
version the advisor actually reads in the lane.

Two known debts this surfaces, both already recorded in `MENU_REVIEW.md` and
worth scheduling with this work because the timeline will make them visible:
**the outcome vocabulary cannot express a call-me** (`toOutcome` collapses
`CALL_ME` to `SKIPPED` — on a timeline that renders as "never raised", which
is false and the exact high-intent thread an owning advisor should be pulling
on), and **`needsFollowUp`/`followUpPriority` have no callers** — the
timeline's "open threads" section is the natural first consumer.

---

## 8. Build order

Each phase ships alone and leaves the tree releasable. Pure engines first,
screens over them, per the house rule.

| Phase | Ships | Schema | Notes |
|---|---|---|---|
| **P1 — See the week** ✅ | `loadDriveRange` + lazy sheet build; week view with Mine/Everyone; day view keeps `?date=` | none | **BUILT** `feb942b` (Fable inline during the Opus 529 outage). Mine = book + claimable pool; Everyone = rows-are-books. Caveat recorded: Mine matches source-system advisor ids — true on mock/seed, needs externalRefs mapping on a real DMS |
| **P2 — Book** ✅ | `src/lib/scheduling/` (slots, load, warnings, assignment cascade) + booking form + `scheduling_rules` + assignment audit | migration 0028: `scheduling_rules`, `assigned_by`/`assignment_reason`, `canPushAppointment: false` | **BUILT** `74fae91` (Opus, Fable-verified). Cascade honours requested/owning even off-shift; owning step is the tested P3 seam; Q1's `auto_assign` lives per-weekday, default true. Found + fixed in passing: `appointments` never had a grant (the fifth "a policy is not a grant"). Honest seams: no shift schema (`working` always true today); `timeOf` hardcodes Central while slots are server-local. **0028 must be applied before this deploys — it breaks reads harder than 0026** |
| **P3 — Sales handoff** | `SALES` role + introduction page + first-service cues on the prep sheet | migration 0029: enum values, `introduced_advisor_id`, `sold_by_user_id`, `visit_context`, `owning_advisor_*` | D5 + the owning-advisor columns (D6's fact) land together — the introduction is what first writes them |
| **P4 — Timeline** | `src/lib/timeline/` + customer/vehicle rendering + prep-sheet card; fix `CALL_ME` outcome vocabulary; first consumer for `needsFollowUp` | migration only if the outcome enum change needs one | Pure read-model; the outcome fix is the one write-side change |

Enum migrations note: `ADD VALUE IF NOT EXISTS` per the idempotent-migration
house rule; both migrations inherit the 0026 discipline — applied before the
code that reads them deploys.

---

## 9. Open questions for Dan

1. **Auto-assign at booking, or claim at arrival (D4 step 4)?** Recommended:
   store setting, defaulting to auto-assign — but you know how your target
   stores actually run their drives, and the default should match the modal
   store, not my guess.
2. **May a `SALES` user book anything other than a first service?** Recommended:
   no — one workflow, one page. Widening it is a one-line guard change later;
   narrowing it after sales has the habit is a fight.
3. **Slot warnings: is there any store where over-booking must hard-block?**
   Recommended: warn-only everywhere plus the outside-hours stop; but if a
   pilot store demands blocking, it's a per-store flag on `scheduling_rules`,
   not a design change.
4. **Does the week view show money?** The day view shows opportunity totals.
   A week of projected opportunity is a sales-forecast number managers will
   love and advisors may resent hanging over unbuilt prep sheets. Recommended:
   yes for manager view, count-only for the advisor toggle — but this is
   taste, and yours outranks mine.
5. **`promisedAt` vs `scheduledAt` in the week view** — cards placed by when
   the car arrives, or when it was promised back? Recommended: arrival time
   places the card, promised time renders on it; loaner/waiter conflicts key
   off promised. Flagging because whichever one the view leads with becomes
   the number the store manages to.

---

*Nothing in this document changes the `DmsAdapter` contract except the one
additive capability flag called out in D1, and nothing touches the pure
engines' existing interfaces. Everything that decides — slots, load,
assignment, timeline assembly — lands as pure, tested modules with screens
rendered over them, per the repo's standing rule.*
