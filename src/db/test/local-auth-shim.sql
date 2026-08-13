-- ===========================================================================
-- Local Supabase shim, for testing RLS against a plain Postgres container.
--
-- Supabase provides an `auth` schema, an `auth.uid()` function reading the JWT
-- claim, and the `authenticated` / `anon` roles. A bare Postgres image has
-- none of them, so we recreate the same contract here. The policies under test
-- are the REAL ones from 0001_rls_policies.sql — only the identity plumbing is
-- simulated, so a passing test says something meaningful about production.
-- ===========================================================================

CREATE SCHEMA IF NOT EXISTS auth;

-- Matches Supabase's behaviour: read the subject claim, NULL when absent.
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO authenticated, anon, service_role;
GRANT USAGE ON SCHEMA auth TO authenticated, anon, service_role;

-- Table privileges are deliberately broad. RLS — not GRANT — is the isolation
-- boundary under test, so the test would be worthless if a missing GRANT were
-- what stopped a cross-tenant read.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

-- The test connection logs in as `postgres`, which owns the tables. Without
-- FORCE ROW LEVEL SECURITY (set in 0001) an owner bypasses its own policies
-- and every isolation test would pass for the wrong reason.
