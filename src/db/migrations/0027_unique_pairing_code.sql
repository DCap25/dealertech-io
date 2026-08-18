-- One live pairing code, one tablet.
--
-- ===========================================================================
-- WHY
-- ===========================================================================
-- `claimDevice` resolves a typed code with
--
--   WHERE pairing_code = ? AND status = 'AWAITING_PAIRING' LIMIT 1
--
-- and no ORDER BY. With one matching row that is the answer; with two it is
-- whichever row the database happened to return, so an advisor typing the code
-- off the tablet in front of them could pair a different tablet — one sitting
-- in another store's drive — to their own store, and neither person would see
-- anything wrong. Only the tablet showing the wrong screen would say so.
--
-- The odds are small and worth stating honestly: the code space is 32⁶ ≈ 1.07
-- billion and codes live for ten minutes, so a collision needs two tablets to
-- draw the same six characters within the same window. Nothing has happened —
-- production holds exactly one AWAITING_PAIRING row. This is not a fix for an
-- incident, it is the removal of a question the read cannot answer.
--
-- Partial, because the column is deliberately reused. `claimDevice` clears
-- `pairing_code` to null the moment a pairing succeeds, so every paired and
-- revoked device holds null and only the rows actually waiting are constrained.
-- The IS NOT NULL clause is redundant against Postgres — a btree treats nulls
-- as distinct — and is written out anyway so the predicate says what it means
-- to a person reading it.
--
-- The existing plain `paired_devices_code_idx` stays. This one only serves a
-- lookup that is qualified by status, which is the only lookup we make today,
-- but the plain index costs nothing on a table this size and dropping an index
-- is not what this migration is for.
--
-- ===========================================================================
-- SEQUENCING
-- ===========================================================================
-- APPLY THIS BEFORE THE CODE THAT RELIES ON IT DEPLOYS — though nothing breaks
-- if the order slips, unlike 0026's column. An index does not change what any
-- read returns: against a database without it, `enrollDevice` simply never sees
-- the unique violation its retry loop exists to handle, and behaves exactly as
-- it did before. The retry is what relies on this being here, so until it is,
-- the collision case is unprotected rather than broken.
--
-- Idempotent. Applied with `npm run db:apply` — see src/db/README.md.

-- --------------------------------------------------------------------------
-- Cleanup preamble
-- --------------------------------------------------------------------------
-- Production has one AWAITING_PAIRING row, so this deletes nothing there. It
-- is here because a CREATE UNIQUE INDEX that fails leaves the migration ledger
-- half-applied, and the environments this has not run against yet — a
-- developer's database, a restored copy, whatever a dealership is trialled on
-- next — have never had anything stopping a duplicate. Insurance at the cost of
-- three lines.
--
-- Deleting rather than un-setting the code: a row awaiting pairing belongs to
-- no store, holds no session (a menu is only pushed to a PAIRED device) and is
-- worth exactly one tablet's next enrolment. The newest survives, because if
-- two tablets really are showing the same code, the one somebody is standing in
-- front of is the one that just asked for it.
DELETE FROM paired_devices d
USING paired_devices keep
WHERE d.status = 'AWAITING_PAIRING'
  AND keep.status = 'AWAITING_PAIRING'
  AND d.pairing_code IS NOT NULL
  AND keep.pairing_code = d.pairing_code
  AND (keep.created_at, keep.id) > (d.created_at, d.id);

CREATE UNIQUE INDEX IF NOT EXISTS paired_devices_awaiting_code
  ON paired_devices (pairing_code)
  WHERE status = 'AWAITING_PAIRING' AND pairing_code IS NOT NULL;

COMMENT ON INDEX paired_devices_awaiting_code IS
  'One tablet per live pairing code, so the code an advisor types resolves to exactly one device rather than to whichever row the database returns first.';
