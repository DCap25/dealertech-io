-- Billing: the commercial layer, and the lifecycle status that governs access.
--
-- ===========================================================================
-- WHAT THIS IS FOR
-- ===========================================================================
-- Until now every dealership in this database has been equally entitled to
-- everything, because there was no such thing as a paying one. This adds the
-- distinction: `organizations.lifecycle_status` is the single source of truth
-- for what a tenant may do, and the billing tables record why it says what it
-- says.
--
-- ===========================================================================
-- THE ONE PLACE THIS SCHEMA DEVIATES FROM DENY-BY-DEFAULT
-- ===========================================================================
-- Everywhere else here, missing configuration refuses: the cron endpoint with
-- no secret, the price book with no op code. Access gating inverts that on
-- purpose. An ACTIVE organization whose billing rows are missing or
-- contradictory resolves to FULL access plus a loud row on the platform
-- console — because a cron endpoint falling open lets a stranger run a job,
-- while access falling closed locks an advisor out of the drive at nine in the
-- morning over our own bookkeeping. Fail open for the drive, fail loud to us.
-- That decision lives in src/lib/billing/access.ts; it is recorded here so
-- nobody reads the schema and "fixes" it.
--
-- ===========================================================================
-- WHY THERE ARE NO WRITE POLICIES
-- ===========================================================================
-- Nothing a dealership does writes to these tables. Every write comes from the
-- webhook handler, the nightly reconciler, or a platform-admin action — all of
-- them legitimately on the privileged connection, since none has a signed-in
-- dealership user as its subject.
--
-- So `authenticated` is granted SELECT and nothing else. That is deliberate:
-- src/db/README.md warns that a grant without a matching policy makes writes
-- affect zero rows *silently*, which is the worst failure mode available. With
-- no grant at all, a write that accidentally reaches the scoped connection
-- fails loudly with "permission denied for table" instead of appearing to
-- work. Loud and wrong beats quiet and wrong.
--
-- Idempotent. Applied with `npm run db:apply` — see src/db/README.md.

-- ---------------------------------------------------------------------------
-- Enums. CREATE TYPE has no IF NOT EXISTS, hence the guards.
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lifecycle_status') THEN
    CREATE TYPE lifecycle_status AS ENUM (
      'TRIAL', 'EXPIRED', 'ACTIVE', 'PAST_DUE', 'RESTRICTED',
      'SUSPENDED', 'CANCELED', 'CHURNED', 'COMPED'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lifecycle_actor') THEN
    CREATE TYPE lifecycle_actor AS ENUM ('SYSTEM', 'WEBHOOK', 'RECONCILER', 'PLATFORM_ADMIN');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'collection_mode') THEN
    CREATE TYPE collection_mode AS ENUM ('CARD', 'INVOICE');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_status') THEN
    CREATE TYPE subscription_status AS ENUM (
      'TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'COMPED'
    );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- The lifecycle status itself.
--
-- Defaults to TRIAL so a brand-new tenant needs no extra write to be in a
-- sensible state. Existing rows are handled by 0024, which deliberately does
-- NOT use this default.
-- ---------------------------------------------------------------------------
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS lifecycle_status lifecycle_status NOT NULL DEFAULT 'TRIAL';

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS lifecycle_changed_at timestamptz NOT NULL DEFAULT now();

-- On the organization rather than the subscription because a trial predates
-- any Stripe object — there is nothing else to hang it on.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz DEFAULT (now() + interval '30 days');

CREATE INDEX IF NOT EXISTS organizations_lifecycle_idx
  ON public.organizations (lifecycle_status);

-- ---------------------------------------------------------------------------
-- May the current user see this organization's commercial detail?
--
-- The codebase's first org-scoped predicate. Billing belongs to the group, not
-- the rooftop: a dealer group signs one contract and an invoice covers every
-- store on it, so scoping this per store would show a fixed-ops director half
-- of their own bill.
--
-- Narrower than "works here" — an advisor has no business reading what the
-- dealership pays. The same three roles src/lib/team/roster.ts already treats
-- as able to administer a store.
--
-- SECURITY DEFINER for the usual reason: it reads user_store_roles, which is
-- itself protected, and an invoker-rights function would recurse into that
-- table's own policy. search_path pinned to defeat hijacking.
-- ---------------------------------------------------------------------------
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
      AND s.organization_id = target_org
      AND s.is_active = true
      AND usr.role IN ('SERVICE_MANAGER', 'FIXED_OPS_DIRECTOR', 'ADMIN')
  )
$$;

REVOKE ALL ON FUNCTION public.current_user_manages_org(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.current_user_manages_org(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- billing_accounts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing_accounts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,

  stripe_customer_id  text UNIQUE,
  collection_mode     collection_mode NOT NULL DEFAULT 'CARD',

  billing_email       text NOT NULL,
  billing_name        text,

  po_number           text,
  net_terms_days      integer,
  tax_exempt          boolean NOT NULL DEFAULT false,

  notes               text,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS billing_accounts_org_idx ON billing_accounts (organization_id);

ALTER TABLE billing_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_accounts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS billing_accounts_read ON public.billing_accounts;
CREATE POLICY billing_accounts_read ON public.billing_accounts
  FOR SELECT TO authenticated
  USING (public.current_user_manages_org(organization_id) OR public.is_platform_admin());

GRANT SELECT ON public.billing_accounts TO authenticated;

-- ---------------------------------------------------------------------------
-- subscriptions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscriptions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_account_id      uuid NOT NULL REFERENCES billing_accounts(id) ON DELETE CASCADE,

  -- Null only for COMPED, which has no Stripe counterpart at all.
  stripe_subscription_id  text UNIQUE,

  plan_key                text NOT NULL,
  status                  subscription_status NOT NULL,
  rooftop_quantity        integer NOT NULL DEFAULT 1,

  current_period_end      timestamptz,
  cancel_at_period_end    boolean NOT NULL DEFAULT false,
  trial_ends_at           timestamptz,

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscriptions_account_idx ON subscriptions (billing_account_id);
CREATE INDEX IF NOT EXISTS subscriptions_status_idx  ON subscriptions (status);

-- A comped account has no Stripe subscription, and two of them would both
-- carry NULL — which a plain UNIQUE permits and is correct. This only stops
-- the same real Stripe subscription being mirrored twice.
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subscriptions_read ON public.subscriptions;
CREATE POLICY subscriptions_read ON public.subscriptions
  FOR SELECT TO authenticated
  USING (
    billing_account_id IN (
      SELECT id FROM public.billing_accounts
      WHERE public.current_user_manages_org(organization_id)
    )
    OR public.is_platform_admin()
  );

GRANT SELECT ON public.subscriptions TO authenticated;

-- ---------------------------------------------------------------------------
-- subscription_changes — append-only commercial history
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscription_changes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id    uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,

  kind               text NOT NULL,
  before             text,
  after              text,

  changed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reason             text,

  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscription_changes_sub_idx
  ON subscription_changes (subscription_id, created_at);

ALTER TABLE subscription_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_changes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subscription_changes_read ON public.subscription_changes;
CREATE POLICY subscription_changes_read ON public.subscription_changes
  FOR SELECT TO authenticated
  USING (
    subscription_id IN (
      SELECT s.id FROM public.subscriptions s
      JOIN public.billing_accounts ba ON ba.id = s.billing_account_id
      WHERE public.current_user_manages_org(ba.organization_id)
    )
    OR public.is_platform_admin()
  );

GRANT SELECT ON public.subscription_changes TO authenticated;

-- ---------------------------------------------------------------------------
-- lifecycle_events — why the status column says what it says
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lifecycle_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Null on the very first row, where there was no previous state.
  from_status     lifecycle_status,
  to_status       lifecycle_status NOT NULL,

  actor           lifecycle_actor NOT NULL,
  actor_user_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  reason          text,

  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lifecycle_events_org_idx
  ON lifecycle_events (organization_id, created_at);

ALTER TABLE lifecycle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifecycle_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lifecycle_events_read ON public.lifecycle_events;
CREATE POLICY lifecycle_events_read ON public.lifecycle_events
  FOR SELECT TO authenticated
  USING (public.current_user_manages_org(organization_id) OR public.is_platform_admin());

GRANT SELECT ON public.lifecycle_events TO authenticated;

-- ---------------------------------------------------------------------------
-- stripe_events — the raw ledger, and the idempotency mechanism
--
-- Platform-only. No tenant policy of any kind: raw payloads carry billing
-- detail no dealership should read, including other dealerships'. No grant to
-- `authenticated` either, so the scoped connection cannot reach it at all.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stripe_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The idempotency key. A retried delivery conflicts here and becomes a no-op,
  -- which is why nothing downstream of this table has to be idempotent itself.
  stripe_event_id text NOT NULL UNIQUE,
  event_type      text NOT NULL,
  livemode        boolean NOT NULL,

  payload         text NOT NULL,
  relevant        boolean NOT NULL DEFAULT true,

  processed_at    timestamptz,
  error           text,

  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stripe_events_type_idx        ON stripe_events (event_type, created_at);
CREATE INDEX IF NOT EXISTS stripe_events_unprocessed_idx ON stripe_events (processed_at);

ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stripe_events_read ON public.stripe_events;
CREATE POLICY stripe_events_read ON public.stripe_events
  FOR SELECT TO authenticated
  USING (public.is_platform_admin());

GRANT SELECT ON public.stripe_events TO authenticated;
