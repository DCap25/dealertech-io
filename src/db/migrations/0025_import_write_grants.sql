-- Let a manager's own connection write the tables an import fills.
--
-- ===========================================================================
-- A POLICY IS NOT A GRANT — THE FOURTH TIME
-- ===========================================================================
-- src/db/README.md documents this trap and 0021 fixed three tables that had
-- fallen into it. The pattern repeats here for a reason worth stating: 0021
-- audited "every table the application writes", and at that moment the
-- application did not write `customers` or `customer_vehicles` at all. They
-- have carried a FOR ALL tenant-isolation policy since 0001 and no grant to
-- `authenticated`, which was harmless exactly as long as nothing tried.
--
-- The CSV importer tries. It runs under `withCurrentUserScope` — an import is
-- a signed-in manager acting inside their own store, which is precisely the
-- case row-level security exists for, and a bulk write is the last place to
-- reach for a privileged connection out of convenience.
--
-- Without this the import fails with "permission denied for table customers",
-- which reads as a connection problem and sends somebody to the wrong file.
-- That is the better of the two failure modes — the other one, a grant with no
-- policy, would affect zero rows silently and look like a successful import
-- that stored nothing.
--
-- `vehicles` and `declined_services` are granted here too. The advisor write
-- path already writes them through the scoped connection in production, so the
-- privileges are believed to exist; GRANT is idempotent and stating them costs
-- nothing next to discovering a gap mid-import.
--
-- Idempotent. Applied with `npm run db:apply` — see src/db/README.md.

GRANT SELECT, INSERT, UPDATE ON public.customers         TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.customer_vehicles TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.vehicles          TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.declined_services TO authenticated;

-- ---------------------------------------------------------------------------
-- The batch ledger.
--
-- Store-scoped like everything else, and written by the person running the
-- import rather than by a job — so unlike the billing tables it gets a real
-- FOR ALL policy and the matching grant, following 0021's shape.
--
-- DELETE is deliberately absent from every grant in this file. An import can
-- add history and correct it; it has no business removing a dealership's
-- records, and a bug that deleted rows during a bulk write would be
-- unrecoverable in a way an over-import is not.
-- ---------------------------------------------------------------------------
ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_batches FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS import_batches_tenant_isolation ON public.import_batches;
CREATE POLICY import_batches_tenant_isolation ON public.import_batches
  FOR ALL TO authenticated
  USING (store_id IN (SELECT public.current_user_store_ids()) OR public.is_platform_admin())
  WITH CHECK (store_id IN (SELECT public.current_user_store_ids()));

GRANT SELECT, INSERT, UPDATE ON public.import_batches TO authenticated;

-- ---------------------------------------------------------------------------
-- Finding a vehicle's declines by natural key, which is what makes re-running
-- an import safe.
--
-- The importer loads every existing decline for the VINs in the file and
-- checks in memory, so this index is what keeps that one query cheap as a
-- store's history grows. Without it, the second import of a large file scans
-- the table.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS declined_services_vehicle_declined_idx
  ON public.declined_services (vehicle_id, declined_at);
