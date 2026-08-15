-- Staff invitations.
--
-- An invitation is a bearer credential: whoever holds the link can create an
-- account with a named role at a named dealership. So the raw token is never
-- stored — only its SHA-256. A dump of this table grants nobody entry to
-- anybody's store.
--
-- Idempotent. Applied with `npm run db:apply` — see src/db/README.md.

CREATE TABLE IF NOT EXISTS store_invitations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,

  -- Who it was addressed to, normalised to lowercase. Checked on acceptance so
  -- a forwarded link cannot be quietly redeemed by somebody else.
  email           text NOT NULL,
  role            user_role NOT NULL,

  -- SHA-256 of the token that went out in the link. The token itself exists
  -- only in that URL and in the recipient's inbox.
  token_hash      text NOT NULL,

  invited_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at      timestamptz NOT NULL,

  accepted_at     timestamptz,
  accepted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  -- Withdrawn before it was used. Kept rather than deleted: "who invited a
  -- competitor's email address and then thought better of it" is a question
  -- worth being able to answer.
  revoked_at      timestamptz,
  revoked_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,

  created_at      timestamptz NOT NULL DEFAULT now()
);

-- The lookup on acceptance is by hash, and it must hit at most one row.
CREATE UNIQUE INDEX IF NOT EXISTS store_invitations_token_hash
  ON store_invitations (token_hash);

CREATE INDEX IF NOT EXISTS store_invitations_store_idx
  ON store_invitations (store_id, created_at DESC);

-- One live invitation per address per store. Re-inviting somebody should
-- replace the pending link rather than leave two working ones in circulation,
-- and a partial unique index makes that the database's problem rather than the
-- application's.
CREATE UNIQUE INDEX IF NOT EXISTS store_invitations_one_pending
  ON store_invitations (store_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

ALTER TABLE store_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS store_invitations_tenant_isolation ON store_invitations;
CREATE POLICY store_invitations_tenant_isolation ON store_invitations
  USING (
    store_id IN (
      SELECT store_id FROM user_store_roles
      WHERE user_id = auth.uid() AND is_active = true
    )
  );
