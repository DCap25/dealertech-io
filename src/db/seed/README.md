# The demo dealership

```bash
npm run db:seed        # wipe and rebuild Lone Star Ford
npm run cadence:run    # generate the follow-up worklist from it
npm run auth:provision # give every seeded staff member a login
```

Run all three, in that order, after any change to this directory. The seed
wipes and rebuilds; it is safe to re-run as often as you like.

## The demo day

The dealership lives on a **fixed date**, not on the wall clock. Every
appointment, repair order, inspection and cadence task is generated relative to
`demoNow()` in `src/lib/demo-day.ts`, and every surface in the app reads "today"
from the same function. That is the whole convention: change `DEMO_DAY` in one
file, re-seed, and the entire product moves with it.

It is fixed rather than live so that a screenshot taken today still matches the
app next month, a bug report describes the same dealership on every machine, and
nothing fails at midnight. Set `DEMO_DAY_ISO=""` in the environment to follow
real time instead.

The randomness is seeded too (`random.ts`), so two people running `db:seed` get
byte-identical dealerships — but note that **adding or removing a single
`chance()` call shifts the whole stream**, so the customer names attached to any
given case will change. Never hard-code a seeded name or id in a test or a
document.

## What is guaranteed, and why

Most of the data is deliberately random, but a demo cannot depend on a dice roll
landing. These are constructed, not sampled:

| Guarantee | Why it exists |
|---|---|
| Staff ids are `stableId(...)`, not random | Supabase auth users carry the same uuid as the `users` row, and RLS resolves a tenant through `auth.uid()`. Random ids would sign every advisor into an empty dealership after each re-seed. |
| Some vehicles were in **this calendar week** | The scorecard's week starts Monday. Left to chance, the newest RO in the store landed before it and every "this week" revenue tile read a truthful $0. |
| Those visits are dealt round-robin across advisors | So both demo advisors have current-week numbers, not just whichever one got lucky. |
| The first eight of them are under five years old, and always carry a **warranty-paid line** | "Covered revenue unlocked" is the number this product exists to move. Every seeded line used to be customer pay, so it was structurally $0 on every scorecard. |
| Today's drive opens with a fixed **showcase set** | A second-owner and an original-owner Korean SUV (10yr/100k powertrain is original-owner only, so two near-identical cars look nothing alike), a prepaid plan about to expire, a tire & wheel contract, an active VSC, and a vehicle whose factory coverage is running out with nothing behind it. |

## Deliberate limits

- **No open decline is older than about eleven months.** The dormant tail exists
  so the win-back cadence has something to work on, but a follow-up task 600
  days overdue reads as broken software rather than as lost revenue. Declines
  from earlier visits are always resolved.
- **Capture and easy-yes rates start empty.** They measure what an advisor
  *never raised*, which only a finished prep sheet records — there is no honest
  way to seed them, and the scorecard says so on screen instead of inventing a
  number.
