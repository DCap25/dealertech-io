-- Customer-facing tablets, and what is currently on them.
--
-- Idempotent. Applied with `npm run db:apply` — see src/db/README.md for why
-- `drizzle-kit push` is not used here.

DO $$ BEGIN
  CREATE TYPE paired_device_status AS ENUM ('AWAITING_PAIRING', 'PAIRED', 'REVOKED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE presentation_status AS ENUM ('ACTIVE', 'ENDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS paired_devices (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Null until an advisor claims it. An unpaired tablet belongs to nobody,
  -- which is also what makes an unclaimed code harmless.
  store_id            uuid REFERENCES stores(id) ON DELETE CASCADE,

  name                text,
  status              paired_device_status NOT NULL DEFAULT 'AWAITING_PAIRING',

  pairing_code        text,
  pairing_expires_at  timestamptz,

  -- SHA-256 of the bearer token, never the token. A dump of this table must
  -- not let anyone impersonate a tablet.
  token_hash          text NOT NULL,

  paired_by_user_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  paired_at           timestamptz,
  last_seen_at        timestamptz,
  revoked_at          timestamptz,

  created_at          timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE paired_devices ADD CONSTRAINT paired_devices_token_hash UNIQUE (token_hash);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS paired_devices_store_idx ON paired_devices (store_id, status);
CREATE INDEX IF NOT EXISTS paired_devices_code_idx ON paired_devices (pairing_code);

CREATE TABLE IF NOT EXISTS presentation_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id         uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  device_id        uuid NOT NULL REFERENCES paired_devices(id) ON DELETE CASCADE,
  appointment_id   uuid REFERENCES appointments(id) ON DELETE SET NULL,
  advisor_id       uuid REFERENCES users(id) ON DELETE SET NULL,

  -- The frozen menu the advisor approved, already stripped of anything a
  -- customer must not see. The tablet renders this and never reads a prep
  -- sheet, so a change on the advisor's screen cannot surprise the person
  -- holding the tablet mid-conversation.
  snapshot         jsonb NOT NULL,
  decisions        jsonb NOT NULL DEFAULT '{}'::jsonb,

  status           presentation_status NOT NULL DEFAULT 'ACTIVE',
  started_at       timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  ended_at         timestamptz
);

CREATE INDEX IF NOT EXISTS presentation_sessions_device_idx
  ON presentation_sessions (device_id, status);
CREATE INDEX IF NOT EXISTS presentation_sessions_store_idx
  ON presentation_sessions (store_id, status, started_at);

-- --------------------------------------------------------------- RLS
-- Both tables are reached only by trusted server code holding the privileged
-- connection, but the policies exist so that when the app moves to connecting
-- as the signed-in user these tables are already covered rather than being the
-- one gap left open.
ALTER TABLE paired_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE presentation_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS paired_devices_tenant_isolation ON paired_devices;
CREATE POLICY paired_devices_tenant_isolation ON paired_devices
  USING (
    store_id IN (
      SELECT store_id FROM user_store_roles
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

DROP POLICY IF EXISTS presentation_sessions_tenant_isolation ON presentation_sessions;
CREATE POLICY presentation_sessions_tenant_isolation ON presentation_sessions
  USING (
    store_id IN (
      SELECT store_id FROM user_store_roles
      WHERE user_id = auth.uid() AND is_active = true
    )
  );
