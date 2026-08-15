-- Give a cadence task a real component group.
--
-- Closing a repair order has to be able to ask "was this task's work just
-- sold?", and the only answer available was a `[maint:<vehicle>:<GROUP>:<miles>]`
-- prefix smuggled into the human-readable `detail` column. String-matching that
-- from the close path would break the day someone reworded the copy, silently,
-- in a billing-adjacent code path.
--
-- Idempotent. Applied with `npm run db:apply` — see src/db/README.md.

ALTER TABLE cadence_tasks
  ADD COLUMN IF NOT EXISTS component_group_key text;

-- Reconciliation reads (store, group, status). Partial on PENDING because that
-- is the only state the close path cares about, and completed tasks accumulate
-- forever.
CREATE INDEX IF NOT EXISTS cadence_tasks_component_idx
  ON cadence_tasks (store_id, component_group_key)
  WHERE status = 'PENDING';

-- --------------------------------------------------------------------------
-- Backfill
-- --------------------------------------------------------------------------
-- Existing rows predate the column. Both sources are recoverable, so the
-- reconciliation works on the data already in the table rather than only on
-- tasks generated from here on.

-- Declined-service follow-ups carry a real foreign key to the decline, which
-- has always known its component group.
UPDATE cadence_tasks t
SET component_group_key = d.component_group_key
FROM declined_services d
WHERE t.source_declined_service_id = d.id
  AND t.component_group_key IS NULL
  AND d.component_group_key IS NOT NULL;

-- Maintenance tasks carry it in the detail prefix. This is the one and only
-- place that parse is acceptable: a one-off migration of rows already written
-- in that format, not a rule the running system depends on.
UPDATE cadence_tasks
SET component_group_key = split_part(substring(detail FROM '^\[maint:([^\]]*)\]'), ':', 2)
WHERE component_group_key IS NULL
  AND detail ~ '^\[maint:[^:]*:[^:]*:[^\]]*\]';

-- Anything that produced an empty string rather than a key is left null —
-- a null means "no group", which the reconciliation skips. An empty string
-- would match other empty strings, which is worse than not matching.
UPDATE cadence_tasks
SET component_group_key = NULL
WHERE component_group_key = '';
