# The founder's desk — a mini CRM and an onboarding backend for /admin

**Status: BUILT and VERIFIED 2026-08-20, per the house pipeline. Two
adversarial lanes ran against it; security, the provisioning transaction and
the live grants all held, and six consistency defects were found and fixed —
the record is in §8, which is the section to read first.**

**Four claims in the scope turned out to be wrong against the code. Each is
corrected in place below and listed here so the corrections are reviewable
rather than silent:**

1. **§2, the stage table: "`walkthrough_at` set, future → WALKTHROUGH_BOOKED".**
   Taken literally, a lead slides back to TOURED the moment its appointment
   time passes — a card moving backwards on its own, which is the one thing
   derivation exists to prevent. Built so that any `walkthrough_at` proves
   WALKTHROUGH_BOOKED; the clock changes the sentence beside the chip ("booked
   for Thursday" versus "was booked for Tuesday — mark it done"), not the
   stage. Pinned in `stage.test.ts`.
2. **§4: ".ics served from a platform-admin server action, never a public
   route" — correct, and the reason needed sharpening.** Built as an action
   returning the file as a string for the browser to save. A route would put a
   prospect's name and phone number behind a guessable uuid.
3. **§5: "`docs/SAAS_PLAN.md`'s 'stages stay unbuilt' note".** No such note
   exists in SAAS_PLAN.md — the decision was written down in
   `src/app/admin/actions.ts` (`recordLeadOutcome`), which this doc's own
   opening cites. Both were updated: the SAAS plan's `/admin/leads` line now
   points here, and the code comment now says what changed and why the seam it
   named (one column on the table) is the one thing the build did not use.
4. **§3 P4: "the invite link again, copyable — today it vanishes after
   provisioning".** It cannot be shown again: only the token's SHA-256 is
   stored, deliberately (`createInvitation`), so there is nothing to recover.
   The checklist offers a fresh invitation instead, which also revokes the
   pending one — better anyway, since the old link may have expired.

**Two things the scope did not ask for and the build added, both stated for
review:** reopening a lost lead (LOST hides a lead from every stage tab at
once, and a flag that can only be set is one nobody trusts — it writes
`LEAD_MARKED_LOST` with `reopened: true` rather than a fifth audit verb), and
`reissueAdminInvite` on the tenant page, which correction 4 requires and which
reuses the existing `STAFF_INVITED` action.

Dan sells, demos, signs and onboards every dealership himself. The admin
console already does the *tenant* half well (lifecycle actions, activation
tracking, support access, tour codes). What it does not do is the *prospect*
half: there is no pipeline, no walkthrough booking, no per-lead history
beyond one notes textarea, and the road from "signed" to "advisors working"
has holes the console cannot see. This build is that desk.

The repo already wrote down the constraint that governs the design
(`src/app/admin/actions.ts:118-138`): a pipeline was deliberately unbuilt
"until a second person is selling." That day is not here either — so this
stays a **founder's desk, not a sales team's CRM**: no owners, no
assignment, no quotas, no email automation. One person, faster.

## 1. Ground rules (established by survey, 2026-08-20)

- Migration head is 0034. New tables take the **0034 grants incantation**
  (REVOKE ALL from anon/authenticated, then GRANT the minimum) because
  Supabase default-privileges pre-grant everything including TRUNCATE.
  ENABLE + FORCE RLS, idempotent SQL, prose header, COMMENT ON.
- **A policy is not a grant and a grant is not a policy** (0016/0017 and
  0021 lessons — both bit before). New platform-read policies need both.
- Console conventions: reads scoped / writes privileged (with the comment
  naming the README row), `requirePlatformAdmin()` everywhere, 404 never
  403, `nowMs()` hoisted once per page, reasons required on actions that
  change state, append-only history rendered as its own section.
- **No email SDK exists and none arrives in this build.** Delivery is
  copy-paste and prefilled `mailto:` — adding a sender means a fifth
  subprocessor and same-day trust-page changes. Out of scope, noted in §6.
- The privacy policy enumerates every use of lead data ("that is the whole
  list"). This build adds uses (stage, walkthrough time, activity log), so
  `src/app/legal/privacy/page.tsx` §2 changes **in the same commit**.

## 2. The pipeline — facts first, hands second

One new column on `demo_requests` plus one new table, and a pure function
that turns facts into a stage.

**Stages:** `NEW → CONTACTED → CODE_SENT → TOURED → WALKTHROUGH_BOOKED →
WALKTHROUGH_DONE → PROVISIONED → LIVE`, terminal `LOST` (reason required).

**Derivation over declaration.** `src/lib/crm/stage.ts` — pure, unit-tested
— computes the stage from what actually happened:

| Fact | Source (already exists) | Stage it proves |
|---|---|---|
| `contacted` | demo_requests | CONTACTED |
| a tour code issued | demo_tour_codes.demoRequestId | CODE_SENT |
| a code redeemed | demo_tour_codes.uses > 0 | TOURED |
| `walkthrough_at` set | new column | WALKTHROUGH_BOOKED (see correction 1) |
| `walkthrough_done_at` set | new column | WALKTHROUGH_DONE |
| org provisioned from lead | new `provisioned_org_id` FK | PROVISIONED |
| that org's first menu presented | onboarding `FIRST_MENU_PRESENTED` | LIVE |

Manual input exists only where no fact can: `walkthrough_done_at` (Dan
says the call happened), `lost_at + lost_reason`. LOST wins over
everything; otherwise the stage is the furthest fact. Nobody drags cards
backwards, because the facts do not move backwards.

**Schema (0035):**
- `demo_requests` gains `walkthrough_at`, `walkthrough_done_at`,
  `lost_at`, `lost_reason`, `provisioned_org_id` (FK organizations,
  SET NULL). No `stage` column — the stage is computed, so it can never
  disagree with the facts. (`referrer` stays as-is: still unwritten,
  still not listed on the privacy page.)
- **`lead_events`** — the activity log the single notes field cannot be:
  `id, demo_request_id (FK cascade), kind ('NOTE'|'CALL'|'STAGE'|'SYSTEM'),
  body, occurred_at, created_by_user_id`. Append-only by convention (no
  update/delete path in code), platform-read policy + grant, privileged
  writes. System events (code issued, provisioned) are written by the
  actions that do the thing; audit_log keeps its closed vocabulary for
  the security record, lead_events is the business narrative. The
  existing `notes` column stays for the "current position" summary;
  history goes to events.

## 3. The screens

**P1 — `/admin/leads/[leadId]` — the lead, in full.** The card list stays
for triage; this is the desk. Header (contact, dealership, qualifiers,
stage chip with the fact that proves it), the activity timeline
(lead_events, newest first, add-note form), the tour-code panel (moved
component, unchanged), walkthrough booking (§4), outcome controls
(contacted / lost-with-reason), and provisioning — which on success now
links straight to the new tenant's page. 404 on unknown id, like tenants.

**P2 — `/admin/leads` becomes the pipeline.** Stage tabs with counts
(replacing the two-tab All/Not-contacted; `?filter=new` keeps working —
it maps to the NEW tab so the morning-read link does not break). Cards
gain a stage chip, next-step hint ("code issued 3d ago, never used"),
and link to P1. Email/phone become `mailto:`/`tel:` links — the
deliberate-selectable-text reasoning gave way to the founder's desk being
where email actually gets sent.

The tour-code panel and its new prefilled "Email it" `mailto:` (subject
and body carrying the code, the /tour URL and the expiry, so delivery is
one click plus Send) live **on P1 only** — this paragraph originally
described them here, which contradicted P1's "the tour-code panel (moved
component)" three lines above. P1 is the one that was built and the one
that is right: the list is for triage, and a list with a code-issuing
panel under every row is the wall of forms this page was rebuilt to stop
being.

**P3 — the morning read learns the funnel.** New tiles wired into
`loadNeedsAttention()` in its own style ("each count is a thing somebody
has to do something about"): `Walkthroughs today`, `Codes expiring
unused (3d)`, `Leads gone quiet (7d in stage)`. A "This week" section
lists upcoming walkthroughs with lead links. And the navigation gap
closes: `/admin` finally links to `/admin/tenants`.

**P4 — onboarding, from signed to live.** On `/admin/tenants/[orgId]`:
- The Activation section grows a **go-live checklist** per rooftop, each
  item either proven by fact or carrying the pointer to the thing that
  does it: admin invite accepted (or: **issue a fresh one** — the original
  cannot be shown again, see correction 4), staff invited, price book
  synced, history imported, first appointment, first menu. Facts come
  from `loadProgressForPlatform()` and the invites table — counting, not
  reading, per the platform rule.
- **`provisionFromLead` becomes transactional** — org + store + invitation
  in one transaction (the survey found a mid-failure orphans an org), sets
  `provisioned_org_id` on the lead, writes the SYSTEM lead_event, and its
  audit row (it writes none today).
- **Default cadence rules at provisioning.** A fresh tenant has zero
  cadence rules, so its follow-up worklist is empty forever — nothing
  outside the demo seed creates them. Extract the seed's rule set into
  `DEFAULT_CADENCE_RULES` in `src/lib/cadence/defaults.ts`, used by both
  the seed and provisioning, so the two cannot drift. (Both /signup's
  `provisionTenant` and admin's `provisionFromLead` get them.)

## 4. Walkthrough booking — a datetime, not a calendar

`walkthrough_at` on the lead, set from P1 (datetime-local, store-agnostic:
the founder's timezone is the only one that matters yet). Shown on the
card, the detail page, and the morning read. An **.ics download** (pure
generator in `src/lib/crm/ics.ts`, unit-tested; served from a platform-
admin action, never a public route) so it lands on Dan's own calendar.
Rebooking overwrites and writes a lead_event; done is `walkthrough_done_at`.
No Calendly, no Google Calendar — a third party for one man's diary is a
subprocessor for nothing.

## 5. Audit and honesty

- New audit actions (closed vocabulary): `LEAD_WALKTHROUGH_BOOKED`,
  `LEAD_MARKED_LOST`, `LEAD_PROVISIONED` (fixing today's silent
  provisioning), alongside the existing `LEAD_OUTCOME_RECORDED`.
- Privacy policy §2, same commit: the demo-request use list gains
  scheduling the walkthrough, tracking where the conversation stands, and
  the activity notes; the tour-codes section already covers code usage.
- The "stages stay unbuilt" note gets updated to point here rather than
  silently contradicted. It is **not** in `docs/SAAS_PLAN.md` (correction 3):
  it lives in `src/app/admin/actions.ts`, and both that comment and the SAAS
  plan's `/admin/leads` line were changed.

## 6. Out of scope, on purpose

Email sending (fifth subprocessor + trust-page day — revisit at volume);
lead capture from anywhere but the existing form; owners/assignment/quotas
(one seller); per-tenant DMS credential config (`dms_connections` exists
but nothing reads it — separate investigation); a public booking page
where prospects pick a slot (nice v2 — needs rate limiting and abuse
thought, and the CRM's booking field works without it); an audit-log
viewer UI (still absent everywhere, still a separate feature).

## 7. Verification notes (for the pass after the build)

The claims worth attacking: stage derivation against every fact
combination (LOST beats all; PROVISIONED without TOURED — codes are
optional — must not regress the stage); the transaction actually rolling
back all three writes; `?filter=new` still landing correctly from the
morning read; the privacy list matching the new columns exactly; the 0035
grants matching 0034's shape (check the live catalog, not the file);
cadence defaults arriving for BOTH provisioning paths and the seed still
passing; nothing on the new pages readable by a non-platform-admin (404,
not 403, throughout).

## 8. Verification record — 2026-08-20

Two adversarial lanes ran against the build. What they attacked, what held,
and what they broke.

### What held

- **Security.** Every new surface is behind `requirePlatformAdmin()` and 404s
  rather than 403s. The `.ics` is a server action rather than a route, so a
  prospect's name and phone are not behind a guessable uuid. No new
  `dangerouslySetInnerHTML`, no lead data on a public page.
- **The transaction.** `provisionFromLead` genuinely rolls back all of it — a
  failing invitation leaves no organisation, no store, no cadence rules, no
  lead update, no timeline entry and no audit row. Pinned by a fake database
  in `actions.test.ts` that stages writes and discards them on throw, which is
  what Postgres does.
- **The live grants.** `lead_events` reads `authenticated: SELECT`, nothing for
  `anon`, ENABLE + FORCE RLS, one platform-read policy — byte-identical to
  `demo_requests` and `demo_tour_codes` in the catalog rather than in the file.
- **`?filter=new`** still lands from the morning read, on the NEW tab.
- **The seed** still typechecks and passes, importing the same
  `DEFAULT_CADENCE_RULES` both provisioning paths use.

### What they broke, and what changed

Everything found was consistency rather than correctness or security — but
five of the six were the same shape, and it is worth naming: **a number and
the page it links to, computed twice.**

1. **Issuing a code wrote no timeline entry.** Only the audit row. Three
   consequences: the timeline was missing its most common system event, the
   privacy policy's "entries the software writes itself when it issues a code"
   was an over-claim, and `lastActivityAt` never moved — so a lead could be
   flagged as having gone quiet the morning after Dan sent them a code. Fixed
   inside `issueTourCode`'s existing transaction, beside the code and its
   audit row, so the three commit together or not at all. The privacy sentence
   is now true as written and was left alone.

2. **`codesExpiringUnused` was a third implementation of the predicate** —
   inline in `loadNeedsAttention`, three fields, no lost or provisioned
   exclusion. A lost lead holding a live code was counted on a tile linking to
   a tab it can never appear on. Now `hasCodeExpiringUnused` in
   `src/lib/crm/stage.ts`, which asks `deriveStage` rather than restating it,
   and is shared with `nextStep`'s escalation.

3. **The uncontacted tile counted `contacted = false` in SQL** while the tab
   behind it showed derived NEW — so an uncontacted lead holding a tour code
   was on the tile and absent from the tab. Now `isNewLead`, derived. Tile
   renamed to "New leads", because "not contacted" stopped being its truth.

4. **`walkthroughsToday` used a UTC calendar day**, so an evening demo in Texas
   landed on tomorrow's tile — contradicting the founder-timezone stance
   migration 0035's own comment takes. Now `src/lib/crm/founder-day.ts`, one
   `FOUNDER_TIMEZONE` constant that moves when Dan does, DST-correct in two
   passes. The tile is also counted from the rows the page's own "this week"
   section renders and links to that section by anchor, rather than to a stage
   tab a provisioned lead cannot be on — a demo whose dealership is already
   provisioned is still a real appointment on a real morning.

5. **Stage edges.** An issued-then-revoked code keeps the lead at CODE_SENT —
   deliberate, because un-sending is not something the world can do, and a
   withdrawal moving a card backwards is the one motion the design forbids.
   It now has a test saying so. What was wrong was the nag: it told Dan a code
   he withdrew himself was "never used". It now says the code is withdrawn or
   expired and to issue another. The single-order monotonicity test was
   replaced by all 5,040 arrival orders of the seven facts.

6. **The cadence backfill gap was invisible.** New tenants get the defaults;
   every tenant provisioned before this build has none, and an empty follow-up
   worklist reads to them as "nothing to work". Surfaced as a
   "Follow-up rules present" row on the go-live checklist, and
   `scripts/backfill-cadence-rules.ts` fixes it — listing by default, writing
   only on `--apply`, skipping any rooftop with rules at all.

The rule the tiles now follow, and the reason it is a property rather than an
intention: **every tile is counted by the same predicate that decides what its
destination shows.** `stage.test.ts` enumerates all 64 combinations of the six
facts that could disagree and asserts it.

### Left for Dan

- **Run the backfill.** `npm run cadence:backfill` lists the affected rooftops
  and writes nothing; `npm run cadence:backfill -- --apply` writes. Not run as
  part of this build: `.env.local` is production, and inserting rules into
  other people's dealerships is a decision rather than a build step.
- **The tour-code panel lives on the lead detail page only.** Verified as
  matching P1, which is what was built; the P2 paragraph describing it on the
  list was the stale one and has been corrected.
