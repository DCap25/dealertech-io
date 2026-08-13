-- ---------------------------------------------------------------------------
-- Row-level security for prep_sheet_outcomes.
--
-- Same uniform store-scoped policy every other tenant table gets (0001). This
-- table holds customer names, vehicles and pricing, so shipping it without RLS
-- would put a tenant-isolation hole in the middle of an FTC Safeguards Rule
-- covered system.
-- ---------------------------------------------------------------------------
ALTER TABLE public.prep_sheet_outcomes ENABLE ROW LEVEL SECURITY;
-- FORCE so even the table owner is subject to the policy.
ALTER TABLE public.prep_sheet_outcomes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS prep_sheet_outcomes_tenant_isolation ON public.prep_sheet_outcomes;

CREATE POLICY prep_sheet_outcomes_tenant_isolation ON public.prep_sheet_outcomes
  FOR ALL
  TO authenticated
  USING (store_id IN (SELECT public.current_user_store_ids()))
  WITH CHECK (store_id IN (SELECT public.current_user_store_ids()));
