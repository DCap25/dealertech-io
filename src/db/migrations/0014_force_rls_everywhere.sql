-- Bring every table up to the standard 0001 set.
--
-- 0001 did ENABLE plus FORCE ROW LEVEL SECURITY on everything it created.
-- Every migration since — contract fields, demo requests, prep-sheet outcomes,
-- document captures, paired devices, DMS hand-offs, invitations — remembered
-- the ENABLE and forgot the FORCE. It made no observable difference while the
-- application connected as a BYPASSRLS role, which is exactly why it went
-- unnoticed for six migrations.
--
-- FORCE matters to the table owner only: without it, `postgres` reads straight
-- past the policies even after BYPASSRLS is dropped. Since that is the role
-- migrations and jobs run as, it is the one most worth constraining.
--
-- Applied to every table in public rather than a list, so the next table
-- somebody adds without thinking about this is covered by the time this runs
-- again. Idempotent — see src/db/README.md.

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      -- The migration ledger is handled separately below: it is infrastructure,
      -- not tenant data, and has no store_id to write a policy against.
      AND c.relname <> '_applied_migrations'
      AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t.relname);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- The migration ledger.
--
-- No tenant owns it and no policy makes sense for it, so RLS is enabled with
-- no policy at all — which denies everything to every non-superuser. Migrations
-- run as the owner with BYPASSRLS and are unaffected; a signed-in user reading
-- through `authenticated` sees nothing, which is correct. It is deliberately
-- NOT forced, because the migration runner has to write to it.
-- ---------------------------------------------------------------------------
ALTER TABLE public._applied_migrations ENABLE ROW LEVEL SECURITY;
