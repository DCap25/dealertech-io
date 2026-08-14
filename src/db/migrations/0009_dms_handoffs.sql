-- What was pushed to the DMS, and what came back.
--
-- Idempotent. Applied with `npm run db:apply` — see src/db/README.md.

DO $$ BEGIN
  CREATE TYPE dms_handoff_status AS ENUM ('SENT', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS dms_handoffs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id          uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  appointment_id    uuid REFERENCES appointments(id) ON DELETE SET NULL,
  advisor_id        uuid REFERENCES users(id) ON DELETE SET NULL,

  -- Identifies the push by what is in it. A double-tap, a retry after a
  -- timeout, or a reload followed by another push must not create a second
  -- repair order; a genuinely changed set of lines hashes differently and is
  -- a real second hand-off.
  idempotency_key   text NOT NULL,

  -- Exactly what was sent, kept verbatim. When a customer rings about work
  -- that never got done, this is the record of what the DMS was told.
  payload           jsonb NOT NULL,

  status            dms_handoff_status NOT NULL,
  -- Which adapter, and whether it actually persisted anything. A mock that
  -- logged to a file and a real DMS that created an RO both return ok, and
  -- only the adapter knows the difference.
  vendor            text NOT NULL,
  writes_persisted  boolean NOT NULL DEFAULT false,
  external_ref      text,
  message           text NOT NULL,

  accepted_count    integer NOT NULL DEFAULT 0,
  attempts          integer NOT NULL DEFAULT 1,

  created_at        timestamptz NOT NULL DEFAULT now(),
  last_attempt_at   timestamptz NOT NULL DEFAULT now(),
  sent_at           timestamptz
);

-- Scoped to the store rather than global: two dealerships can legitimately
-- produce the same content hash for a similar visit, and they are not the
-- same hand-off.
CREATE UNIQUE INDEX IF NOT EXISTS dms_handoffs_idempotency
  ON dms_handoffs (store_id, idempotency_key);

CREATE INDEX IF NOT EXISTS dms_handoffs_appointment_idx
  ON dms_handoffs (appointment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS dms_handoffs_store_idx
  ON dms_handoffs (store_id, status, created_at DESC);

ALTER TABLE dms_handoffs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dms_handoffs_tenant_isolation ON dms_handoffs;
CREATE POLICY dms_handoffs_tenant_isolation ON dms_handoffs
  USING (
    store_id IN (
      SELECT store_id FROM user_store_roles
      WHERE user_id = auth.uid() AND is_active = true
    )
  );
