-- Put the audit log back to append-only.
--
-- ===========================================================================
-- WHAT WENT WRONG
-- ===========================================================================
-- 0001 created this policy as:
--
--   CREATE POLICY audit_log_read ON public.audit_log
--     FOR SELECT TO authenticated
--     USING (store_id IN (SELECT public.current_user_store_ids()));
--
-- 0016 needed to widen the USING clause so platform staff could read across
-- tenants, and rewrote it as:
--
--   CREATE POLICY audit_log_read ON public.audit_log
--     USING (store_id IN (...) OR public.is_platform_admin());
--
-- dropping `FOR SELECT TO authenticated` in the process. Both defaults then
-- apply: a policy with no FOR clause is FOR ALL, and one with no TO clause is
-- TO PUBLIC. So a SELECT-only policy for signed-in staff quietly became an
-- every-command policy for every role — and UPDATE and DELETE on the audit log
-- became things any user could do to their own store's rows.
--
-- The comment 0016 wrote above that statement says "an append-only log that the
-- application can rewrite is not a log". The intent was right; the SQL lost it.
--
-- ===========================================================================
-- WHY IT WAS NOT CAUGHT
-- ===========================================================================
-- src/db/rls.test.ts has asserted this since 0001 — it inserts a row, tries to
-- update and delete it, and checks the row is untouched. It passed throughout,
-- because the throwaway test database was built by a script that applied the
-- migration files directly and stopped silently at 0014 (which references the
-- ledger table that only `npm run db:apply` creates). Every assertion from
-- there on was running against a schema six migrations behind the one it was
-- written for. Fixing the harness turned the test red immediately.
--
-- No data was lost: nothing has ever written to this table. What was lost was
-- the guarantee, for whenever something does.
--
-- Idempotent. Applied with `npm run db:apply` — see src/db/README.md.

DROP POLICY IF EXISTS audit_log_read ON public.audit_log;

-- FOR SELECT restored, and TO authenticated with it. The USING clause keeps
-- what 0016 was actually for: a dealership reads its own rows, platform staff
-- read across tenants.
CREATE POLICY audit_log_read ON public.audit_log
  FOR SELECT TO authenticated
  USING (
    store_id IN (SELECT public.current_user_store_ids())
    OR public.is_platform_admin()
  );

-- No UPDATE or DELETE policy, on purpose. With RLS forced and none present,
-- both are denied to every non-superuser and affect zero rows. Writes continue
-- to go through the privileged connection, which is the only thing that should
-- ever append to a log.
