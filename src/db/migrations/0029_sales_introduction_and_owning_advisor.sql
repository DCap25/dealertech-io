-- Give the dealership a salesperson, and the customer an advisor of their own.
--
-- ===========================================================================
-- WHY
-- ===========================================================================
-- Two facts land here, and DRIVE_PLAN puts them in one phase because the first
-- is what first writes the second.
--
--   1. THE DELIVERY INTRODUCTION (D5). The highest-leverage retention moment a
--      store owns is delivery: the customer is in the building, happy, keys in
--      hand. A walk to the service drive, a named advisor shaking their hand,
--      and the first maintenance visit already on the calendar is what turns a
--      sales customer into a service customer. Until now that workflow had no
--      actor — `user_role` held nine values and none of them sold cars — and no
--      vocabulary: nothing in `appointment_source` named a delivery.
--
--   2. THE OWNING RELATIONSHIP (D6). `customers` had no relationship field, so
--      "their advisor" was not a fact the system could know, and step 2 of the
--      assignment cascade (0028, src/lib/scheduling/assign.ts) was a tested
--      seam every caller fed null. It becomes real here.
--
-- The rule the columns exist to enforce, stated once: an owning advisor is set
-- at the moments the relationship actually forms — the introduction, or the
-- first completed visit when nobody owns the customer yet — and is NEVER
-- silently reassigned by traffic patterns. A relationship the system moves on
-- its own is not one.
--
-- ===========================================================================
-- ENUM VALUES AND THE TRANSACTION THE RUNNER OPENS
-- ===========================================================================
-- `scripts/apply-migrations.ts` hands each file to `sql.unsafe(text)`, which
-- sends it as one simple query — and Postgres wraps a multi-statement simple
-- query in an implicit transaction block. That matters for `ALTER TYPE … ADD
-- VALUE` specifically:
--
--   * Before Postgres 12 it could not run inside a transaction block at all.
--     Supabase is well past that, and 0007 already added a value to
--     `contract_source` through this same runner, which is the precedent.
--   * From 12 on it is allowed, with one live restriction: **the new value
--     cannot be used until the transaction commits.** So nothing below may
--     reference 'SALES' or 'SALES_INTRO' — no default, no CHECK, no backfill.
--     Nothing does; the values are used by the application on the next
--     deploy, long after this file has committed. Adding a seed row here
--     would fail with "unsafe use of new value of enum type".
--
-- `IF NOT EXISTS` per the idempotent-migration house rule: running this twice
-- is a no-op rather than a duplicate_object error.
--
-- ===========================================================================
-- SEQUENCING
-- ===========================================================================
-- APPLY THIS BEFORE THE CODE THAT READS IT DEPLOYS — the same discipline 0026
-- and 0028 carry, and for the same reason, now on two tables at once.
-- `appointments` and `customers` are both selected whole in a dozen places (the
-- drive, the write-up, the customer record, the search, the DMS mapper), and
-- Drizzle names every column of the schema in those selects. Against a database
-- without these columns every one of those reads fails with "column
-- customers.owning_advisor_id does not exist" — the customer list itself, not
-- just the new introduction page.
--
-- Idempotent. Applied with `npm run db:apply` — see src/db/README.md.

-- ---------------------------------------------------------------------------
-- 1. The two enum values.
-- ---------------------------------------------------------------------------
-- The smallest role in the product, and deliberately so. One page —
-- "introduce a customer to service" — that finds or creates the customer and
-- vehicle, books the first service through the same rules and cascade every
-- other booking uses, and optionally names the advisor. No drive, no prep
-- sheets, no customer lists. Deny-by-default already protects every other
-- route; src/lib/auth/sales.ts is the explicit fence on top of it.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'SALES';

-- Its own source value rather than folding into ADVISOR, because the whole
-- point is that it is countable: "how many of this month's deliveries were
-- walked to the drive" is the report a sales manager asks for, and it is
-- unanswerable if the introduction books as an ordinary advisor booking.
ALTER TYPE appointment_source ADD VALUE IF NOT EXISTS 'SALES_INTRO';

-- ---------------------------------------------------------------------------
-- 2. The introduction, on the appointment.
--
-- All three nullable, and null is every appointment that did not come off a
-- sales floor — which is nearly all of them, now and forever. There is no
-- backfill: an appointment recorded before today genuinely has no answer to
-- "who sold the car", and inventing one would be worse than admitting it.
-- ---------------------------------------------------------------------------
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS introduced_advisor_id uuid REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS sold_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS visit_context text;

COMMENT ON COLUMN appointments.introduced_advisor_id IS
  'Who the customer was walked over to at delivery. Not advisor_id: this is the introduction, which enters the D4 cascade as a REQUESTED assignment. A later reassignment moves advisor_id and must not rewrite this — who was introduced is history.';
COMMENT ON COLUMN appointments.sold_by_user_id IS
  'The salesperson. Attribution is half the reason sales gets a login at all (DRIVE_PLAN D5) — a tokened link with no account could never answer "whose deliveries got walked to the drive".';
COMMENT ON COLUMN appointments.visit_context IS
  'FIRST_SERVICE, or null. Text rather than an enum, following presentation_sessions.channel: one value today, and "what kind of visit is this" is exactly the vocabulary that grows. src/lib/prep-sheet/first-service.ts is what renders it.';

-- Finding a salesperson's own deliveries — the one list the introduction page
-- shows back to the person who booked, and the shape any future
-- "did my deliveries show up" report reads. Partial, because the column is null
-- on essentially every row and an index over those nulls would be waste.
CREATE INDEX IF NOT EXISTS appointments_sold_by_idx
  ON appointments (sold_by_user_id, scheduled_at)
  WHERE sold_by_user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. The owning relationship, on the customer.
--
-- One column, plus when and why. `owning_advisor_source` is text for the same
-- reason `assignment_reason` is: SALES_INTRO · FIRST_VISIT · REQUESTED ·
-- MANAGER_SET is a young vocabulary, and the authority on it is
-- src/lib/scheduling/owning.ts rather than a type that costs an ADD VALUE
-- migration every time it grows.
--
-- Two of the four are written today. REQUESTED and MANAGER_SET are named
-- because they are the vocabulary, and NOT BUILT because there is no manager
-- edit surface yet — D6 says the relationship is editable by a manager, and
-- that screen is not in P3. Naming them now means the day it lands it writes
-- into the same column with the same words rather than inventing a second set.
--
-- No backfill, and the temptation to write one is worth naming: "the advisor on
-- their most recent repair order" looks like the answer and is not. It would
-- hand every customer in the store an owner they never chose, and D4 step 2
-- would then route on a relationship the system invented — precisely the silent
-- assignment these columns exist to prevent. The relationship starts empty and
-- fills as visits actually happen.
-- ---------------------------------------------------------------------------
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS owning_advisor_id uuid REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS owning_advisor_since timestamptz;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS owning_advisor_source text;

COMMENT ON COLUMN customers.owning_advisor_id IS
  'Their advisor (DRIVE_PLAN D6). Set at the delivery introduction or the first completed visit when no owner exists, never silently reassigned by traffic. Null is the ordinary state — most customers do not have a guy.';
COMMENT ON COLUMN customers.owning_advisor_source IS
  'SALES_INTRO · FIRST_VISIT · REQUESTED · MANAGER_SET. Text, not an enum — the vocabulary is younger than the table. src/lib/scheduling/owning.ts is the authority. REQUESTED and MANAGER_SET are named but not yet written: no manager edit surface exists.';

-- "My customers", per rooftop. The query the relationship exists to make
-- answerable, and the one D4 step 2 reads a single row of on every booking.
CREATE INDEX IF NOT EXISTS customers_owning_advisor_idx
  ON customers (store_id, owning_advisor_id);

-- ---------------------------------------------------------------------------
-- 4. Grants — two tables already covered, and one that never was.
--
-- The two this phase writes need nothing, and saying so is the point rather
-- than restating grants for the sake of a section:
--
--   * `customers` — 0025 granted SELECT, INSERT, UPDATE to `authenticated`
--     when the CSV importer became the first thing to write it. The
--     introduction inserts a customer and the ownership writes update one,
--     both under `withCurrentUserScope`; UPDATE covers both.
--   * `appointments` — 0028 granted the same three, having found that the
--     table had carried a policy since 0001 and never a grant (the fifth "a
--     policy is not a grant"). The introduction books through the same action.
--
-- `maintenance_schedules` is the sixth instance of that same trap, found the
-- same way: 0021 and 0025 each audited "every table the application writes",
-- and this one has never been read by anything at all. It has carried two
-- policies since 0001 — a SELECT policy that deliberately admits the shared
-- `store_id IS NULL` reference rows, and a store-scoped write policy — and no
-- grant behind either. Harmless for as long as no query existed.
--
-- The introduction page is the first query: it reads the make's interval to
-- decide what date to open the form on, through the scoped connection like
-- everything else that touches a store's data. Without the grant that read
-- fails with "permission denied for table maintenance_schedules", which reads
-- as a connection problem and sends somebody to the wrong file.
--
-- SELECT only. Nothing edits reference data — there is no schedule editor, and
-- the seed and migrations run on the privileged connection — and the loud
-- failure ("permission denied") is the better of the two failure modes. The
-- other order, a grant with no policy, affects zero rows silently.
GRANT SELECT ON public.maintenance_schedules TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. RLS — nothing to declare, deliberately.
--
-- There is no new table to police here. Row-level security
-- needs nothing either: **a column added to an existing table inherits that
-- table's policies**. Both carry FORCE ROW LEVEL SECURITY and a FOR ALL
-- tenant-isolation policy keyed on `store_id` from 0001 and 0014, and a policy
-- is evaluated per row rather than per column — so `owning_advisor_id` is
-- readable and writable exactly where the customer row is and nowhere else.
-- Re-declaring the policies here would be noise that a future reader has to
-- diff against 0001 to be sure it changed nothing.
--
-- The one thing NOT enforced in the database, stated so it is not mistaken for
-- an oversight: nothing here stops `owning_advisor_id` being overwritten. The
-- never-reassign rule lives in `shouldClaimOwnership` and the scoped write
-- beside it, where it can say why in words and be tested. A CHECK cannot
-- express "only when it was null", and a trigger would put a second, silent
-- authority on a decision the product has to be able to explain to an advisor.
-- ---------------------------------------------------------------------------
