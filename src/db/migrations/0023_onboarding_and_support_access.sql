-- Onboarding progress, and support access that expires on its own.
--
-- ===========================================================================
-- TWO THINGS, BECAUSE THEY SHIP TOGETHER
-- ===========================================================================
-- The onboarding table is uncontroversial: a rooftop has a setup checklist and
-- something has to remember how far through it they are.
--
-- The support-access half is the one worth reading. The platform console can
-- see which dealerships exist and whether their jobs ran, and deliberately
-- cannot see a single customer — 0016 drew that line and it holds. But
-- answering a real support question sometimes genuinely requires looking at
-- the data, and the honest way to do that is to be granted a role at the store
-- like anybody else, leaving a row behind.
--
-- The failure mode of that design is obvious in hindsight: somebody grants
-- themselves a role to investigate a sync failure on a Tuesday and it is still
-- there in November. So a grant can now carry an expiry, and an elapsed expiry
-- stops working *in the database* rather than only in the session loader.
-- Belt and braces on purpose — this is the one mechanism by which DealerTech
-- staff can reach a dealership's customers, so it should not depend on
-- application code remembering to check a timestamp.
--
-- Idempotent. Applied with `npm run db:apply` — see src/db/README.md.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'onboarding_step_status') THEN
    CREATE TYPE onboarding_step_status AS ENUM ('PENDING', 'DONE', 'SKIPPED');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- onboarding_steps
--
-- Store-scoped, not org-scoped: labour rate, tax and op-code mapping are per
-- rooftop, and a group that onboarded one store has not onboarded the others.
--
-- Unlike the billing tables, a dealership's own managers DO write this one —
-- ticking off a step is something they do — so it gets a full FOR ALL policy
-- and the matching grant, following the pattern 0021 established.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS onboarding_steps (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id             uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,

  -- Step keys live in code (src/lib/onboarding/steps.ts), so adding a step is
  -- a code change rather than a migration. This records only progress.
  step_key             text NOT NULL,
  status               onboarding_step_status NOT NULL DEFAULT 'PENDING',

  completed_at         timestamptz,
  -- Null when the system observed the step rather than somebody ticking it.
  completed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS onboarding_steps_store_key_unique
  ON onboarding_steps (store_id, step_key);
CREATE INDEX IF NOT EXISTS onboarding_steps_store_idx ON onboarding_steps (store_id);

ALTER TABLE onboarding_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_steps FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS onboarding_steps_tenant_isolation ON public.onboarding_steps;
CREATE POLICY onboarding_steps_tenant_isolation ON public.onboarding_steps
  FOR ALL TO authenticated
  USING (store_id IN (SELECT public.current_user_store_ids()) OR public.is_platform_admin())
  WITH CHECK (store_id IN (SELECT public.current_user_store_ids()));

-- A policy is not a grant. See src/db/README.md — this repo has made that
-- mistake three times.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.onboarding_steps TO authenticated;

-- ---------------------------------------------------------------------------
-- Support access: a role that lapses.
--
-- Null on every ordinary role, so this changes nothing for a dealership's own
-- staff. The row is never deleted when it expires — "who could see this store
-- last March" is exactly the question this design exists to answer.
-- ---------------------------------------------------------------------------
ALTER TABLE public.user_store_roles
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

CREATE INDEX IF NOT EXISTS user_store_roles_expiry_idx
  ON public.user_store_roles (expires_at)
  WHERE expires_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Teach the three membership predicates about expiry.
--
-- Every one of these is CREATE OR REPLACE of a function that already exists,
-- with one added clause. `expires_at IS NULL` is the ordinary case and matches
-- every row written before this migration, so the behaviour for dealership
-- staff is unchanged — this only ever takes access away from a grant that was
-- explicitly given a deadline.
--
-- current_user_store_ids is the important one: it is what nearly every
-- store-scoped policy in the database is written against, so an expired
-- support grant loses customers, vehicles, repair orders and inspections in
-- one edit rather than in forty.
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
    AND (expires_at IS NULL OR expires_at > now())
$$;

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
      AND (expires_at IS NULL OR expires_at > now())
      AND role IN ('SERVICE_MANAGER', 'FIXED_OPS_DIRECTOR', 'ADMIN')
  )
$$;

CREATE OR REPLACE FUNCTION public.current_user_manages_org(target_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_store_roles usr
    JOIN public.stores s ON s.id = usr.store_id
    WHERE usr.user_id = auth.uid()
      AND usr.is_active = true
      AND (usr.expires_at IS NULL OR usr.expires_at > now())
      AND s.organization_id = target_org
      AND s.is_active = true
      AND usr.role IN ('SERVICE_MANAGER', 'FIXED_OPS_DIRECTOR', 'ADMIN')
  )
$$;
