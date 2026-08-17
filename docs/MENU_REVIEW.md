# Menu Build & Presentation — Review

**Scope:** the two paths the product is judged on — an advisor building a menu,
and that menu reaching a customer. ~4,100 lines across `prep-sheet/`, `menu/`,
`pairing/`, `presentation/`, the four customer-facing surfaces, and the two
routes that carry them.

**Method:** read against the code and the database, never against a comment.
Every finding below was reproduced by executing the real functions, or by a
read-only query against the production Supabase instance. Where I could only
reason, I say so. The test suite was run: **1,024 passing, 31 skipped, 50 files**
— exactly as claimed, and green throughout this review.

---

## 1. Verdict

**Not yet. Two of these put a wrong number or a wrong service in front of a
customer without anything going visibly wrong, and one of them fires on the
product's flagship feature with no race and no unusual configuration.**

The architecture is right and it is right in the hard places. `buildDeviceSnapshot`
really is a whitelist, all four surfaces really do render it — including the one
the brief suspected, which is clean — and the `FORBIDDEN_KEYS` test really does
cover all four because they share the derivation. Tier is genuinely unforgeable.
Route protection is genuinely deny-by-default. The token handling is correct in
every one of the six places it appears. This is a codebase that has thought
about the right things.

What has gone wrong is narrower and more characteristic: **the price rules are
enforced on the path that was being thought about and not on the paths that were
already there.** `priceSource` was introduced for interval services, threaded
through `resolvePrice`, tested, and rendered correctly on all four surfaces —
and the declined-service path, which predates it, never got it and now reads as
*confirmed* by default. The estimate is redacted from the price slot and then
printed in a badge two inches to the left. The unpriced exclusion is applied in
the snapshot totals, in the tablet footer, in the phone footer, in the printout —
and not in the one function that writes a dollar figure into a permanent DMS
comment.

### The three I would fix first

*(All three independently re-verified by a second model on fresh fixtures — see
§8. Nothing refuted; each held or came out slightly worse.)*

**1. A declined service is quoted from its old record and marked as a
confirmed price.** *(Assigned to Opus — see the side note on F1.)*
`build.ts:267–285` never calls `resolvePrice`, so
`priceSource` is `undefined`, and `snapshot.ts:118` reads `undefined !== 'ESTIMATE'`
as **true**. Reproduced: a decline quoted $449 in 2024 is presented today as
$449, `priceConfirmed: true`, counted in the customer total — while the store's
own book prices that job at $618. The invoice will say $618. That is the $84/$106
scenario in the product's own thesis, at a $169 gap, on the feature the whole
follow-up engine exists to serve. Nothing catches it: `reprice.ts` compares the
frozen $449 against today's sheet, which is also $449, because both read the same
stale field.

**2. Opportunity ids are positional and reused.** `build.ts:610` assigns
`` `${o.type}-${index}` `` over the pre-sort array. Add one recall, or let a
technician's MPI produce an alignment finding, and every later index shifts —
onto a *different item of the same type*. Reproduced: `MAINTENANCE_DUE-0` is
"Engine Air Filter, $75" before the MPI and "Four Wheel Alignment, $149" after.
The frozen snapshot, the decisions, the reprice comparison and the hand-off all
key on that id, and the link flow is explicitly designed to span exactly the
window in which the MPI lands.

**3. The estimate reaches the customer as a badge.** `easyYesReasons`
(`presentation.ts:256–262`) emits `Only $100 to them`, tone `COVERED`;
`snapshot.ts:119–121` keeps every `COVERED` badge regardless of `priceSource`.
Reproduced: an unpriced item renders "Price to be confirmed" in the price slot
and a green badge stating the estimate beside it. The wording is also
advisor-voice — "to them", "Customer pays nothing" — on a screen the customer is
holding.

Fourth, and not a wrong number but a hole the size of the feature: **nothing
reads a link customer's answers.** They are stored correctly and no advisor
surface ever displays them (§3, F4).

None of this has fired in production, because **production has zero
`presentation_sessions` rows** — neither flow has been exercised against the live
database. That is why the review is worth having now rather than after.

---

## 2. The two flows as they actually are

Corrected against the brief. Where the brief was right I say so plainly, because
"I checked and you were right" is worth as much as a finding.

### Menu build — as described, with one wrinkle

`buildPrepSheet` → ranked `Opportunity[]` → `MenuBuilder` (include / exclude /
reorder within tier) → `buildMenu` decides membership and totals. Correct.

The wrinkle: **the advisor's curation is held only in React state.** There is one
`activeSelection` in `prep-sheet-view.tsx:253`, shared by the builder, the
turn-the-screen preview, the printout and `SendToTablet`. It is never persisted.
The client sends `includedIds` to the server, which rebuilds the sheet and
re-derives everything (`present-actions.ts:51`, `:107`) — which is the right
call, and is what makes finding F2 dangerous rather than merely untidy: the ids
are the only thing crossing that boundary, and they do not mean what they meant
when the advisor picked them.

### Reaching the customer — four ways, one derivation, and paper is not the same conversation

**The brief's highest-consequence suspicion is wrong, and cleanly so.**
`present-menu.tsx:66` calls `buildDeviceSnapshot(sheet, selection)` and hands the
result to the same `ServiceMenu` component the tablet and the phone render. So
does `printable-menu.tsx:47`. All four surfaces are one derivation:

| Surface | Component | Data |
|---|---|---|
| Turn the screen around | `PresentMenu` → `ServiceMenu` | `buildDeviceSnapshot` |
| Paired tablet `/present` | `Tablet` → `ServiceMenu` | `buildDeviceSnapshot` (frozen, from the session row) |
| Customer phone `/m/[token]` | `CustomerMenu` → `ServiceMenu` | `buildDeviceSnapshot` (frozen, from the session row) |
| Paper | `PrintableMenu` | `buildDeviceSnapshot`, different markup |

The `talkTrack` exposure the brief feared does not exist. The advisor's own
preview is redacted identically to the customer's tablet, including the
"Price to be confirmed" behaviour. `PROJECT_OVERVIEW.md` §3's "all three now
render from one derivation" is true, and true of paper as well.

**But paper is not the same conversation.** `printable-menu.tsx:90–91` prints two
tick boxes, headed **Yes** then **No**. There is no "Call me about this", and
"Yes" comes first. The screen surfaces render three answers of equal width with
"Not today" first (`service-menu.tsx:228–234`). Same data, different markup,
**different set of answers** — and the answer the product argues hardest for is
the one paper cannot express. Invariant 5 is enforced on three surfaces of four.

### Decisions coming back — true for the tablet, false for the link

The brief says decisions return as `ACCEPTED / DECLINED / CALL_ME / PENDING` via
`decisions.ts`. That is true of the storage layer and of neither channel
end-to-end:

- **Tablet:** `recordDeviceDecisions` stores all four correctly. The mirror onto
  the advisor's screen (`send-to-tablet.tsx:68`) forwards only
  `ACCEPTED | DECLINED | PENDING`. **`CALL_ME` is dropped** (F5).
- **Link:** `recordLinkDecisions` stores all four correctly, and **no advisor
  surface ever reads them.** The only thing that returns from a phone menu is
  `latestAuthorization` — a name, a time, a channel and an amount, which goes
  into the DMS note. The per-item answers are written and never looked at (F4).

### Re-pricing — real, and fed two bad inputs

`reprice.ts` itself is good work: increases only, rounding tolerance, both
thresholds must clear, disappeared lines excluded, the whole thing pure and
tested. It is fed `authorisedLines` built from ids that may have been reassigned
(F2) and prices that may be stale-by-construction (F1), and it includes unpriced
lines at our estimate (F6). The engine is not the problem; its inputs are.

---

## 3. Findings

Ordered by severity. Every "reproduced" line below was executed against the real
functions via `tsx`, outside the repo.

---

### F1 — A declined service is priced from its old quote and presented as confirmed · **Critical**

> **Side note — assigned to Opus.** Fix the declined-service pricing path. The
> defect and the correct behaviour are described below; **Q1 in §7 decides the
> shape of the fix and should be answered first**, because "quote today's price",
> "honour the old quote" and "show both" are three different implementations and
> only one of them is a pure change inside `buildPrepSheet`. My recommendation is
> Q1(c) — old quote as history, today's op-code price as the price — which needs
> an op code on the decline record and a fall-through to `ESTIMATE` where none
> resolves. Whoever takes it should also read F2 first: both defects live in
> `build.ts` and a decline's identity is part of the id question, so fixing the
> price path without deciding the key scheme means touching the same block twice.

**Where:** `src/lib/prep-sheet/build.ts:267–285` (no `priceSource`, no
`resolvePrice`); `src/lib/pairing/snapshot.ts:118`
(`priceConfirmed: o.priceSource !== 'ESTIMATE'`).

**What is wrong.** Every other priced opportunity goes through
`resolvePrice(input.priceBook, opCode, fallback)` and is stamped `STORE` or
`ESTIMATE` (alignment `:320`, tyres `:350`, brakes `:377`, intervals `:430`,
`:495`). The declined-service branch does neither. It sets
`estimatedAmount: decline.quotedAmount` — the number written on a repair order
however long ago — and leaves `priceSource` unset. `snapshot.ts:118` then
evaluates `undefined !== 'ESTIMATE'` → `true`, so the item is presented as a
**confirmed** price and included in every total on every surface.

**Reproduced.** Store book has `BRK-FR` at $618 (333 labour + 285 parts — the
real row in production). A decline of "Front brake pads and rotors" quoted $449
in August 2024:

```
decline.priceSource        : undefined
decline.estimatedAmount    : 449          (store book says 618)
--- what the customer sees
  detail          : Declined 25 months ago at 38,000 miles — quoted $449.
  priceConfirmed  : true
  customer pays   : 449
  snapshot total  : 449
```

**What happens.** The customer is shown $449 as a firm price, agrees to it, and
is invoiced $618. `repriceSinceAuthorisation` does not catch it — it compares the
frozen $449 against today's sheet, which is also $449, because both sides read
the same stale field. The DMS note says "$449 approved at the prices shown".
Every mechanism built to prevent this reads a number that was never checked
against the price book.

**Correct behaviour.** A declined service is a recommendation like any other and
must resolve through the price book. It needs an op code on the decline record
(or a component-group→op-code lookup); where one resolves, quote the store's
current price and mark `STORE`; where none does, mark `ESTIMATE` so the existing
redaction applies. The old quote belongs in the detail text — where it already
is, and where it is useful — not in the price slot. See §7 Q1: there is a real
product argument for honouring the old quote, and it is a *decision*, not a
default that falls out of a missing field.

**Secondary, same block.** Declines set no `customerDetail`, so
`customerDetail(o)` (`presentation.ts:390`) falls back to the advisor `detail`
and the customer reads *"Declined 25 months ago at 38,000 miles — quoted $449."*
That is defensible product copy but it arrives by omission, not by decision, and
it is the one place a customer-facing string is not the sanitised one.

---

### F2 — Opportunity ids are positional and get reused for different services · **Critical**

**Where:** `src/lib/prep-sheet/build.ts:610`
```ts
.map((o, index) => ({ ...o, id: `${o.type}-${index}`, priorityScore: score(o) }))
```

**What is wrong.** `index` is the position in the pre-sort `raw` array, which is
built in fixed source order: recalls → declines → alignment → tyres → brakes →
intervals → unrecorded intervals → PPM → warranty → upsell. Insert or remove any
one item and every later index shifts by one — and because the prefix is only the
*type*, a shifted index frequently lands on a different item **of the same
type**, so the id still parses, still resolves, and points at the wrong service.

Nothing in the codebase claims these ids are stable, and nothing guards it.

**Reproduced — the realistic trigger.** A technician submits an MPI showing
uneven front tread. That adds a `WEAR_PREDICTED` and an alignment
`MAINTENANCE_DUE`, both pushed *before* the interval services:

```
--- C (even wear)                  --- D (uneven wear → alignment appears)
   MAINTENANCE_DUE-0  Engine Air Filter   $75      MAINTENANCE_DUE-0  Four Wheel Alignment  $149
   MAINTENANCE_DUE-1  Cabin Air Filter    $97      MAINTENANCE_DUE-2  Engine Air Filter     $75
   MAINTENANCE_DUE-2  Brake Fluid Exch.  $183      MAINTENANCE_DUE-3  Cabin Air Filter      $97
--- same id, different service:
   MAINTENANCE_DUE-0: C="Engine Air Filter"          D="Four Wheel Alignment"
   MAINTENANCE_DUE-2: C="Brake Fluid Exchange"       D="Engine Air Filter"
   MAINTENANCE_DUE-3: C="Transmission Fluid Service" D="Cabin Air Filter"
```

A second recall arriving does the same thing to declines: `DECLINED_SERVICE-2`
is "Cabin air filter" before and "Front brake pads and rotors" after.

**Why the window is not theoretical.** `loadDriveDay` is uncached and rebuilds
the sheet on every server action (`load.ts:59`, and the price book is
deliberately re-pulled every load, `:86`). The advisor's browser holds
`includedIds` from whenever the page rendered. `sendMenuLink` exists precisely to
be used *after the technician has been under the car* — the brief says so, the
schema comment says so (`devices.ts`, `sequence`), and that is the event that
shifts the indexes.

**What happens, in four places:**

1. **The wrong service reaches the customer.** The advisor ticks "Engine Air
   Filter, $75"; the server rebuilds and sends "Four Wheel Alignment, $149". The
   advisor's preview showed one menu, the customer's phone shows another. The
   claim in `present-actions.ts:14–17` — "a tampered payload cannot put a price
   or a coverage claim on a customer's screen that no engine ever produced" — is
   true and beside the point: the engine produced it, for a different item.
2. **The wrong line reads as accepted.** `readSessionDecisions` returns
   `{ 'MAINTENANCE_DUE-0': 'ACCEPTED' }`; the advisor's screen maps it onto its
   own older sheet.
3. **Spurious or missed re-authorisation.** `comparePrices` matches by id
   (`reprice.ts:112`), takes `title` from the *current* line (`:138`), and with
   `reauth_threshold_percent = 0` and `amount = 0` in production, any remap
   producing a delta over a penny stamps **"PRICE CHANGED SINCE THE CUSTOMER
   AGREED — do not start this work"** on the RO and strips the genuine customer
   authorisation off the note (`handoff-actions.ts:118–127`).
4. **The wrong lines are handed to the DMS.** `safeDecisions` are ids applied to
   a freshly rebuilt sheet (`handoff-actions.ts:86–91`).

**Correct behaviour.** An opportunity id must be derived from what the
opportunity *is*, not where it landed — a stable key over
`(type, componentGroupKey, sourceId ?? opCode ?? title)`, hashed if you want it
opaque. That is a change inside `buildPrepSheet` only; it does not touch the
`DmsAdapter` contract or any engine signature. Two consequences to plan for:
already-stored `presentation_sessions.snapshot` and `decisions` rows carry the
old ids (currently zero rows in production, so this is free today), and
`prepSheetOutcomes.opportunityKey` and any cadence/follow-up rows keyed on the
old scheme need the same treatment.

**Note on the test that looks like coverage.** `selection.test.ts:168` — "survives
a selection referring to something no longer on the sheet" — asserts the *safe*
half: an id that has vanished is dropped. The dangerous half, an id that now
resolves to a different item, is not tested and cannot be, because nothing in the
system knows the id was supposed to mean something.

---

### F3 — The estimate reaches the customer in a badge, in the advisor's voice · **High**

**Where:** `src/lib/prep-sheet/presentation.ts:254–263` (`easyYesReasons`);
`src/lib/pairing/snapshot.ts:119–121` (badge filter).

**What is wrong.** The snapshot redacts the price of an unpriced item and then
copies a label containing that same figure into `badges`. The filter keeps
anything toned `COVERED` or `SAFETY`; the `mostly` reason is toned `COVERED` and
its label is built from `o.customerOutOfPocket`. `priceSource` is not consulted.

**Reproduced.** A VSC-covered item, $100 of $800, `priceSource: 'ESTIMATE'`:

```
priceConfirmed : false
customerTotal  : 0
badges         : [{"label":"Only $100 to them","tone":"COVERED"}]
```

The customer's screen reads **"Price to be confirmed / Your advisor will tell you
before any work starts"** with a green badge two inches away reading **"Only $100
to them"**. The `free` reason does the same at $0: an unpriced item renders
"Price to be confirmed" beside **"Customer pays nothing"**, which is a price
claim.

**Also:** both labels are third person. "Only $100 to **them**" and "**Customer**
pays nothing" are sentences written for an advisor reading about a customer, and
they are rendered on the device the customer is holding. "Turn the tablet around
and have nothing to hide" does not survive the customer reading the shop's
internal register for them.

**Why the test misses it.** `pairing.test.ts` fixes `likelyPayer: 'CUSTOMER_PAY'`
(`:83`), so `covered` is false and neither badge branch ever fires in any
snapshot test. The `FORBIDDEN_KEYS` assertion is a *key* scan
(`json.not.toContain('"estimatedAmount"')`) — a value embedded in a derived
string is invisible to it, by design.

**Correct behaviour.** Two separate fixes. The badge set must be
`priceConfirmed`-aware: a money-bearing badge is a price and belongs under the
same rule as the price slot. And the customer-facing labels need customer-facing
words — "Covered — you pay $100", "Covered in full". `easyYesReasons` currently
serves both the advisor stack and the snapshot from one list; splitting the
label from the advisor label (as `DECISIONS` in `decisions.ts:32–48` already
does with `customerLabel` / `advisorLabel`) is the shape that already exists in
this codebase for exactly this problem.

**A related, smaller thing worth deciding rather than inheriting.** For an
unpriced item the snapshot still ships `customerOutOfPocket` and `fullAmount`
with real figures; only the render suppresses them. `present-menu.tsx:27` states
the doctrine — *"Anything the customer must not see is absent from the data
rather than merely unrendered"* — and for the one field the whole mechanism
exists to protect, that sentence is currently false. Sending `null` for both when
`priceConfirmed` is false would make it true.

---

### F4 — Nothing reads a link customer's answers · **High**

**Where:** absence. `recordLinkDecisions` (`link-store.ts:123`) writes
`presentation_sessions.decisions`; the only readers are the customer's own page
and `latestAuthorization` / `repriceSinceAuthorisation`, which read
`authorizedSnapshot`. `presentationsForVisit` (`:347`) is the function that would
show them and **it has no callers anywhere in the repository** (verified by grep
across `src/` and `scripts/`).

**What happens.** A customer opens the link at lunchtime, accepts brakes,
declines tyres, taps "Call me about this" on the alignment, types their name and
sends. Everything is stored correctly. The advisor's prep sheet shows nothing
change. `computeRunningTotals` still counts all three as remaining. When the
advisor hands off, `HandoffPanel` uses their *own* `decisions` state — so the
lines pushed to the DMS are whatever the advisor decided independently.

The note attached to that push, however, says:

```
CUSTOMER AUTHORISATION
  Confirmed by Betty Lewis on their own phone, from a link we sent.
  Aug 17, 2026, 1:04 PM · $618 approved at the prices shown.
```

built from `latestAuthorization`, which *does* read the frozen decisions
(`link-store.ts:263–267`). So the permanent record asserts a customer authorised
$618 while the RO lines beside it were chosen by somebody else and need not
overlap at all. `authorization-note.ts:9–17` is explicit that this note "is what
somebody reads two months later during a dispute" and that blurring who said what
is "worse than one that says nothing".

**Correct behaviour.** The advisor's screen needs to read back the link session's
decisions the way it already reads back the tablet's — the query exists
(`presentationsForVisit`), the index for it exists (migration 0018), and only the
wiring is missing. Until it does, the honest interim is to *not* emit the
authorisation block for a channel whose answers never reached the lines.

---

### F5 — `CALL_ME` is discarded on the tablet mirror · **High**

**Where:** `src/components/prep-sheet/send-to-tablet.tsx:67–71`
```ts
if (value === 'ACCEPTED' || value === 'DECLINED' || value === 'PENDING') {
  onCustomerDecision(oppId, value)
}
```

**What is wrong.** `OpportunityDecision` includes `CALL_ME`
(`presentation.ts:309`). `decideFromCustomer` accepts it. The polling mirror
filters it out. So a customer standing at the podium taps "Call me about this",
sees the card turn blue, and the advisor's screen never learns.

**What happens.** The item stays `PENDING` in the advisor's state, so
`computeRunningTotals` counts it as still winnable, the hand-off carries no
`CALL_ME`, and `toOutcomeRecords` writes no outcome — which means the follow-up
and cadence engines never see the single highest-intent answer on the sheet.
`decisions.ts:1–25` argues at length that collapsing this answer "throws away the
highest-intent lead on the sheet"; the code collapses it into silence, which is
worse than collapsing it into a decline.

The same file's counter (`:72`) counts non-`PENDING` decisions, so the advisor is
told "3 answered" while two answers appear.

**Correct behaviour.** Forward all four values. The filter looks like it was
guarding against `SKIPPED` leaking in from the advisor enum; the type it actually
needs to exclude is `SKIPPED`, not `CALL_ME`.

---

### F6 — Unpriced items are counted in the amount written to the permanent DMS record · **High**

**Where:** `src/lib/presentation/link-store.ts:263–267`
```ts
const authorisedAmount = items
  .filter((i) => decisions[i.id] === 'ACCEPTED')
  .reduce((sum, i) => sum + i.customerOutOfPocket, 0)
```

**What is wrong.** Every other total in the system excludes unpriced lines — the
snapshot (`selection.ts:227–235`), the tablet footer (`tablet.tsx:167`), the
phone footer (`customer-menu.tsx:44`), the advisor preview
(`present-menu.tsx:74–76`), the printout — and so does the audit row written in
this very file, 55 lines above, which filters `.filter((i) => i.priceConfirmed)`
(`:210`). `latestAuthorization` does not.

**What happens.** The customer's screen said "Price to be confirmed" and their
running total excluded the item. They tap Yes on it and confirm. The DMS comment
then reads *"$X approved at the prices shown"* where X includes our estimate for
an item whose price was never shown. That is the one field in the hand-off that
makes a claim about a person, in the one record built to survive without our
software.

`repriceSinceAuthorisation` (`:324–327`) has the same gap: unpriced lines enter
`authorisedLines` at our estimate, so `authorisedTotal` in the "PRICE CHANGED"
warning is a number nobody quoted.

**Correct behaviour.** Add the `priceConfirmed` filter in both places — the
`.filter((i) => i.priceConfirmed)` on line 210 is the model, and its presence
there is what makes this a slip rather than a disagreement.

---

### F7 — A tablet session never expires, and unpairing does not end it · **Medium**

**Where:** `src/lib/pairing/store.ts:185–198` (`pushToDevice` sets no
`expiresAt`); `src/app/devices/actions.ts:45` (`unpairDevice` revokes the device
and leaves the session `ACTIVE`).

**What is wrong.** `presentation_sessions.expires_at` exists and is populated
only by `createLinkPresentation` (`link-store.ts:78`). Tablet sessions get
`null`, and no read path consults it anyway: `activeSessionForDevice`
(`store.ts:202`) filters on `status = 'ACTIVE'` and nothing else. A tablet
session ends only when the advisor takes it back or pushes another menu.

**What happens.** A tablet on a bench at close of business is still displaying
the last customer's name, vehicle, mileage, findings and prices — for anyone who
walks past, overnight, until somebody pushes something else. `tablet.tsx:149–152`
states the intended behaviour exactly (*"A tablet between visits should tell a
passer-by nothing about the last customer who held it"*) and it holds only for
the idle state, which is reached only by an explicit take-back.

Unpairing does kill *access* promptly and correctly — `deviceFromToken`
(`store.ts:63`) returns null on `revokedAt`, the tablet gets 401 within one
1.5-second poll, clears its token and re-enrols. But the session row stays
`ACTIVE`, so `readSessionDecisions` keeps reporting `active: true` and the
advisor's panel keeps saying the menu is on a tablet that no longer exists.

**Correct behaviour.** An idle timeout on tablet sessions (the customer is
standing there — minutes, not hours), enforced in `activeSessionForDevice`
against `lastActivityAt` rather than only at push time; and `revokeDevice` should
end the device's active sessions in the same statement.

---

### F8 — Stale taps reappear on a re-pushed tablet menu · **Medium**

**Where:** `src/app/present/tablet.tsx:88` (`setPending({})` only when the
session is `null`) and `:162` (`{ ...state.decisions, ...pending }`).

**What is wrong.** The tablet keeps an optimistic `pending` map so a tap feels
instant. It is cleared when the advisor takes the menu back — that path is
handled and commented. It is **not** cleared when a *new* session arrives, and
the poll never compares session ids.

**What happens.** The advisor re-curates and presses "Send to tablet" again.
`pushToDevice` ends the old session and creates a new one with `decisions: {}`.
The tablet polls, adopts the new snapshot, and merges the previous customer's
in-flight taps over it. Ids collide readily — it is the same appointment and, per
F2, often the same ids for different services. The customer sees answers already
marked that they did not give on this menu, the server has none of them, and the
advisor's screen shows the item unanswered.

**Correct behaviour.** Clear `pending` whenever the session id changes, not only
when it disappears.

**Related, same file:** `acceptedCount` (`:169`) counts `Object.values(decisions)`
without scoping to the current snapshot's ids, so ghosts inflate "You have said
yes to N of M". `present-menu.tsx:69` scopes correctly to snapshot items; the two
footers disagree.

---

### F9 — Answers tapped after a link expires are silently discarded · **Medium**

**Where:** `src/app/m/[token]/actions.ts:18–21` (`saveAnswer` returns `void`);
`src/lib/presentation/link-store.ts:129` (returns the session unchanged when not
`OPEN`).

**What is wrong.** The server guard is correct and runs on every write — that
part is genuinely enforced (see §5). The failure is that it is silent.
`recordLinkDecisions` returns the session without recording; `saveAnswer`
discards the return value; `CustomerMenu.decide` (`customer-menu.tsx:50–54`) has
already set the answer optimistically and never learns.

**What happens.** A customer leaves the tab open over lunch, comes back after the
twelve hours, works through the menu, watches every tap register — and none of it
is saved. They only find out at the end, when "Send to my advisor" returns *"This
link is no longer accepting answers."* Everything before that was theatre.

**Correct behaviour.** `saveAnswer` should return the resulting status and the
page should surface an expired link at the first rejected tap. The copy already
exists and is good (`link.ts:86` — *"nothing you chose has been lost"* — which,
in this path, is not currently true).

---

### F10 — `sequence` is never set for a tablet presentation · **Medium**

**Where:** `src/lib/pairing/store.ts:185–195`. `createLinkPresentation` computes
`max(sequence) + 1` (`link-store.ts:61–68`); `pushToDevice` inserts without the
column and takes the schema default of `1`.

**What happens.** Every tablet presentation on a visit claims to be the first
conversation. Send a menu to a tablet at write-up (seq 1), a link after the MPI
(seq 2), then a second tablet menu at delivery — that one is seq 1 again. The
`(appointment_id, sequence)` index is not unique, so nothing complains, and
"which conversation this was on the visit" — the thing migration 0018 was written
to model, and the schema comment's *"1 at write-up, 2 after the technician's
inspection"* — is wrong for one of the two channels.

**Correct behaviour.** `pushToDevice` should compute the sequence the same way
`createLinkPresentation` does. Better, both should share one helper, since the
two implementations are the drift this migration exists to prevent.

---

### F11 — Reordering dies after an advisor unticks and re-ticks an item · **Low**

**Where:** `src/lib/menu/selection.ts:150` (`toggle` appends to the end) and
`:160–180` (`move` refuses when the adjacent id is in another tier).

**What is wrong.** `defaultSelection` returns a tier-sorted list, and `move`'s
tier check assumes adjacency in `includedIds` implies adjacency in the tier.
`toggle` appends a re-included id at the end, breaking that assumption. `move`
then sees a neighbour from a different tier and correctly refuses — but the
advisor has done nothing wrong and the button silently does nothing.

**Reproduced.**
```
initial      : NOW_a, NOW_b, SOON_c, PLAN_d
after retick : NOW_b, SOON_c, PLAN_d, NOW_a
after "up"   : NOW_b, SOON_c, PLAN_d, NOW_a   (unchanged = true)
```
Both NOW items now have dead arrows. Grouping is still correct — `buildMenu`
groups by tier regardless of list order, so the customer sees a sane menu and
**invariant 3 is not violated**. The advisor simply cannot reorder any more, with
no explanation, immediately after doing the most ordinary thing in the builder.

**Correct behaviour.** Either insert a re-included id back in tier order, or have
`move` swap with the next id *of the same tier* rather than the adjacent one.
`move`'s refusal-rather-than-clamp behaviour is right and should be kept.

---

### F12 — `presentationsForVisit` is dead code with an inverted comment · **Low**

**Where:** `src/lib/presentation/link-store.ts:346–367`.

```ts
/** Every presentation on a visit, oldest first. What the advisor view reads. */
...
    .orderBy(desc(schema.presentationSessions.sequence))
```

Two claims, both false: it is ordered **newest first**, and no advisor view reads
it — it has no callers at all. This is the same shape as the commercial-history
bug already recorded in the repo's history, caught before it shipped only because
nothing calls the function.

Flagged rather than dismissed because F4 wants exactly this function wired up,
and whoever does it will read that comment first.

---

### F13 — `/api/device` `enroll` is unauthenticated and unlimited · **Low**

**Where:** `src/app/api/device/route.ts:46–49`.

`enroll` runs before the bearer check (correctly — a new tablet has no token) and
inserts a `paired_devices` row with a 6-character code. There is no rate limit
(`src/lib/rate-limit/` is not imported here) and no uniqueness on `pairing_code`
— `devices.ts` declares a plain `index`, not a `unique`.

Honest severity: the guessing attack is not the concern. The code space is
32⁶ ≈ 1.07 × 10⁹ with a ten-minute window, so an attacker needs on the order of a
million concurrently-live codes for a ~0.1% chance of intercepting any given
pairing. The realistic harm is unbounded row growth from an endpoint anyone can
POST to. Production currently holds exactly **one** `AWAITING_PAIRING` row, so
nothing has happened.

Worth noting anyway: `claimDevice` (`store.ts:95–104`) selects
`WHERE pairing_code = ? AND status = 'AWAITING_PAIRING'` with `.limit(1)` and no
`ORDER BY`, so if a collision ever does exist, which device an advisor pairs to
their store is arbitrary. A unique partial index on `pairing_code WHERE status =
'AWAITING_PAIRING'` costs nothing and removes the question.

---

### F14 — A tap racing a take-back is dropped with no error to anyone · **Low**

**Where:** `src/app/present/tablet.tsx:119–123` (ignores the response of
`decide`); `src/components/prep-sheet/send-to-tablet.tsx:184–187` (tears down the
poll immediately after `takeBackMenu`).

The customer taps; 200ms later the advisor takes the menu back;
`recordDeviceDecisions` finds no `ACTIVE` session and the route returns 409. The
tablet ignores it and keeps showing the tap as selected until the next poll
clears it. Meanwhile `setSessionId(null)` stops the advisor's mirror, so the final
poll may never run and the last up-to-1.5s of answers are never mirrored.

Answers recorded *before* the take-back are safe — they are persisted on the row,
which keeps its `decisions` after `endSession` flips the status. They are simply
never read again (F4, F12). See §5 for the full answer to this question.

---

## 4. Invariants audited

| # | Invariant | Verdict | Where |
|---|---|---|---|
| 1 | Never quote a price the DMS will not charge | **Not enforced** | See below |
| 2 | A preference is not an authorization | **Enforced** | `decisions.ts:57`, `authorization-note.ts:71–72`, all four surfaces' footers |
| 3 | Tier comes from measurement, never a choice | **Enforced** | `selection.ts:46`, `:160–180`; server re-derives in `present-actions.ts:67` |
| 4 | Customer-facing data is a whitelist | **Partially enforced** | `snapshot.ts:92`; keys yes, values no (F3) |
| 5 | Three answers of equal weight, "Not today" first | **Partially enforced** | `service-menu.tsx:228–234` yes; `printable-menu.tsx:90–91` no |
| 6 | Bearer credentials: 32 bytes, SHA-256, raw never persisted | **Enforced** | `codes.ts:51–57`, `link.ts:43–52` |
| 7 | Deny by default | **Enforced at the route; application-level below it** | `routes.ts:85–89`; see below |
| 8 | Pure engines, thin screens | **Enforced, with one gap** | See below |

**1 — Not enforced.** The mechanism is correct and comprehensively applied:
`resolvePrice` stamps the source, `defaultSelection:130` keeps `ESTIMATE` items
off the menu unless the advisor deliberately ticks them, `buildMenu:227–235`
excludes them from both totals, and all four renderers check `priceConfirmed`.
Three holes: declines never enter the mechanism at all and default to *confirmed*
(F1); the estimate leaks through a badge that bypasses the price slot (F3); and
`latestAuthorization` includes unpriced lines in the figure written to the DMS
(F6). The first of these is a real price gap in front of a real customer, so this
cannot be marked "partially".

**2 — Enforced, and carefully.** Every customer-facing footer says the advisor
confirms before work starts. `authoriseLinkSession` writes `userId: null`
deliberately (`link-store.ts:186–194`) rather than attributing a customer's act
to staff. `authorizationNote` returns `null` when the advisor recorded the
answers themselves, and the note carries its own limitation in the record. The
one place this frays is F4 — an authorisation block attached to lines the
customer's answers never touched — which is a wiring hole rather than a breach of
the principle.

**3 — Enforced, three ways.** `tierOf` reads only `o.urgency`. `move` refuses a
cross-tier swap and I verified it cannot be tricked by list disorder (F11 is the
same guard being too strict, not too loose). And the client sends only
`includedIds`, never a tier or an urgency, so the server's rebuild is
authoritative. One caveat worth stating: an advisor cannot *promote* an item, but
under F2 an id can resolve to an item in a tier they never saw — substitution,
not promotion, and F2's fix closes it.

**4 — Partially enforced.** The structure is right and the brief's specific worry
is unfounded: because all four surfaces render `buildDeviceSnapshot`, the
`FORBIDDEN_KEYS` test at `pairing.test.ts:127` covers all four, not one. It also
correctly catches the `talkTrack` *wording*, not just the key. What it cannot
catch is a forbidden **value** re-emitted inside a whitelisted field — which is
exactly F3, where `estimatedAmount`/`customerOutOfPocket` arrive inside a badge
label. The fixture (`likelyPayer: 'CUSTOMER_PAY'`) also never reaches the badge
branch.

**5 — Partially enforced.** Screens: correct, and the comment at
`service-menu.tsx:206–227` records why (equal grid widths, 52px targets, a tick as
well as colour). Paper: two boxes, "Yes" first, no "Call me". There is **no test
of any customer-facing rendering** — vitest's include is `src/**/*.test.ts` and
there is not a single `.test.tsx` in the repository — so this invariant is held
only by the shared component, and the surface that does not use it broke it.

**6 — Enforced everywhere I checked.** `randomBytes(32)`, SHA-256 at rest, raw
value returned once and never written. Device tokens (`codes.ts:51`) and link
tokens (`link.ts:43`) are identical in shape. `tokenMatches` uses
`timingSafeEqual` with a length guard. Lookups are by hash, so the raw value never
reaches a query. `paired_devices_token_hash` is unique; migration 0018 adds a
unique partial index on `access_token_hash`. No complaints.

**7 — Enforced at the route; below it the guarantee is different from the one
`PROJECT_OVERVIEW.md` describes.** `isPublicPath` is a prefix allowlist and
`/present`, `/m`, `/api/device` are routing-public only. The guards run on every
read and every write:

- `/api/device` — bearer checked on every action before anything else
  (`route.ts:51–58`), then `status === 'PAIRED'` re-checked on both `poll` and
  `decide`. `NO_STORE` on every response.
- `/m/[token]` — `force-dynamic`; the page resolves the token, and *both* server
  actions re-resolve it rather than trusting the page (`actions.ts:13–15` says so
  and does so).
- Advisor actions — `requireUser()` first line of every one, including
  `takeBackMenu`.

The difference worth writing down: this whole subsystem runs on `getDb()`, which
**bypasses RLS**. The link path documents why and is right — a customer has no
session for a policy to resolve. But the advisor path uses it too, so tenant
isolation here is hand-written `storeId` predicates, not the database guarantee
that `src/db/README.md` describes ("a query that forgets `WHERE store_id = ?`
returns nothing"). I traced every one — `listDevices`, `revokeDevice`,
`sessionForAdvisor`, `endSession`, `latestAuthorization`,
`repriceSinceAuthorisation` all scope correctly, and `pushToDevice` is scoped by
its caller rather than itself. It is correct today. It is correct by discipline,
and the next function added here will be too unless somebody remembers.

**8 — Enforced, with one gap.** `selection.ts`, `decisions.ts`, `link.ts`,
`reprice.ts`, `codes.ts`, `pricing.ts` and `build.ts` are all I/O-free and tested;
`snapshot.ts` is pure over them. The screens are thin. The gap is that
`buildDeviceSnapshot` composes `easyYesReasons`, which was written for the
advisor stack, and inherits its vocabulary and its price-blindness (F3) — a pure
function reused across a trust boundary it was not written for.

---

## 5. Answers to the specific questions

**Does the turn-the-screen-around path use the snapshot?** Yes. `present-menu.tsx:66`
builds `buildDeviceSnapshot(sheet, selection)` and passes it to the same
`ServiceMenu` the tablet and the phone use; the printout inside it does the same.
There is no `Opportunity` rendering left on any customer-facing surface. The
"one derivation" claim is true, and the comment at `present-menu.tsx:14–28`
recording that it used not to be is accurate history rather than aspiration.

**What happens to a tablet when the advisor re-curates?** The snapshot is frozen
per session, so the tablet cannot be changed under the customer — that part works
as described. What is not handled is the *replacement*: pressing "Send" again ends
the old session and starts a new one, and the tablet adopts the new snapshot
while carrying the previous customer's optimistic taps across (F8). Items added
or removed are simply a different menu. A price change between the two sends is
invisible to the customer, who sees only the new numbers.

Re-authorisation through to the glass: `reprice.ts` never reaches a customer
screen at all. It runs at hand-off time (`handoff-actions.ts:118`) and its only
output is a block of text in the DMS note plus the suppression of the
authorisation claim. That is a defensible design — the conversation about a price
change is a conversation, not a screen — but "re-authorisation" is currently a
warning to the shop, not a re-ask of the customer. There is no path that puts the
moved price back in front of them.

**`takeBackMenu` and decisions already made.** They are **kept, and then
orphaned**. `endSession` flips `status` to `ENDED` and touches nothing else, so
`decisions` survives on the row. But the advisor's mirror is torn down in the same
click (`send-to-tablet.tsx:186–187`), so the last polling interval's answers are
never shown; a tap racing the take-back is rejected with a 409 the tablet ignores
(F14); and no surface ever reads an ended session again, because the function that
would (`presentationsForVisit`) has no callers (F12). The answers exist in the
database and in nobody's workflow.

**Expiry, enforced where.** *For the link: correctly, on every request.*
`linkSessionFromToken` recomputes `linkStatus(row, now)` on every call, and the
page, `saveAnswer` and `authorise` all resolve the token independently rather than
trusting what was rendered. The open-tab case is guarded server-side. The defect
is that it is silent to the customer (F9). *For the device token and the tablet
session: not at all.* The token is long-lived by design and dies only on revoke,
which is the right model for a bench device and works promptly. The **session**
has an `expires_at` column that `pushToDevice` never populates and no read path
consults (F7) — so a menu stays on a tablet indefinitely.

**Repeatable presentations (0018).** A second presentation always creates a new
row. `createLinkPresentation` counts `max(sequence) + 1` across every prior
session on the appointment, which is the right rule; `pushToDevice` never sets it
and takes the default of 1, so tablet sessions all claim to be the first
conversation (F10). Earlier decisions do **not** carry into a new presentation —
each row starts `decisions: {}` — which I think is correct: a second conversation
should ask again rather than present a customer with answers they gave hours ago
about a different list. `pushToDevice` also ends any prior `ACTIVE` session on
that device first, so a tablet can never show two menus; that is explicitly
commented and it does what it says. Production has zero sessions of any kind, so
none of this has been exercised.

**Totals arithmetic.** Better than I expected, with one hole. There is no tax
anywhere in this codebase and no rounding until display: every total is a plain
`reduce` over floats, and `money()` is `Math.round` at the last moment on each
surface identically (`service-menu.tsx:33`, `tablet.tsx:29`,
`authorization-note.ts:37`). So the advisor's total, the tablet's, the phone's and
the printed one all derive from the same `buildDeviceSnapshot` and **agree
exactly** — including on excluding unpriced lines, which all five call sites do.
`reprice.ts` uses a 1¢ tolerance to stop float drift triggering a
re-authorisation, which is the right instinct.

Where they can disagree:
- **`latestAuthorization` vs everything else** (F6): the DMS figure includes
  unpriced lines at our estimate. The gap is the sum of accepted unpriced items —
  unbounded, and in the seeded data an unpriced brake job would put it in the
  hundreds.
- **The hand-off panel vs the customer's screen**: `handoff-panel.tsx:70` totals
  accepted items with no `priceConfirmed` filter, so the advisor's copy-paste
  block can exceed what the customer was shown by the same amount.
- **Rounding is per-total, not per-line**, so no accumulation error exists.

**Unpairing a device.** The token dies immediately and correctly: `revokeDevice`
sets `revoked_at`, `deviceFromToken` returns null on it, and the tablet gets a 401
on its next poll (≤1.5s), clears `localStorage` and falls back to enrolling. It
does **not** keep rendering what it has — the 401 branch resets state to
`LOADING` explicitly, and the comment says why. What survives is the session row,
still `ACTIVE`, so the advisor's panel keeps claiming the menu is on a tablet that
is gone (F7).

---

## 6. What I could not determine

- **Whether F2 has ever fired.** It cannot have, because production holds zero
  `presentation_sessions` rows — but that also means I could not observe the
  real-world rate at which `raw` membership changes during a visit. Settling it
  needs one instrumented day: log the sheet's id set at menu-build and again at
  send, and count the diffs. That is a write, so I did not do it.
- **How often `priceSource: 'ESTIMATE'` occurs at a real dealership.** The single
  seeded store maps all 19 op codes the engine names, so the ESTIMATE path never
  fires there and F3 is invisible in demo. Every one of those codes (`LOF`,
  `BRK-FR`, `TIRE4`…) is our own invention, so a real store's book will match
  approximately none of them until somebody maps them — which makes ESTIMATE the
  *normal* state on day one of any real integration, not the exception. Settling
  it needs one real `pullPriceBook` result.
- **Whether `pullPriceBook` failing mid-visit is survivable in practice.**
  `load.ts:86` swallows the error to `null`, which correctly degrades everything
  to "Price to be confirmed" and $0 totals — honest, and I think right. But
  `defaultSelection` then returns an empty selection, the builder shows "0 of N on
  the menu", and both send buttons disable. The advisor's recovery is to tick
  everything back on by hand, which I could not test end-to-end without a live
  adapter failure.
- **Whether any historical `prepSheetOutcomes` / cadence rows are keyed on the
  positional ids.** They use `opportunityKey`, which is populated from the same
  ids, so a fix for F2 has a migration tail. Counting the affected rows is a read
  I did not run because I did not want to guess at which of the retention tables
  carry it; `grep opportunityKey` is the five-minute version.
- **Whether the `advisorId` on a session is ever used for authorisation.** It is
  written and, as far as I can see, only ever read back as data. If it is meant to
  scope `takeBackMenu` to the advisor who sent the menu, it does not — any
  authenticated user in the store can end any session. That may well be correct
  for a drive where advisors cover each other.

---

## 7. Open questions for Dan

**Q1 — What price does a resurfaced decline carry?** This is the product call
underneath F1, and the fix depends on the answer.

- *(a) Today's op-code price.* Correct against invariant 1 and against the
  invoice. Costs you the "you were quoted $449 two years ago" continuity, and a
  customer who kept the old estimate sees the number go up.
- *(b) The old quote, honoured.* Great for trust, and the detail text already
  says it. Requires the store to actually bill it, which we cannot make them do —
  so it is a promise the DMS may not keep, which is the thing we exist to prevent.
- *(c) The old quote shown as history, today's price as the price.* "Quoted $449
  in Aug 2024 · $618 today". Two numbers, honestly labelled, and the difference
  becomes an argument for doing it now rather than an ambush.

**Recommendation: (c).** It is the only one that is both true and useful, it
needs no new data, and the rising number is a better close than the stale one. It
does require an op code on the decline record; where none resolves, fall through
to `ESTIMATE` and let the existing redaction do its job.

**Q2 — Should paper carry three answers?** Adding a "Call me" column is trivial;
the question is whether a paper "call me" is a promise you can keep, since nothing
collects the sheet back into the system.

- *(a) Add the third box and reorder to Not today · Call me · Yes.* Consistent
  with every other surface; the advisor transcribes it.
- *(b) Leave paper at two answers and say so* — print "Ask your advisor to note
  anything you'd like a call about."
- *(c) Drop the tick boxes entirely* and make paper a leave-behind rather than a
  response form.

**Recommendation: (a), with the order fixed regardless.** "Yes" printed first, on
the artefact the customer keeps, is the exact tell the product is built to avoid —
and it is the one surface where you cannot fix it after the fact.

**Q3 — Where do a link customer's answers land on the advisor's screen?** F4 is
a wiring job, but the shape is a product decision.

- *(a) Merge them into the advisor's decision state* as the tablet's do. Simplest,
  and the hand-off then reflects what the customer chose. Risk: it overwrites an
  advisor's own decision on the same line without saying which won.
- *(b) A separate "what they answered" panel* the advisor reads and acts on.
  Slower, and preserves the distinction `decisionSources` already tracks.
- *(c) Merge, but mark provenance per line* — which `DecisionSource` was built for
  and `provenanceNote` already renders.

**Recommendation: (c).** The machinery exists, the DMS note already distinguishes
"the customer selected it on Lane 3" from "the advisor recorded it", and it is the
only option where the authorisation block and the RO lines are describing the same
event.

**Q4 — How long may a menu stay on a tablet?** F7's fix needs a number.

- *(a) 30 minutes idle.* Matches the podium conversation; a tablet left mid-visit
  clears itself before the next customer walks up.
- *(b) End of business day.*
- *(c) Never — take-back only, as now.*

**Recommendation: (a).** The failure mode this guards is a stranger reading a
named customer's vehicle, mileage and prices off an unattended screen, and thirty
minutes is long enough that no real conversation is interrupted. Whatever the
number, it belongs in `activeSessionForDevice` so it is enforced on read rather
than only at push.

**Q5 — Does a re-authorisation ever go back to the customer?** Today a price
moving past the threshold produces a warning on the RO and strips the
authorisation claim; the customer is never re-asked by the software.

- *(a) Keep it as is.* The advisor rings them. Honest, and matches "we advise, we
  do not adjudicate".
- *(b) Send a second link for the changed lines only.* The mechanism is already
  there — a new session, a new sequence, a smaller snapshot.

**Recommendation: (a) for v1, and say so in the note.** (b) is the better product
eventually, but it needs the state-law question settled properly, and a
re-authorisation flow that is subtly wrong is worse than a phone call.

---

## 8. Verification — second-model pass on the three critical findings

The audit above was performed by Opus 5. The three critical findings were then
independently re-verified by Fable 5 as an adversarial pass: fresh fixtures,
different trigger scenarios, and a deliberate attempt to *refute* each finding
rather than re-derive it. Nothing was refuted; each came out the same or
slightly worse than written.

**F1 — CONFIRMED, and upgraded.** Reproduced on a different fixture (a $289
transmission-service decline from 2023 against a book price of $367): `priceSource`
undefined → `priceConfirmed: true` → on the default menu unasked → in
`customerTotal` → `reprice` verdict `UNCHANGED`. Refutation attempts failed: the
only five `priceSource` writers in the repository are the `resolvePrice` call
sites, and the mapper (`map.ts:254–262`) passes `quotedAmount` through verbatim.
Two additions that make it worse than the finding states:

- `service.ts:219` comments `quotedAmount` with *"Re-quote before re-offering"*,
  and `PLAN.md` leak #1 says *"Persist every decline, re-price it, resurface
  it."* The code violates its own recorded intent — the comment is the evidence,
  which under this repo's rules makes this a broken invariant, not just a bug.
- Confirmed there is no op-code field on the decline anywhere (schema, wire
  type, mapper), so the fix genuinely requires new data or a lookup, as the
  finding says.

**F2 — CONFIRMED, with a quieter trigger class.** The original pass demonstrated
substitution via *additions* (a recall arriving, an MPI landing). Reproduced here
via a *removal* — `reconcile/` resolving a decline in the background, which needs
no technician and no OEM pull: advisor ticks `DECLINED_SERVICE-1` ("Rear brake
pads and rotors, $540"), customer receives `DECLINED_SERVICE-1` ("Battery
replacement, $307") — marked *confirmed*, because F1 and F2 compound. Removals
also have a second mode the finding did not call out: when the shifted index
falls off the end entirely, the advisor's tick is **silently dropped**
(itemCount 0, no error) — the safe direction, but still a menu that quietly
disagrees with what was approved.

**F3 — CONFIRMED, with a sharper boundary.** Reproduced at the snapshot
(`priceConfirmed=false`, badge `"Only $62 to them"`) and verified at the render
layer: `service-menu.tsx:137` shows badges whenever `badges.length > 0`,
independent of the `priceConfirmed` ternary. Two refinements that narrow the fix:

- **The leak is payer-dependent.** Recall- and PPM-covered unpriced items get
  non-monetary badges ("Manufacturer pays", "Already paid for") because those
  branches win in `easyYesReasons` — clean. Money leaks only through the `free`
  and `mostly` branches, i.e. VSC/warranty-style coverage. The badge fix can
  target exactly those two.
- **Paper is clean** — `PrintableMenu` renders no badges at all.

---

*Reviewed against `main` at `1cab528`. Test suite green: 1,024 passing, 31 skipped.
All reproductions executed outside the repository; no repository file other than
this document was added, changed or deleted, and no write was made to the
database. §8 verification pass (Fable 5) run against the same commit.*
