-- Gated demo tours: a code that unlocks a walkthrough of the seeded store.
--
-- ===========================================================================
-- WHY THIS TABLE EXISTS
-- ===========================================================================
-- `/demo` — the coverage engine — is open to anyone with a VIN and stays that
-- way; the press page says so in as many words. It answers one question from
-- one engine and gives nothing away about how the workspace is put together.
--
-- A tour is a different offer. It signs the visitor into the seeded demo
-- dealership as real staff and lets them walk the drive, a prep sheet, the
-- menu and the follow-up list. That is exactly what a dealership that has
-- booked a walkthrough should see, and exactly what a competitor should not be
-- able to help themselves to at two in the morning. So a tour needs a code, and
-- a code needs somewhere to live.
--
-- ===========================================================================
-- WHY IT BELONGS WITH THE MARKETING SCHEMA AND NOT WITH TENANCY
-- ===========================================================================
-- Same reason `demo_requests` sits there: a code is issued to a lead, and a
-- lead is pre-tenant by definition. There is no `store_id` to scope it by,
-- nobody at a dealership will ever read it, and the whole row exists before the
-- organisation it might one day become. Putting it in the tenancy schema would
-- mean inventing a store to hang it off, which is the sort of tidy lie that
-- costs somebody an afternoon later.
--
-- The optional FK to `demo_requests` records the usual case — Dan rings a lead
-- back, books a walkthrough, issues them a code from that lead's own row — while
-- leaving room for the code handed out at a conference to somebody who never
-- filled the form in. ON DELETE SET NULL rather than CASCADE: deleting a lead
-- should not silently destroy the record of who was given a way in.
--
-- ===========================================================================
-- THE RAW CODE IS NEVER STORED
-- ===========================================================================
-- `code_hash` only, SHA-256, unique — the same discipline as
-- `store_invitations.token_hash` (see src/lib/invites/invite.ts) and
-- `devices.token_hash`. A dump of this table lets nobody take a tour, and there
-- is deliberately no "show me that code again": the console prints it once at
-- the moment of issue and then it is gone, because a code that can be recovered
-- from the database is a code the database is responsible for keeping.
--
-- Ten characters from an unambiguous alphabet (no 0/O/1/I), which is about
-- fifty bits. Short of an invitation's 32 random bytes on purpose — this one
-- has to survive being read down a phone line, and what it opens is a fictional
-- store full of invented Ford owners rather than a real dealership's customers.
--
-- ===========================================================================
-- USAGE TRACKING: A COUNTER HERE, THE DETAIL IN THE AUDIT LOG
-- ===========================================================================
-- `uses` and `last_used_at` answer the question the console actually asks —
-- "did they ever use it, and when did they last look" — in one row with no
-- join. Anything finer than that (which role, in what order, how many times
-- each) is a per-redemption fact, and this repository already has the
-- append-only table for per-event facts: `audit_log`, with
-- `DEMO_TOUR_REDEEMED` carrying the code id, the role and the demo account.
--
-- A second `demo_tour_redemptions` table would have been the obvious move and
-- would have duplicated `audit_log` badly: same shape, weaker guarantees (0020
-- makes the audit log genuinely append-only; a new table would start out
-- rewritable), and a second place to look when answering one question.
--
-- ===========================================================================
-- ROW-LEVEL SECURITY
-- ===========================================================================
-- FORCEd, like every table here. One policy: platform staff may read. Nobody
-- else can tell the table has rows.
--
-- Every write — issue, revoke, and the counter bump on redemption — goes
-- through the privileged connection, and the reasons differ per path:
--
--   * Redemption is public and unauthenticated. The person entering a code has
--     no session and is not going to get one until they pick a role, so there
--     is no `auth.uid()` for a policy to key off. This is the same row of the
--     table in src/db/README.md that `app/request-demo/actions.ts` sits on.
--   * Issue and revoke run from /admin, whose actions already run privileged
--     for the reason `provisionFromLead` states: platform staff are authorised
--     by `requirePlatformAdmin()`, not by a tenancy policy.
--
-- So SELECT is the only grant, exactly as 0017 did for `demo_requests` after
-- 0016 gave it a read policy with no grant behind it and the console answered
-- `permission denied for table`. A policy is not a grant; a grant is not a
-- policy. See src/db/README.md, where this repository has written that mistake
-- down three times.
--
-- ===========================================================================
-- SEQUENCING
-- ===========================================================================
-- Apply before the code deploys — `npm run db:apply`. The table is new, so
-- nothing existing is touched and there is nothing to back out; ahead of the
-- deploy the only consequence is a /tour page that cannot find a code, and
-- behind it the console's issue button errors on a missing relation.
--
-- Idempotent. Safe to run twice.

CREATE TABLE IF NOT EXISTS demo_tour_codes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Usually issued to a lead. Null for a code handed out at a conference or to
  -- somebody who came in through an introduction rather than the form.
  demo_request_id  uuid REFERENCES demo_requests(id) ON DELETE SET NULL,

  -- Who it was issued to, in words, because `demo_request_id` is null often
  -- enough that the console cannot rely on a join to label a row. Free text on
  -- purpose: "Ray at Lone Star, called 19 Aug" is more use than any enum.
  label            text NOT NULL,

  -- SHA-256 of the normalised code. The raw value is shown once and never
  -- written down. Unique so a collision is a constraint violation rather than
  -- two codes that both open the door and disagree about whose it is.
  code_hash        text NOT NULL,

  -- Seven days, matching an invitation. The default is here as well as in
  -- src/lib/demo-tour/codes.ts so a row inserted by hand during support is not
  -- immortal; the application always passes an explicit value.
  expires_at       timestamptz NOT NULL DEFAULT (now() + interval '7 days'),

  -- Withdrawn, never deleted. "Who could see the product last March" is the
  -- same question `platform_admins` and `store_invitations` keep their revoked
  -- rows to answer.
  revoked_at       timestamptz,
  revoked_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,

  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,

  -- The cheap half of usage tracking. The per-redemption detail — which role,
  -- which demo account — is in audit_log under DEMO_TOUR_REDEEMED.
  uses             integer NOT NULL DEFAULT 0,
  last_used_at     timestamptz,

  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS demo_tour_codes_hash_unique
  ON demo_tour_codes (code_hash);

-- The console lists newest first, and the lead page filters to one lead.
CREATE INDEX IF NOT EXISTS demo_tour_codes_created_idx
  ON demo_tour_codes (created_at DESC);
CREATE INDEX IF NOT EXISTS demo_tour_codes_lead_idx
  ON demo_tour_codes (demo_request_id)
  WHERE demo_request_id IS NOT NULL;

ALTER TABLE demo_tour_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE demo_tour_codes FORCE ROW LEVEL SECURITY;

-- Platform staff read. Nobody else knows the table has rows — the same single
-- policy `demo_requests` carries, for the same reason: these belong to
-- DealerTech, not to any dealership.
DROP POLICY IF EXISTS demo_tour_codes_read ON public.demo_tour_codes;
CREATE POLICY demo_tour_codes_read ON public.demo_tour_codes
  FOR SELECT TO authenticated
  USING (public.is_platform_admin());

-- A policy is not a grant. SELECT only: every write path is privileged and
-- stated above, so an INSERT grant here would widen the surface for nothing.
GRANT SELECT ON public.demo_tour_codes TO authenticated;

COMMENT ON TABLE demo_tour_codes IS
  'Access codes that unlock a guided tour of the seeded demo store at /tour. Pre-tenant, like demo_requests. Only the SHA-256 of the code is stored; the raw value is shown once at issue and is not recoverable. Lifecycle lives in src/lib/demo-tour/.';

COMMENT ON COLUMN demo_tour_codes.uses IS
  'Total redemptions across all roles. Per-redemption detail (which role, which demo account, when) is in audit_log under DEMO_TOUR_REDEEMED.';
