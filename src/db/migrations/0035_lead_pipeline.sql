-- The founder's desk: what happened to a lead, and when.
--
-- ===========================================================================
-- WHY THERE IS NO `stage` COLUMN
-- ===========================================================================
-- The obvious shape for a pipeline is an enum on the lead and a board that
-- drags cards between its values. This deliberately is not that. Every stage
-- DealerTech cares about is already provable from something that actually
-- happened — somebody was rung, a tour code was issued, a code was redeemed, a
-- walkthrough was booked, an organisation was provisioned, a menu was
-- presented — and a stored stage would be a second opinion about those facts.
-- Two opinions is how a board ends up saying CONTACTED about a dealership that
-- has been live for a month.
--
-- So this migration adds facts, not a state machine. `src/lib/crm/stage.ts`
-- computes the stage from them, purely and testably, and the columns here are
-- only the ones no existing fact can stand in for:
--
--   walkthrough_at       a datetime somebody agreed to on a call
--   walkthrough_done_at  Dan saying the call happened; nothing observes it
--   lost_at, lost_reason the one terminal outcome, which is a decision
--   provisioned_org_id   the link from lead to tenant, absent until now
--
-- `provisioned_org_id` is the interesting one: provisioning already created an
-- organisation from a lead and then forgot which lead it came from, so the
-- console could not answer "did this prospect ever become a customer" without
-- somebody matching dealership names by eye. ON DELETE SET NULL rather than
-- CASCADE — deleting an organisation must never delete the record of the
-- conversation that produced it.
--
-- ===========================================================================
-- `lead_events`: THE BUSINESS NARRATIVE, BESIDE THE SECURITY RECORD
-- ===========================================================================
-- `demo_requests.notes` is one textarea and it stays exactly that: the current
-- position, rewritten each time. What it cannot be is a history — every save
-- overwrites the last call — and "what did we actually say to them in March"
-- is the question a founder's desk exists to answer.
--
-- This is not `audit_log` and must not become it. The audit log has a closed
-- vocabulary (src/lib/audit/events.ts), is never updated or deleted (0020),
-- and answers "who did what to which record". `lead_events` answers "what is
-- the story of this deal" in prose somebody typed. Both get written by the
-- same actions and they are not redundant: LEAD_WALKTHROUGH_BOOKED is the
-- security record, "Booked the walkthrough for Thursday 2pm, Ray is bringing
-- his fixed ops director" is the narrative.
--
-- Append-only by convention rather than by trigger. There is no update or
-- delete path anywhere in the code, which is the same discipline
-- `lifecycle_events` carries; 0020's hard enforcement is reserved for the log
-- that a dispute is settled from.
--
-- ON DELETE CASCADE, unlike the tour codes' SET NULL. A tour code survives its
-- lead because it is a credential somebody was handed and "who could see the
-- product last March" outlives the prospect. A note about a conversation with
-- a deleted lead is just orphaned personal data, and the privacy policy says
-- deleting a demo request deletes what we wrote about it.
--
-- ===========================================================================
-- GRANTS: THE 0034 INCANTATION, BECAUSE SUPABASE PRE-GRANTS EVERYTHING
-- ===========================================================================
-- 0034 found `anon` and `authenticated` holding DELETE, INSERT, REFERENCES,
-- SELECT, TRIGGER, TRUNCATE and UPDATE on a table whose creating migration had
-- granted SELECT and said so in a comment. The cause is Supabase's
-- `ALTER DEFAULT PRIVILEGES`, which fills the privilege row on every new table
-- in `public` the moment it is created — so a GRANT in a fresh migration adds
-- nothing and its comment describes an intention rather than a state.
--
-- The two parts RLS does not cover are why this matters: TRUNCATE is not
-- subject to row-level security at all, and UPDATE or DELETE under a
-- SELECT-only policy matches zero rows and reports success. So the same three
-- lines 0034 ends with are repeated here, for a table created one migration
-- later, and the live catalog is checked afterwards rather than trusted.
--
-- A policy is not a grant and a grant is not a policy (0016/0017, then 0021).
-- Both halves are below: the read policy narrows to platform staff, the GRANT
-- makes the policy mean anything at all. Every write runs on the privileged
-- connection from `requirePlatformAdmin()`-guarded actions, exactly as
-- `demo_tour_codes` does, so there is no write grant and no write policy.
--
-- Idempotent — ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS, DROP
-- POLICY before CREATE, REVOKE and GRANT both replayable. Applied with
-- `npm run db:apply`; see src/db/README.md.

-- --------------------------------------------------------------- the facts

ALTER TABLE demo_requests
  ADD COLUMN IF NOT EXISTS walkthrough_at      timestamptz,
  ADD COLUMN IF NOT EXISTS walkthrough_done_at timestamptz,
  ADD COLUMN IF NOT EXISTS lost_at             timestamptz,
  ADD COLUMN IF NOT EXISTS lost_reason         text,
  ADD COLUMN IF NOT EXISTS provisioned_org_id  uuid
    REFERENCES organizations(id) ON DELETE SET NULL;

COMMENT ON COLUMN demo_requests.walkthrough_at IS
  'When the walkthrough is booked for. Stored in UTC; the founder''s timezone is the only one that matters until a second person is selling.';
COMMENT ON COLUMN demo_requests.walkthrough_done_at IS
  'Set by hand — no fact observes whether a call happened. Absent, a booking in the past still reads as WALKTHROUGH_BOOKED rather than regressing.';
COMMENT ON COLUMN demo_requests.provisioned_org_id IS
  'The organisation this lead became. Written inside the provisioning transaction; SET NULL so deleting a tenant never deletes the record of the conversation.';

-- The morning read asks for today's walkthroughs and this week's, and the
-- partial index keeps that off a sequential scan of every lead ever captured.
CREATE INDEX IF NOT EXISTS demo_requests_walkthrough_idx
  ON demo_requests (walkthrough_at)
  WHERE walkthrough_at IS NOT NULL;

-- "Which lead became this tenant" — the reverse lookup the console could not
-- do at all before today.
CREATE INDEX IF NOT EXISTS demo_requests_provisioned_org_idx
  ON demo_requests (provisioned_org_id)
  WHERE provisioned_org_id IS NOT NULL;

-- ------------------------------------------------------------ the narrative

CREATE TABLE IF NOT EXISTS lead_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  demo_request_id    uuid NOT NULL REFERENCES demo_requests(id) ON DELETE CASCADE,

  -- Four kinds, checked in the database as well as in the type. NOTE and CALL
  -- are typed by a person; STAGE and SYSTEM are written by the action that did
  -- the thing, so the timeline reads as one story rather than as notes with
  -- gaps where the software acted.
  kind               text NOT NULL
    CHECK (kind IN ('NOTE', 'CALL', 'STAGE', 'SYSTEM')),

  body               text NOT NULL,

  -- When it happened, not when it was typed. A call written up the next
  -- morning belongs on the day of the call.
  occurred_at        timestamptz NOT NULL DEFAULT now(),

  -- Null for a row written by a job rather than a person. Nothing writes one
  -- today; the column is here so the first one does not need a migration.
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL
);

-- The only read this table has: one lead's story, newest first.
CREATE INDEX IF NOT EXISTS lead_events_lead_idx
  ON lead_events (demo_request_id, occurred_at DESC);

ALTER TABLE lead_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_events FORCE ROW LEVEL SECURITY;

-- Platform staff read; nobody else can tell the table has rows. The same
-- single policy `demo_requests` and `demo_tour_codes` carry, for the same
-- reason: these belong to DealerTech, not to any dealership.
DROP POLICY IF EXISTS lead_events_read ON public.lead_events;
CREATE POLICY lead_events_read ON public.lead_events
  FOR SELECT TO authenticated
  USING (public.is_platform_admin());

-- The 0034 incantation. Supabase's default privileges have already granted
-- anon and authenticated everything on this table, including TRUNCATE, which
-- no policy can restrain. Take it all back, then grant the one privilege the
-- console genuinely needs.
REVOKE ALL ON public.lead_events FROM anon;
REVOKE ALL ON public.lead_events FROM authenticated;
GRANT SELECT ON public.lead_events TO authenticated;

COMMENT ON TABLE lead_events IS
  'The activity log for a demo request: what was said, and what the console did. Append-only by convention — no update or delete path exists in the application. Distinct from audit_log, which keeps a closed vocabulary for the security record; this is the business narrative. Read only by platform staff (0016 pattern); every write is privileged.';

COMMENT ON COLUMN lead_events.kind IS
  'NOTE and CALL are typed by a person. STAGE and SYSTEM are written by the action that did the thing — issuing a code, booking a walkthrough, provisioning a tenant.';
