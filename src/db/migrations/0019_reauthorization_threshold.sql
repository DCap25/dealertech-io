-- How far a price may move before the customer has to be asked again.
--
-- ===========================================================================
-- WHY THIS IS A SETTING AND NOT A CONSTANT
-- ===========================================================================
-- The rule is state law and it varies. California is the strictest well-known
-- example — a shop may not charge more than the estimate without the
-- customer's consent, and must be able to say who gave it and when — while
-- other states set percentage or dollar thresholds of their own.
--
-- Encoding any of that in code would be claiming a legal precision this
-- codebase does not have, and getting it subtly wrong is worse than not
-- claiming to know it. So the dealership sets it, presumably with their own
-- advice, and the DEFAULT IS THE CONSERVATIVE ONE: zero and zero, meaning any
-- real increase requires asking again.
--
-- Nobody is harmed by a system that asks too often. The reverse is a bill the
-- customer disputes and a dealership that cannot show they were told.
--
-- Idempotent. Applied with `npm run db:apply` — see src/db/README.md.

ALTER TABLE stores
  -- Percentage of the authorised total an increase may reach. 0 = any increase.
  ADD COLUMN IF NOT EXISTS reauth_threshold_percent numeric(5,2) NOT NULL DEFAULT 0,
  -- Absolute increase allowed regardless of percentage. 0 = any increase.
  ADD COLUMN IF NOT EXISTS reauth_threshold_amount numeric(10,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN stores.reauth_threshold_percent IS
  'Both this and reauth_threshold_amount must be cleared for an increase to pass without re-authorisation. Either alone is a loophole.';
