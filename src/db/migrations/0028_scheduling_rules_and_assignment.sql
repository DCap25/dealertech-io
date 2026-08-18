-- Give the book rules, and every assignment a reason.
--
-- ===========================================================================
-- WHY
-- ===========================================================================
-- DealerTech owns the appointment book (DRIVE_PLAN D1, decided), and until now
-- it has owned it without a single rule: nothing said how many cars a Tuesday
-- can take, and `advisor_id` was a column with no policy behind it. That is how
-- one advisor's Monday 8am takes five write-ups while the next lane starves,
-- and how an argument about a scorecard becomes unanswerable — an advisor's
-- numbers mean nothing if nobody can say how their book was dealt.
--
-- Two things land here, and they are the two halves of one feature:
--
--   1. `scheduling_rules` — the frame (store hours, slot length) and the caps.
--      The caps are the ADVISOR'S BOOK, never the shop floor: technician hours
--      are dispatch, dispatch is the DMS's, and modelling bays here would be
--      inventing per-store truth we cannot see (D2 and D3, both decided). The
--      one building-level number is `max_waiters_per_slot`, because a lounge
--      holds so many people whoever's book they sit in.
--
--   2. `appointments.assigned_by` / `assignment_reason` — the audit trail on
--      the assignment cascade (D4). Who chose, and which of the four steps
--      produced it.
--
-- Nothing here blocks anything. Capacity warns (D3, and the menu builder's own
-- `menuWarnings` precedent): "Marcus is at 4 of 4 write-ups for Tuesday" is a
-- sentence for the booker, who may know exactly why a fifth is fine. A hard
-- refusal only teaches them to book it as a phone note, and then the system has
-- lost the appointment AND the truth. DRIVE_PLAN §9 Q3 — whether any store
-- needs over-booking to hard block — is open, and deliberately not built: there
-- is no per-store flag below, because a flag nobody asked for is a flag
-- somebody has to maintain.
--
-- ===========================================================================
-- SEQUENCING
-- ===========================================================================
-- APPLY THIS BEFORE THE CODE THAT READS IT DEPLOYS. This one breaks reads the
-- way 0026's column did, and harder: `appointments` is selected whole in a
-- dozen places (the drive, the write-up, the customer record, the DMS mapper),
-- and Drizzle names every column of the schema in those selects. Against a
-- database without `assigned_by` and `assignment_reason`, every one of them
-- fails with "column appointments.assigned_by does not exist" — the drive
-- itself, not just the new booking screen.
--
-- `scheduling_rules` is the milder half: only the booking surface reads it, and
-- a store with no rows falls through to the engine's shipped defaults, so the
-- table being empty is a normal state rather than an error.
--
-- Idempotent. Applied with `npm run db:apply` — see src/db/README.md.

-- ---------------------------------------------------------------------------
-- 1. The rules.
--
-- One row per store per weekday. A weekday with NO row is a day the store is
-- closed — that is how Sunday is expressed — and a store with no rows at all
-- falls through to DEFAULT_RULES in src/lib/scheduling/rules.ts, so a fresh
-- dealership can book on day one without configuring anything.
--
-- Times are minutes from local midnight rather than `time` columns. A `time
-- without time zone` answers "07:00" and leaves open which 07:00, and every
-- calculation the engine does is arithmetic on minutes anyway; storing the unit
-- it computes in removes a parse and a question at once. The store's own
-- timezone (`stores.timezone`) is the one they are read in.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scheduling_rules (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id              uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,

  -- 0 = Sunday … 6 = Saturday, matching JavaScript's Date#getDay so the engine
  -- and the column agree without a lookup table.
  weekday               smallint NOT NULL,

  open_minute           integer NOT NULL,
  close_minute          integer NOT NULL,
  slot_minutes          integer NOT NULL DEFAULT 30,

  -- How many customers one advisor can greet in one slot. Usually 1-2.
  max_per_advisor_slot  integer NOT NULL DEFAULT 2,
  -- Write-ups per advisor per day — also the number balanced assignment weighs.
  max_per_advisor_day   integer NOT NULL DEFAULT 16,
  -- The lounge, across every book.
  max_waiters_per_slot  integer NOT NULL DEFAULT 4,

  -- DRIVE_PLAN §9 Q1, OPEN. Auto-assign at booking, or leave it for whoever
  -- claims it at arrival? Defaults to auto-assign per the §9 recommendation,
  -- pending Dan — some drives genuinely run as a first-free-writer line, and
  -- picking one in code would be the product overruling the store.
  auto_assign           boolean NOT NULL DEFAULT true,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- The hours have to be a real interval, and the caps have to be reachable. A
  -- close before an open silently produces an empty slot grid, which reads to
  -- the booker as "the store is closed" on a day it is not.
  CONSTRAINT scheduling_rules_weekday_range CHECK (weekday BETWEEN 0 AND 6),
  CONSTRAINT scheduling_rules_hours_ordered CHECK (close_minute > open_minute),
  CONSTRAINT scheduling_rules_day_bounds    CHECK (open_minute >= 0 AND close_minute <= 24 * 60),
  CONSTRAINT scheduling_rules_slot_positive CHECK (slot_minutes > 0),
  CONSTRAINT scheduling_rules_caps_positive CHECK (
    max_per_advisor_slot > 0 AND max_per_advisor_day > 0 AND max_waiters_per_slot > 0
  )
);

-- One row per store per weekday, which is the shape the engine reads: a second
-- Tuesday row would mean two answers to "when do we open", and whichever the
-- database returned first would win.
CREATE UNIQUE INDEX IF NOT EXISTS scheduling_rules_store_weekday_unique
  ON scheduling_rules (store_id, weekday);

CREATE INDEX IF NOT EXISTS scheduling_rules_store_idx
  ON scheduling_rules (store_id);

COMMENT ON TABLE scheduling_rules IS
  'Store hours and the caps on an advisor''s book, per weekday. No row for a weekday means closed; no rows at all means the engine''s shipped defaults.';
COMMENT ON COLUMN scheduling_rules.auto_assign IS
  'Assign an advisor at booking, or leave the appointment in the unassigned pool for whoever claims it at arrival. DRIVE_PLAN §9 Q1, open.';

-- ---------------------------------------------------------------------------
-- Tenant isolation, the same shape every other store-scoped table has carried
-- since 0001: FORCE, and one FOR ALL policy keyed on store_id. Load-bearing —
-- a store's hours and caps are theirs, and a rules row leaking sideways would
-- quietly re-shape another dealership's book.
--
-- The grant is SELECT only, and that is deliberate rather than an oversight.
-- Nothing in P2 edits these rows: there is no settings screen yet, and the seed
-- and migrations run on the privileged connection. When a rules editor lands it
-- needs INSERT/UPDATE here — and should consider gating it on
-- `current_user_manages_store` the way 0021 gated the roster, because an
-- advisor quietly raising their own day cap is exactly the change the audit
-- trail above exists to make visible.
--
-- Until then the failure mode is the loud one: "permission denied for table
-- scheduling_rules". The other order — a grant with no policy — is the silent
-- one, where the write affects zero rows and the screen looks like it worked.
-- src/db/README.md documents both.
-- ---------------------------------------------------------------------------
ALTER TABLE scheduling_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduling_rules FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scheduling_rules_tenant_isolation ON scheduling_rules;
CREATE POLICY scheduling_rules_tenant_isolation ON scheduling_rules
  FOR ALL TO authenticated
  USING (store_id IN (SELECT public.current_user_store_ids()))
  WITH CHECK (store_id IN (SELECT public.current_user_store_ids()));

GRANT SELECT ON public.scheduling_rules TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. The assignment trail.
--
-- Both nullable, and null is the ordinary case for every appointment recorded
-- before today or pulled from a DMS — an imported row genuinely has no answer
-- to "who chose this advisor", and inventing one would be worse than admitting
-- it.
--
-- `assigned_by` is NOT `created_by`, which already exists and is always the
-- person at the keyboard. This one is who chose the ADVISOR, and it is null
-- whenever a rule chose rather than a person: the balancer, the owning
-- relationship, or the store's claim-at-arrival setting. D4 words that actor
-- as "SYSTEM"; a sentinel uuid standing for it would need either a
-- login-shaped row in `users` that is not a person — which every join and
-- every roster screen then has to know to hide — or a foreign key that does
-- not resolve. Null says the same thing in the type, and `assignment_reason`
-- already records which rule it was.
-- ---------------------------------------------------------------------------
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS assigned_by uuid REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS assignment_reason text;

COMMENT ON COLUMN appointments.assigned_by IS
  'Who chose the advisor — not who booked, which is created_by. Null when a rule chose rather than a person; assignment_reason says which rule.';
COMMENT ON COLUMN appointments.assignment_reason IS
  'REQUESTED · OWNING · BALANCED · CLAIMED · MANUAL (DRIVE_PLAN D4). Text, not an enum: the vocabulary is younger than the table and will grow. src/lib/scheduling/assign.ts is the authority.';

-- ---------------------------------------------------------------------------
-- 3. The write grants — a policy is not a grant, the fifth time.
--
-- src/db/README.md documents the trap and 0021 and 0025 each fixed a round of
-- it. The pattern repeats for the same reason it did in 0025: those migrations
-- audited "every table the application writes", and at that moment nothing in
-- DealerTech created an appointment at all. `appointments` has carried a FOR
-- ALL tenant-isolation policy since 0001 and, like `customers` before 0025, no
-- grant of its own to `authenticated` — harmless exactly as long as nothing
-- tried to insert one.
--
-- The booking action tries, under `withCurrentUserScope`, which is right: an
-- advisor or a BDC rep booking inside their own store is precisely the case
-- row-level security exists for.
--
-- `cadence_tasks` and `call_logs` are here for the same reason 0025 restated
-- `vehicles` and `declined_services`: the BDC outcome path already writes them
-- through the scoped connection in production, so the privileges are believed
-- to exist, and GRANT is idempotent. Stating them costs nothing next to
-- discovering a gap when a booking commits and the follow-up it came from
-- silently does not close.
--
-- DELETE is absent from all three. Booking can add appointments and change
-- them; it has no business removing a dealership's records.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON public.appointments  TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.cadence_tasks TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.call_logs     TO authenticated;
