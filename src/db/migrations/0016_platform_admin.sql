-- Platform staff: the people who run DealerTech, as distinct from the people
-- who run a dealership.
--
-- ===========================================================================
-- THE SHAPE OF THIS, AND WHY
-- ===========================================================================
-- The obvious design is a god-mode flag that reads everything. It is also the
-- design that turns one compromised support account into every dealership's
-- customer list, and dealerships are covered "financial institutions" under the
-- FTC Safeguards Rule — their customers' names, addresses, phone numbers and
-- service histories are exactly what that rule exists to protect.
--
-- So platform admin is deliberately narrow. It grants the OPERATIONAL view:
-- which dealerships exist, whether their jobs are running, who signed up, what
-- the invitations are doing. It does NOT grant access to any customer, vehicle,
-- repair order or inspection. Those policies are untouched by this migration
-- and continue to answer only to a store membership.
--
-- Reaching a specific dealership's customer data is therefore still done the
-- same way anybody else does it — by being granted a role at that store, which
-- is a visible act with a row behind it, rather than an invisible capability.
--
-- Idempotent. Applied with `npm run db:apply` — see src/db/README.md.

CREATE TABLE IF NOT EXISTS platform_admins (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Never deleted, only revoked. "Who had platform access last March" is a
  -- question an auditor asks and a DELETE cannot answer.
  granted_at    timestamptz NOT NULL DEFAULT now(),
  granted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  revoked_at    timestamptz,
  revoked_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  note          text
);

-- One live grant per person. Re-granting revokes and re-adds rather than
-- stacking duplicates that disagree about who is still staff.
CREATE UNIQUE INDEX IF NOT EXISTS platform_admins_one_live
  ON platform_admins (user_id)
  WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- Is the caller platform staff?
--
-- SECURITY DEFINER for the same reason the store helper is: the policy on
-- platform_admins itself calls this, and an invoker-rights function would
-- recurse forever. search_path pinned to defeat hijacking.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE user_id = auth.uid() AND revoked_at IS NULL
  )
$$;

REVOKE ALL ON FUNCTION public.is_platform_admin() FROM public;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;

ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_admins FORCE ROW LEVEL SECURITY;

-- Staff see the roster. Nobody else knows the table has rows.
DROP POLICY IF EXISTS platform_admins_read ON platform_admins;
CREATE POLICY platform_admins_read ON platform_admins
  USING (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- The operational view.
--
-- Widened one table at a time, on purpose. A loop over "every table with a
-- store_id" would have quietly included customers the day somebody ran it.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS stores_read ON public.stores;
CREATE POLICY stores_read ON public.stores
  USING (id IN (SELECT public.current_user_store_ids()) OR public.is_platform_admin());

DROP POLICY IF EXISTS organizations_read ON public.organizations;
CREATE POLICY organizations_read ON public.organizations
  USING (id IN (SELECT public.current_user_org_ids()) OR public.is_platform_admin());

DROP POLICY IF EXISTS pricing_sync_runs_tenant_isolation ON public.pricing_sync_runs;
CREATE POLICY pricing_sync_runs_tenant_isolation ON public.pricing_sync_runs
  USING (store_id IN (SELECT public.current_user_store_ids()) OR public.is_platform_admin());

DROP POLICY IF EXISTS store_invitations_tenant_isolation ON public.store_invitations;
CREATE POLICY store_invitations_tenant_isolation ON public.store_invitations
  USING (store_id IN (SELECT public.current_user_store_ids()) OR public.is_platform_admin());

-- Leads belong to nobody until they become a tenant, so this is the one table
-- whose only readers are platform staff.
DROP POLICY IF EXISTS demo_requests_read ON public.demo_requests;
CREATE POLICY demo_requests_read ON public.demo_requests
  USING (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- The audit log has existed since 0000 and nothing has ever written to it.
--
-- Platform staff need to read it across tenants, and a dealership needs to read
-- its own. Writes go through the privileged connection, so no INSERT policy is
-- required — and deliberately none is added: an append-only log that the
-- application can rewrite is not a log.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS audit_log_read ON public.audit_log;
CREATE POLICY audit_log_read ON public.audit_log
  USING (store_id IN (SELECT public.current_user_store_ids()) OR public.is_platform_admin());
