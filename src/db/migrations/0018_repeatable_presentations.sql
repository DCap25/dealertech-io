-- A visit has more than one presentation, and not all of them happen on a
-- tablet in the drive.
--
-- ===========================================================================
-- WHAT THIS CHANGES AND WHY
-- ===========================================================================
-- presentation_sessions modelled one event on one paired device. That is the
-- write-up conversation, where the customer is standing at the podium.
--
-- It is not where most of the money is. The larger conversation happens after
-- the technician's inspection, several hours later, when the customer is at
-- work and the tablet in the drive is useless to them. Modelled as a single
-- gate, the tech's findings either force a second full ceremony or bypass
-- authorisation altogether — and the second is how work gets done that nobody
-- agreed to.
--
-- So: a session belongs to the visit, not to a device. Delivery becomes a
-- property of the session rather than its identity, and a visit can carry as
-- many as the day needs.
--
-- Idempotent. Applied with `npm run db:apply` — see src/db/README.md.

-- A link presentation has no device. Nullable rather than a sentinel row.
ALTER TABLE presentation_sessions
  ALTER COLUMN device_id DROP NOT NULL;

ALTER TABLE presentation_sessions
  -- TABLET | LINK | PRINT. Text rather than an enum: the set of ways a
  -- dealership can put a menu in front of somebody is not finished, and an
  -- enum makes every future one a migration.
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'TABLET',

  -- Which conversation this was: 1 at write-up, 2 after the inspection. Kept
  -- as a number rather than inferred from timestamps so "the second
  -- presentation" means the same thing to a query and to a person.
  ADD COLUMN IF NOT EXISTS sequence integer NOT NULL DEFAULT 1,

  -- Link delivery. Only the SHA-256 is stored, exactly as for invitations:
  -- whoever holds the link can see a customer's vehicle history and prices, so
  -- a dump of this table must not hand that to anybody.
  ADD COLUMN IF NOT EXISTS access_token_hash text,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,

  -- ---------------------------------------------------------------------
  -- The authorisation record.
  --
  -- Deliberately narrow, and worth being precise about what it claims. This
  -- is a record of WHAT WAS SHOWN and WHAT WAS ANSWERED — the prices on the
  -- screen, the customer's own words back to them, and when. It is not a
  -- replacement for the repair order the dealership prints and the DMS owns,
  -- and it does not attempt to satisfy any state's written-estimate rule.
  --
  -- That narrowness is the point. Two authorisation artifacts that can
  -- disagree is worse than one, so this is evidence alongside the DMS's
  -- record rather than a competing version of it.
  -- ---------------------------------------------------------------------
  ADD COLUMN IF NOT EXISTS authorized_at timestamptz,
  ADD COLUMN IF NOT EXISTS authorized_name text,
  -- The exact prices and answers at the moment of authorisation, frozen. The
  -- live `decisions` column keeps moving as somebody taps; this does not.
  ADD COLUMN IF NOT EXISTS authorized_snapshot jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS presentation_sessions_token
  ON presentation_sessions (access_token_hash)
  WHERE access_token_hash IS NOT NULL;

-- "Every presentation on this visit, in order" is the query the advisor view
-- and the hand-off both need.
CREATE INDEX IF NOT EXISTS presentation_sessions_visit_idx
  ON presentation_sessions (appointment_id, sequence);
