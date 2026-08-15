-- Let the policies actually govern writes.
--
-- ===========================================================================
-- WHAT WAS ACTUALLY MISSING
-- ===========================================================================
-- Reads have gone through `withUserScope` — the `authenticated` role with the
-- user's id in the JWT claim — since 0014. Writes never did: every server
-- action still reaches for `getDb()`, which connects as `postgres` and carries
-- BYPASSRLS, so tenant isolation on the write path has been the `WHERE
-- store_id = ?` in each statement and nothing else.
--
-- Moving those writes onto the scoped connection is an application change, but
-- it cannot land until the database will accept them, and an audit of every
-- table the application writes turned up two distinct ways it would not.
--
-- ---------------------------------------------------------------------------
-- 1. A POLICY IS NOT A GRANT
-- ---------------------------------------------------------------------------
-- `prep_sheet_outcomes`, `dms_handoffs` and `document_captures` each carry a
-- FOR ALL tenant-isolation policy and no table privilege for `authenticated`
-- at all. The policy reads as intent to allow; the missing GRANT means the
-- statement never gets far enough to be judged by it. The failure is
-- "permission denied for table", which looks nothing like a policy problem and
-- sends you reading the wrong file.
--
-- This repo has made the same mistake twice already — 0004 revoked
-- demo_requests from `authenticated` and 0016 added a policy without noticing,
-- which 0017 then had to fix. Third time it gets a comment.
--
-- ---------------------------------------------------------------------------
-- 2. A GRANT IS NOT A POLICY
-- ---------------------------------------------------------------------------
-- `user_store_roles` is the mirror image: full privileges for `authenticated`,
-- and a policy that only covers SELECT. With RLS forced and no policy for the
-- other commands, every INSERT and UPDATE affects zero rows — silently, since
-- an RLS-filtered write is not an error. The roster screen would appear to
-- work and change nothing.
--
-- Idempotent. Applied with `npm run db:apply` — see src/db/README.md.

-- ---------------------------------------------------------------------------
-- The grants.
--
-- The FOR ALL policies already on these tables constrain the rows; the grant
-- only decides whether the role may attempt the statement. Handing over
-- INSERT/UPDATE without SELECT would be worse than useless — the application
-- reads what it wrote.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prep_sheet_outcomes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dms_handoffs        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_captures   TO authenticated;

-- ---------------------------------------------------------------------------
-- Who may change a roster.
--
-- The same three roles src/lib/team/roster.ts already treats as able to manage
-- staff. Kept as a function rather than inlined into the policy so the list
-- lives in one place, and SECURITY DEFINER for the same reason
-- `current_user_store_ids` is: the check reads `user_store_roles`, which is the
-- table being protected, and an invoker-rights function would recurse into its
-- own policy.
--
-- Deliberately NOT a general "is this person senior" test. It answers one
-- question — may this user administer THIS store's staff — so a manager at one
-- rooftop gets nothing at another.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_manages_store(target_store uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_store_roles
    WHERE user_id = auth.uid()
      AND store_id = target_store
      AND is_active = true
      AND role IN ('SERVICE_MANAGER', 'FIXED_OPS_DIRECTOR', 'ADMIN')
  )
$$;

REVOKE ALL ON FUNCTION public.current_user_manages_store(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.current_user_manages_store(uuid) TO authenticated;

-- A second permissive policy rather than a rewrite of the existing one: the
-- SELECT rule ("your own rows, plus anyone at a store you work at") is correct
-- and unrelated, and permissive policies OR together. Folding them into one
-- would mean restating the read rule to change the write rule.
DROP POLICY IF EXISTS user_store_roles_manage ON public.user_store_roles;
CREATE POLICY user_store_roles_manage ON public.user_store_roles
  FOR ALL TO authenticated
  USING (public.current_user_manages_store(store_id))
  WITH CHECK (public.current_user_manages_store(store_id));

-- ---------------------------------------------------------------------------
-- What this does NOT do.
--
-- The last-manager lockout — refusing to remove or demote the only person left
-- who can manage staff — stays in src/lib/team/roster.ts. It is a product rule
-- about what a sensible roster looks like, it is unit-tested there, and
-- expressing "would this leave zero managers" as a row-level predicate would
-- mean every roster write counting the table. RLS's job here is the tenant
-- boundary: a manager may administer their own store and no other. Which of
-- their own store's changes are sensible is the application's.
-- ---------------------------------------------------------------------------
