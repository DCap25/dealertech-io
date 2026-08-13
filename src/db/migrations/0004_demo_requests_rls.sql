-- ===========================================================================
-- Row-level security for demo_requests.
--
-- This table is NOT tenant-scoped — leads arrive from the public site before
-- any store exists, so there is no store_id to isolate on. It still holds
-- prospect PII (names, emails, phone numbers), so it gets the same treatment
-- as everything else: RLS enabled and FORCED, with NO policy for the
-- `authenticated` role.
--
-- No policy means deny by default. Only the service role — which bypasses RLS
-- and is used exclusively by trusted server code — can read or write it. A
-- signed-in dealership user has no business reading the sales pipeline.
-- ===========================================================================

ALTER TABLE public.demo_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.demo_requests FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.demo_requests FROM anon;
REVOKE ALL ON public.demo_requests FROM authenticated;
