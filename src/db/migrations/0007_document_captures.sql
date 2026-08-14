-- Photographed customer documents and what a model read off them.
--
-- Hand-written, and applied with `npm run db:apply`, because `drizzle-kit
-- push` wants to DROP every row-level-security policy in this database. The
-- policies were applied as raw SQL and are not declared in the Drizzle schema,
-- so the diff reads them as drift. Until they are declared, push is not safe
-- to run against anything that matters. See src/db/README.md.
--
-- Idempotent — safe to run twice.

-- --------------------------------------------------------------- enums
DO $$ BEGIN
  CREATE TYPE document_kind AS ENUM ('SERVICE_CONTRACT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE document_capture_status AS ENUM ('PENDING_REVIEW', 'CONFIRMED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- A machine-read source distinct from PDF_EXTRACTION, so the coverage engine's
-- existing "unverified extraction is LOW confidence" rule applies to it and
-- the provenance stays visible afterwards.
ALTER TYPE contract_source ADD VALUE IF NOT EXISTS 'PHOTO_EXTRACTION';

-- --------------------------------------------------------------- table
CREATE TABLE IF NOT EXISTS document_captures (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id            uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  customer_id         uuid REFERENCES customers(id) ON DELETE SET NULL,
  vehicle_id          uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  kind                document_kind NOT NULL DEFAULT 'SERVICE_CONTRACT',
  status              document_capture_status NOT NULL DEFAULT 'PENDING_REVIEW',

  -- A key into object storage, never the bytes. A customer's document does not
  -- belong in a row that is copied into every backup and every developer's
  -- local database.
  storage_key         text NOT NULL,
  media_type          text NOT NULL,

  -- Verbatim model output, never edited, kept apart from what the advisor
  -- agreed to. When an administrator later declines a claim, the question is
  -- whether the model misread the document or a person mis-confirmed it, and
  -- that is unanswerable if the two share a column.
  raw_extraction      jsonb,
  confirmed_values    jsonb,

  extraction_provider text,
  extraction_model    text,

  contract_id         uuid REFERENCES contracts(id) ON DELETE SET NULL,

  captured_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  review_notes        text,

  captured_at         timestamptz NOT NULL DEFAULT now(),
  reviewed_at         timestamptz,
  -- Soft delete, so honouring a deletion request does not erase the audit
  -- trail behind a coverage decision that was already acted on.
  deleted_at          timestamptz
);

CREATE INDEX IF NOT EXISTS document_captures_vehicle_idx
  ON document_captures (vehicle_id, status);
CREATE INDEX IF NOT EXISTS document_captures_queue_idx
  ON document_captures (store_id, status, captured_at);

-- --------------------------------------------------------------- RLS
-- Matches the pattern used by every other tenant-scoped table here: readable
-- and writable only by someone with an active role at that store.
ALTER TABLE document_captures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_captures_tenant_isolation ON document_captures;
CREATE POLICY document_captures_tenant_isolation ON document_captures
  USING (
    store_id IN (
      SELECT store_id FROM user_store_roles
      WHERE user_id = auth.uid() AND is_active = true
    )
  );
