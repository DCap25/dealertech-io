-- Keep the record when someone accepts an odometer that went backwards.
--
-- An odometer cannot decrease. When one appears to and an advisor accepts it
-- anyway, that decision is the only thing standing between an honest data-entry
-- correction and a false odometer statement sitting in the dealership's own
-- records. Federal odometer-disclosure law treats that as the dealership's
-- problem, so the reasoning belongs in the row, permanently, next to who said it.
--
-- Nullable throughout: the overwhelming majority of readings go forward and
-- carry none of this.
--
-- Idempotent. Applied with `npm run db:apply` — see src/db/README.md.

ALTER TABLE mileage_readings
  -- What the odometer read before this entry. Stored rather than derived: the
  -- point of an audit row is that it still makes sense years later without
  -- replaying every other reading to work out what was on screen at the time.
  ADD COLUMN IF NOT EXISTS previous_mileage integer,
  -- PRIOR_ENTRY_WRONG / CLUSTER_REPLACED / OTHER.
  ADD COLUMN IF NOT EXISTS override_reason text,
  -- The full sentence, reason and free text together, as shown to whoever
  -- reviews the file.
  ADD COLUMN IF NOT EXISTS override_note text,
  ADD COLUMN IF NOT EXISTS override_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS override_at timestamptz;

-- Finding every accepted rollback is the question an auditor actually asks, and
-- it should not mean scanning a table that grows by a row per visit forever.
CREATE INDEX IF NOT EXISTS mileage_readings_override_idx
  ON mileage_readings (store_id, override_at DESC)
  WHERE override_reason IS NOT NULL;
