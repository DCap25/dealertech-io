-- What the morning price sync did.
--
-- A job that rewrites the numbers a dealership quotes, unattended, before
-- anyone is in the building, needs to leave a record. When an advisor says "the
-- brake job was 618 yesterday", this is the answer — and when the sync refuses
-- a bad pull, this is where the refusal is visible rather than in a log nobody
-- reads.
--
-- Idempotent. Applied with `npm run db:apply` — see src/db/README.md.

CREATE TABLE IF NOT EXISTS pricing_sync_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,

  -- OK when a plan was applied, REFUSED when the pull failed its sanity
  -- checks, SKIPPED when the integration has no price book to offer.
  status        text NOT NULL,
  vendor        text NOT NULL,

  created_count     integer NOT NULL DEFAULT 0,
  updated_count     integer NOT NULL DEFAULT 0,
  deactivated_count integer NOT NULL DEFAULT 0,
  reactivated_count integer NOT NULL DEFAULT 0,
  -- Changes withheld as implausible. Non-zero means somebody should look.
  quarantined_count integer NOT NULL DEFAULT 0,
  unchanged_count   integer NOT NULL DEFAULT 0,

  -- One human-readable line, and the detail behind it. The detail is the
  -- before/after of every price that moved, which is the bit that answers
  -- "what did this cost the customer".
  summary       text NOT NULL,
  detail        jsonb,

  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);

CREATE INDEX IF NOT EXISTS pricing_sync_runs_store_idx
  ON pricing_sync_runs (store_id, started_at DESC);

-- Anything that needed a human is worth finding without scanning the table.
CREATE INDEX IF NOT EXISTS pricing_sync_runs_attention_idx
  ON pricing_sync_runs (store_id, started_at DESC)
  WHERE status <> 'OK' OR quarantined_count > 0;

ALTER TABLE pricing_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_sync_runs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pricing_sync_runs_tenant_isolation ON pricing_sync_runs;
CREATE POLICY pricing_sync_runs_tenant_isolation ON pricing_sync_runs
  USING (store_id IN (SELECT public.current_user_store_ids()));
