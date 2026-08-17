-- Give a declined service the op code it would be billed under today.
--
-- ===========================================================================
-- WHY
-- ===========================================================================
-- `quoted_amount` has always carried the comment "re-quote before re-offering",
-- and nothing could. When the prep sheet resurfaced a decline it quoted that
-- column — the number written on a repair order however long ago — and set no
-- price source, so the customer's menu read it as a *confirmed* price. A job
-- declined at $449 in 2024 was presented today as a firm $449 while the store's
-- own book priced it at $618, and the re-pricing check could not catch it
-- because both sides read the same stale field.
--
-- A component group cannot answer the question: front and rear brakes share
-- BRAKE_PADS_SHOES and cost different money. The op code can, and it is the
-- same key every other recommendation on the sheet is priced by.
--
-- Nullable on purpose. Every decline recorded before today has none, and so
-- does anything imported from a system that does not carry a code. A null
-- resolves to our own estimate, which is redacted to "price to be confirmed"
-- and kept out of every total rather than quoted.
--
-- ===========================================================================
-- SEQUENCING
-- ===========================================================================
-- APPLY THIS BEFORE THE CODE THAT READS IT DEPLOYS. The decline path writes
-- `op_code` from the moment the new build is live; against a database without
-- this column every recorded decline fails.
--
-- Idempotent. Applied with `npm run db:apply` — see src/db/README.md.

ALTER TABLE declined_services
  ADD COLUMN IF NOT EXISTS op_code text;

COMMENT ON COLUMN declined_services.op_code IS
  'The store operation this work is billed under, so it can be re-priced when it is re-offered. Null falls through to our estimate rather than quoting the old figure as a firm price.';

-- --------------------------------------------------------------------------
-- Backfill
-- --------------------------------------------------------------------------
-- A decline recorded from a repair order line knows exactly which operation it
-- came from, so those rows are recoverable rather than guessed at.
UPDATE declined_services d
SET op_code = o.code
FROM ro_lines l
JOIN op_codes o ON o.id = l.op_code_id
WHERE d.ro_line_id = l.id
  AND d.op_code IS NULL;

-- Everything else is left null deliberately. The tempting second pass — match
-- the component group to an active op code — is the guess this column exists to
-- avoid: BRAKE_PADS_SHOES resolves to two codes at different prices, and
-- quoting the wrong one confidently is worse than quoting an estimate and
-- saying so.
