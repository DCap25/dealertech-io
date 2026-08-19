# Brief: audit the menu and the tablet hand-off

A prompt to hand to a model (Fable) in this repo. The output is
`docs/MENU_REVIEW.md`. This file is the input, not the deliverable.

---

You are auditing the two paths this product is judged on: how a service advisor
builds a menu, and how that menu reaches a customer. Both are live code with
tests. Your job is to find where they are wrong, not to admire them.

## Your task

Produce `docs/MENU_REVIEW.md` — a findings document, in the house style of
`docs/PLAN.md` and `docs/SAAS_PLAN.md` (decisions and reasoning stated plainly,
alternatives kept, nothing hedged into uselessness).

DO NOT WRITE IMPLEMENTATION CODE. No fixes, no refactors, no new files beyond
the deliverable. If something is broken, describe the defect and what correct
behaviour would be; somebody else decides whether and how to fix it. You may
read anything, run the test suite, and add *temporary* scratch files outside the
repo to check a hypothesis — but the repo diff at the end must be one new
document.

## The failure mode you are hunting

This codebase's recurring bug is not a crash. It is **code that renders
plausibly and is quietly wrong** — and the last three sessions each found one:

- An activation panel that showed "0 of 8 setup steps" for every tenant,
  forever, because it read under a policy that withheld the rows. It looked
  right. It was wrong in the same direction every time.
- A `platform:create` script documented as the way to rotate a password, which
  reported success and changed no password at all.
- A commercial history ordered ascending under a comment promising "newest
  first", so past 25 rows the console showed the oldest ones.

Two of those were found by checking the data path rather than by looking at the
screen, which would have shown a believable answer. Audit accordingly: **verify
against the code and the database, never against a comment or a doc.**
`PROJECT_OVERVIEW.md` is largely accurate and is still a claim, not evidence. Where
this brief states something as fact, check it too — if I am wrong, that is a
finding.

## Read first (in this order)

1. `PROJECT_OVERVIEW.md` §2 — the principles the code is supposed to enforce
2. `src/lib/prep-sheet/build.ts` — the opportunity engine everything downstream renders
3. `src/lib/menu/selection.ts` — the advisor's curation and the totals
4. `src/lib/pairing/snapshot.ts` — `buildDeviceSnapshot`, the whitelist that
   defines what a customer may ever see
5. `src/app/drive/present-actions.ts` — the hub: `sendMenuToDevice`,
   `sendMenuLink`, `readSessionDecisions`, `takeBackMenu`
6. `src/lib/presentation/decisions.ts`, `link.ts`, `link-store.ts`, `reprice.ts`
7. `src/lib/pairing/codes.ts`, `store.ts`
8. `src/components/prep-sheet/menu-builder.tsx`, `present-menu.tsx`,
   `printable-menu.tsx`; `src/components/present/service-menu.tsx`
9. `src/app/present/*`, `src/app/m/[token]/*`, `src/app/api/device/route.ts`,
   `src/app/devices/*`
10. `src/lib/auth/routes.ts` and `src/db/README.md` — the two security seams

## The two flows, as I understand them

Stated so you can correct me rather than rediscover me. Roughly 3,800 lines.

**Menu build.** Prep sheet produces ranked `Opportunity` records → the advisor
curates in `menu-builder.tsx` (include, exclude, reorder within tier) →
`selection.ts` decides what is on the menu and computes totals.

**Reaching the customer, four ways.** `present-menu.tsx` (turn the screen
around) · `/present` on a paired tablet, claimed by an advisor and authenticated
by its own bearer token · `/m/[token]` on the customer's phone, a 12-hour
single-visit link · `printable-menu.tsx` on paper. `PROJECT_OVERVIEW.md` claims
all of these "render from one derivation" (`buildDeviceSnapshot`).

**Decisions come back** as `ACCEPTED` / `DECLINED` / `CALL_ME` / `PENDING` via
`decisions.ts`, with `reprice.ts` handling re-authorisation when a price moves.

## The invariants to audit against

Each of these is claimed by `PROJECT_OVERVIEW.md` §2. For each, answer: is it
actually enforced, where, and what would it take to violate it?

1. **Never quote a price the DMS will not charge.** Menu prices resolve from the
   store's op-code price book. No op code means the customer sees "Price to be
   confirmed" and the item is excluded from *every* total. Check every renderer
   and every total, including paper. An item silently priced at our estimate, or
   included in a total it should not be in, is the single worst defect available
   here — it is the exact argument the product exists to prevent.
2. **A preference is not an authorization.** A customer tapping Yes records what
   they want; it must not create a record that reads as legal authorisation.
3. **Tier comes from measurement, never from a choice.** An advisor may include,
   exclude and reorder *within* a tier, and must not be able to promote an item
   into "Needs attention now" — through the UI, through a crafted request, or
   through reordering that changes tier as a side effect.
4. **Customer-facing data is a whitelist, not a filter.** `talkTrack`,
   `closeProbability`, `priorityScore`, `estimatedAmount`, `likelyPayer`,
   `sourceId`, `type` and `urgency` must not appear at any depth in anything a
   customer receives. There is a test; check the test is testing the real path
   for all four surfaces, not just one.
5. **Three answers of equal visual weight, "Not today" first.** A buried decline
   is the thing that makes a customer discount the brake warning too.
6. **Bearer credentials**: 32 random bytes, SHA-256 at rest, raw value never
   persisted. Device tokens and menu links both.
7. **Deny by default.** `/present`, `/m` and `/api/device` are in the public
   prefix list in `src/lib/auth/routes.ts` — meaning routing-public, guarded by
   token. Verify the guard actually runs on every read *and* every write.
8. **Pure engines, thin screens.** Anything deciding something is I/O-free and
   tested; the UI renders over it.

## Questions I specifically want answered

Do not treat this as the boundary of the audit — it is where I suspect
something, and I may be suspicious in the wrong places.

- **Does the turn-the-screen-around path actually use the snapshot?** If
  `present-menu.tsx` renders from `Opportunity` directly rather than from
  `buildDeviceSnapshot`, then the "one derivation" claim is false and the
  screen an advisor physically hands to a customer is the one surface with no
  whitelist between it and `talkTrack`. Check this first; it is the highest
  consequence question in the audit.
- **What happens to a tablet when the advisor re-curates?** The snapshot is
  described as frozen. If the advisor adds an item, drops one, or a price
  changes after sending, what does the tablet show, and what does the customer
  end up agreeing to? Trace `reprice.ts` and re-authorisation through to what
  is actually on the glass.
- **`takeBackMenu` and decisions already made.** What happens to a decision the
  customer recorded seconds before the advisor took the menu back? Is it kept,
  discarded, or orphaned?
- **Expiry, enforced where.** The 12-hour single-visit link and the device
  token: is expiry checked on every request, or only when the page first loads?
  A session that stays open past expiry is the interesting case.
- **Repeatable presentations** (migration 0018). What happens on a second
  presentation in one visit — a new session, a reused one, and do earlier
  decisions survive?
- **Totals arithmetic.** Rounding, tax, "price to be confirmed" exclusions, and
  whether the advisor's total, the tablet's total, the phone's total and the
  printed total can ever disagree. If they can, say by how much and when.
- **Unpairing a device.** Does the token die immediately, and does a tablet mid-
  session lose access or keep rendering what it has?

## Constraints

- **`.env.local` points at the production Supabase database. A local write is a
  live write.** Read freely; do not insert, update or delete. If a question can
  only be answered by writing, say so in the document instead of writing.
- The test suite is `npm test` — 1,024 passing across 50 files. Run it. If you
  believe something is broken that tests claim works, reconcile the two
  explicitly: either the test is asserting the wrong thing, or you are wrong.
- Do not change the pure engines' interfaces or the `DmsAdapter` contract, even
  in a suggestion, without saying what else moves.
- No SMS in v1 (TCPA). Links are delivered by copy-and-paste, deliberately.
- This is a mature repo with deliberate invariants. Where the code looks odd,
  read the comment above it first — several of them are the only record of a
  bug that took a long time to find. If you conclude the comment is now wrong,
  that is itself a finding worth writing down.

## Deliverable

`docs/MENU_REVIEW.md`:

1. **Verdict in one page** — is this correct enough to put in front of a
   customer, and the three things you would fix first.
2. **The two flows as they actually are** — corrected against my summary above,
   including where I was wrong.
3. **Findings**, each with: what is wrong, the exact file and line, how to
   reproduce or the reasoning that proves it, what a customer or advisor
   experiences when it fires, and severity. Order by severity, not by file.
4. **Invariants audited** — the eight above, each marked enforced / partially
   enforced / not enforced, with where.
5. **Answers to the specific questions**, including the ones where the answer
   is "this is fine and here is why".
6. **What I could not determine**, and what would settle it.
7. **Open questions for Dan** — product calls rather than technical ones, each
   with options and your recommendation.

Be specific and be willing to say a thing is fine. A review that manufactures
findings to look thorough is worse than a short one, because it costs the same
to read and teaches me to discount the next one. The worst outcome is a
document that reads as confident everywhere and is quietly wrong about what the
code does.
