-- Every dealership that already exists becomes COMPED.
--
-- ===========================================================================
-- WHY COMPED AND NOT TRIAL
-- ===========================================================================
-- 0022 added `lifecycle_status` with a default of TRIAL, which is right for a
-- tenant created tomorrow and wrong for every tenant created before billing
-- existed. A trial expires. Applying that default to the dealerships already
-- using this product would put a countdown on accounts nobody ever offered a
-- trial to, and thirty days later the access engine would start degrading
-- them — for the crime of having signed up early.
--
-- COMPED behaves exactly as ACTIVE and never expires. It is also the honest
-- description: these accounts are being given the product for nothing, because
-- that is the arrangement they actually have. Somebody can convert them
-- deliberately from the console, one at a time, with a reason recorded.
--
-- The rule this follows: a backfill may grant access, never remove it.
--
-- ===========================================================================
-- SAFE TO RUN AGAINST PRODUCTION, AND IT WILL BE
-- ===========================================================================
-- `.env.local` points at the production database, so `npm run db:apply` on a
-- laptop is a production write — see src/db/README.md. This migration is
-- written for that reality: it is additive, it touches only organizations that
-- have no lifecycle history at all, and re-running it is a no-op because the
-- second run finds a lifecycle_events row for every organization and skips
-- them. It cannot downgrade a tenant that has since been moved by hand.
--
-- Idempotent. Applied with `npm run db:apply` — see src/db/README.md.

-- The status, for organizations nothing has decided about yet.
UPDATE public.organizations o
SET lifecycle_status    = 'COMPED',
    lifecycle_changed_at = now(),
    -- A comped account is not on a clock. Clearing this stops the reconciler
    -- from ever reading a stale trial deadline off a row that has none.
    trial_ends_at        = NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.lifecycle_events le WHERE le.organization_id = o.id
);

-- The history that makes the status trustworthy. `from_status` is null because
-- there genuinely was no previous state — the column did not exist.
INSERT INTO public.lifecycle_events (organization_id, from_status, to_status, actor, reason)
SELECT o.id, NULL, 'COMPED', 'SYSTEM',
       'Pre-billing backfill: tenant existed before lifecycle tracking. Comped rather than trialled so an early customer is never degraded for having signed up first.'
FROM public.organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM public.lifecycle_events le WHERE le.organization_id = o.id
);
