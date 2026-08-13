-- ===========================================================================
-- Row-level security: the tenant isolation boundary.
--
-- RLS is the boundary, NOT application code. A forgotten WHERE clause in a
-- query must not be able to leak another dealership's customers. Dealerships
-- are covered "financial institutions" under the FTC Safeguards Rule, so this
-- is a compliance control as much as an engineering one.
--
-- Everything below runs against the `authenticated` role. The service role
-- bypasses RLS by design and is used only for migrations, sync jobs and
-- webhook handlers — never for a request carrying a user's session.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Which stores may the current user touch?
--
-- SECURITY DEFINER so the lookup itself is not subject to RLS on
-- user_store_roles, which would otherwise recurse infinitely.
-- search_path is pinned to defeat search-path hijacking.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_store_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT store_id
  FROM public.user_store_roles
  WHERE user_id = auth.uid()
    AND is_active = true
$$;

REVOKE ALL ON FUNCTION public.current_user_store_ids() FROM public;
GRANT EXECUTE ON FUNCTION public.current_user_store_ids() TO authenticated;

-- Organisations the user can reach, via their store memberships.
CREATE OR REPLACE FUNCTION public.current_user_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT s.organization_id
  FROM public.stores s
  WHERE s.id IN (SELECT public.current_user_store_ids())
$$;

REVOKE ALL ON FUNCTION public.current_user_org_ids() FROM public;
GRANT EXECUTE ON FUNCTION public.current_user_org_ids() TO authenticated;

-- ---------------------------------------------------------------------------
-- Store-scoped tables: one uniform policy driven by store_id.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  store_scoped text[] := ARRAY[
    -- customers & vehicles
    'customers', 'vehicles', 'customer_vehicles', 'mileage_readings',
    -- service drive
    'op_codes', 'appointments', 'repair_orders', 'ro_lines',
    'declined_services', 'inspections', 'inspection_items',
    'inspection_approvals', 'coverage_determinations',
    -- coverage products
    'contracts', 'contract_coverage_items', 'prepaid_entitlements',
    'prepaid_redemptions', 'vehicle_recalls',
    -- communication
    'consent_events', 'conversations', 'messages', 'message_templates',
    -- retention & BDC
    'cadence_rules', 'cadence_tasks', 'campaigns', 'campaign_targets',
    'call_logs', 'customer_notes',
    -- integration
    'dms_connections', 'sync_runs', 'external_refs', 'import_batches'
  ];
BEGIN
  FOREACH t IN ARRAY store_scoped LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    -- FORCE so even the table owner is subject to the policy.
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_tenant_isolation', t);
    EXECUTE format($p$
      CREATE POLICY %I ON public.%I
        FOR ALL
        TO authenticated
        USING (store_id IN (SELECT public.current_user_store_ids()))
        WITH CHECK (store_id IN (SELECT public.current_user_store_ids()))
    $p$, t || '_tenant_isolation', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Tables needing bespoke rules.
-- ---------------------------------------------------------------------------

-- Organisations: readable only through a store membership. Never writable by
-- an ordinary user — provisioning is a service-role operation.
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organizations_read ON public.organizations;
CREATE POLICY organizations_read ON public.organizations
  FOR SELECT TO authenticated
  USING (id IN (SELECT public.current_user_org_ids()));

-- Stores: readable when the user has a role there.
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stores FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stores_read ON public.stores;
CREATE POLICY stores_read ON public.stores
  FOR SELECT TO authenticated
  USING (id IN (SELECT public.current_user_store_ids()));

-- Users: yourself, plus colleagues at stores you share. An advisor needs to
-- see who else is on the drive, but not staff at an unrelated rooftop.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_read ON public.users;
CREATE POLICY users_read ON public.users
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR id IN (
      SELECT usr.user_id
      FROM public.user_store_roles usr
      WHERE usr.store_id IN (SELECT public.current_user_store_ids())
    )
  );

DROP POLICY IF EXISTS users_update_self ON public.users;
CREATE POLICY users_update_self ON public.users
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Role assignments: visible for your own stores. Granting roles is a
-- service-role operation so a user can never widen their own access.
ALTER TABLE public.user_store_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_store_roles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_store_roles_read ON public.user_store_roles;
CREATE POLICY user_store_roles_read ON public.user_store_roles
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR store_id IN (SELECT public.current_user_store_ids())
  );

-- Shared reference data: rows with a NULL store_id are the global catalogue,
-- readable by everyone; a non-null store_id makes the row that tenant's own.
ALTER TABLE public.contract_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_products FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contract_products_read ON public.contract_products;
CREATE POLICY contract_products_read ON public.contract_products
  FOR SELECT TO authenticated
  USING (store_id IS NULL OR store_id IN (SELECT public.current_user_store_ids()));

DROP POLICY IF EXISTS contract_products_write ON public.contract_products;
CREATE POLICY contract_products_write ON public.contract_products
  FOR ALL TO authenticated
  USING (store_id IN (SELECT public.current_user_store_ids()))
  WITH CHECK (store_id IN (SELECT public.current_user_store_ids()));

ALTER TABLE public.maintenance_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_schedules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS maintenance_schedules_read ON public.maintenance_schedules;
CREATE POLICY maintenance_schedules_read ON public.maintenance_schedules
  FOR SELECT TO authenticated
  USING (store_id IS NULL OR store_id IN (SELECT public.current_user_store_ids()));

DROP POLICY IF EXISTS maintenance_schedules_write ON public.maintenance_schedules;
CREATE POLICY maintenance_schedules_write ON public.maintenance_schedules
  FOR ALL TO authenticated
  USING (store_id IN (SELECT public.current_user_store_ids()))
  WITH CHECK (store_id IN (SELECT public.current_user_store_ids()));

-- Audit log: readable for your stores, and append-only. Nobody edits or
-- deletes an audit record — no UPDATE or DELETE policy exists, so those are
-- denied by default.
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_log_read ON public.audit_log;
CREATE POLICY audit_log_read ON public.audit_log
  FOR SELECT TO authenticated
  USING (store_id IN (SELECT public.current_user_store_ids()));

DROP POLICY IF EXISTS audit_log_insert ON public.audit_log;
CREATE POLICY audit_log_insert ON public.audit_log
  FOR INSERT TO authenticated
  WITH CHECK (store_id IN (SELECT public.current_user_store_ids()));

-- ---------------------------------------------------------------------------
-- The anon role gets nothing. Public MPI approval links are served by the
-- server using the service role after validating a share token, so an
-- unauthenticated browser never talks to Postgres directly.
-- ---------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
