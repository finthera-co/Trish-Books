-- ─────────────────────────────────────────────────────────────────────────────
-- Bookkeeping agent — proposal queue.
--
-- The agent never writes to the ledger. Each action it wants to take becomes a
-- row here; a person approves it, and only then does the browser run the
-- action through the path the app already uses for it (validate-journal-entry,
-- clear_suspense_lines, the bill form). Approval therefore runs on the
-- approver's JWT and RLS, never on anything the model was trusted with.
--
-- Rows are inserted by the agent's edge function on the *caller's* client, so
-- the INSERT policy is the tenant boundary. There is deliberately no UPDATE or
-- DELETE policy: status only moves through the RPCs below, which own the state
-- machine  pending → applying → applied | failed,  pending|failed → rejected.
-- ─────────────────────────────────────────────────────────────────────────────

-- One conversation store for both agents; the discriminator keeps the
-- analyst's history list from filling up with bookkeeping sessions.
ALTER TABLE public.analyst_conversations
  ADD COLUMN IF NOT EXISTS agent text NOT NULL DEFAULT 'analyst'
  CHECK (agent IN ('analyst', 'bookkeeper'));

CREATE TABLE IF NOT EXISTS public.agent_proposals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.analyst_conversations(id) ON DELETE SET NULL,
  -- The user whose session drove the agent. SET NULL rather than RESTRICT so
  -- removing a user (or hard-deleting the tenant) is never blocked by history.
  proposed_by     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  kind            text NOT NULL CHECK (kind IN ('journal_entry', 'supplier_bill', 'clear_suspense')),
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'applying', 'applied', 'rejected', 'failed')),
  title           text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 200),
  rationale       text NOT NULL DEFAULT '' CHECK (char_length(rationale) <= 4000),
  -- Exactly what Approve will submit. Shape is per kind; see _shared/bookkeepingTools.ts.
  payload         jsonb NOT NULL,
  -- Display-only denormalisation (account names, totals) captured at proposal
  -- time, so the review list renders without re-resolving every id.
  preview         jsonb NOT NULL DEFAULT '{}'::jsonb,
  result          jsonb,
  error           text,
  decided_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  decided_at      timestamptz,
  claimed_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_proposals_tenant_status
  ON public.agent_proposals (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_proposals_conversation
  ON public.agent_proposals (conversation_id) WHERE conversation_id IS NOT NULL;

ALTER TABLE public.agent_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_proposals_select ON public.agent_proposals;
CREATE POLICY agent_proposals_select ON public.agent_proposals
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT get_user_tenant_id()));

-- A new row can only be a pending proposal by the caller, in the caller's
-- tenant — no pre-decided or pre-applied rows, whatever the agent sends.
DROP POLICY IF EXISTS agent_proposals_insert ON public.agent_proposals;
CREATE POLICY agent_proposals_insert ON public.agent_proposals
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = (SELECT get_user_tenant_id())
    AND status = 'pending'
    AND proposed_by = (SELECT u.id FROM public.users u WHERE u.auth_user_id = auth.uid())
    AND decided_by IS NULL
    AND decided_at IS NULL
    AND claimed_at IS NULL
    AND result IS NULL
    AND error IS NULL
  );

-- ── State machine ────────────────────────────────────────────────────────────

/** Resolves the caller and checks they may decide proposals. Same role list as
 *  the journal_entries manage policy and clear_suspense_lines. */
CREATE OR REPLACE FUNCTION public._agent_proposal_actor()
RETURNS TABLE (user_id uuid, tenant_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role text;
BEGIN
  SELECT u.id, u.tenant_id, r.role_name
    INTO user_id, tenant_id, v_role
    FROM public.users u
    LEFT JOIN public.roles r ON r.id = u.role_id
   WHERE u.auth_user_id = auth.uid();

  IF user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;
  IF v_role IS NULL OR v_role NOT IN ('Super Admin', 'Primary Admin', 'Company Admin', 'Accountant') THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: role % cannot approve agent proposals', COALESCE(v_role, 'unknown');
  END IF;
  RETURN NEXT;
END;
$$;

/** pending|failed → applying. The row lock plus the status predicate is what
 *  stops two approvers (or a double click) from applying the same proposal
 *  twice. A claim older than 10 minutes is treated as abandoned — the tab that
 *  held it closed mid-apply — and can be taken again; the UI warns that the
 *  action may already have gone through. */
CREATE OR REPLACE FUNCTION public.claim_agent_proposal(p_id uuid)
RETURNS public.agent_proposals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor record;
  v_row   public.agent_proposals;
BEGIN
  SELECT * INTO v_actor FROM public._agent_proposal_actor();

  SELECT * INTO v_row FROM public.agent_proposals
   WHERE id = p_id AND agent_proposals.tenant_id = v_actor.tenant_id
   FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'PROPOSAL_NOT_FOUND';
  END IF;
  IF NOT (
    v_row.status IN ('pending', 'failed')
    OR (v_row.status = 'applying' AND v_row.claimed_at < now() - interval '10 minutes')
  ) THEN
    RAISE EXCEPTION 'PROPOSAL_NOT_PENDING: proposal is %', v_row.status;
  END IF;

  UPDATE public.agent_proposals
     SET status = 'applying', claimed_at = now(), decided_by = v_actor.user_id,
         error = NULL, updated_at = now()
   WHERE id = p_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

/** → applied. From applying (claimed by the caller) for actions the browser
 *  runs directly, or straight from pending for supplier bills, which are
 *  applied by saving the pre-filled bill form rather than by a claim. */
CREATE OR REPLACE FUNCTION public.complete_agent_proposal(p_id uuid, p_result jsonb)
RETURNS public.agent_proposals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor record;
  v_row   public.agent_proposals;
BEGIN
  SELECT * INTO v_actor FROM public._agent_proposal_actor();

  UPDATE public.agent_proposals
     SET status = 'applied', result = p_result, error = NULL,
         decided_by = v_actor.user_id, decided_at = now(), updated_at = now()
   WHERE id = p_id
     AND agent_proposals.tenant_id = v_actor.tenant_id
     AND (
       (status = 'applying' AND decided_by = v_actor.user_id)
       OR (status IN ('pending', 'failed') AND kind = 'supplier_bill')
     )
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'PROPOSAL_NOT_CLAIMED: proposal is not awaiting completion by you';
  END IF;
  RETURN v_row;
END;
$$;

/** applying → failed, keeping the reason so the reviewer sees why. */
CREATE OR REPLACE FUNCTION public.fail_agent_proposal(p_id uuid, p_error text)
RETURNS public.agent_proposals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor record;
  v_row   public.agent_proposals;
BEGIN
  SELECT * INTO v_actor FROM public._agent_proposal_actor();

  UPDATE public.agent_proposals
     SET status = 'failed', error = left(COALESCE(p_error, 'Unknown error'), 2000),
         claimed_at = NULL, updated_at = now()
   WHERE id = p_id
     AND agent_proposals.tenant_id = v_actor.tenant_id
     AND status = 'applying'
     AND decided_by = v_actor.user_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'PROPOSAL_NOT_CLAIMED: proposal is not being applied by you';
  END IF;
  RETURN v_row;
END;
$$;

/** pending|failed → rejected. */
CREATE OR REPLACE FUNCTION public.reject_agent_proposal(p_id uuid, p_reason text DEFAULT NULL)
RETURNS public.agent_proposals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor record;
  v_row   public.agent_proposals;
BEGIN
  SELECT * INTO v_actor FROM public._agent_proposal_actor();

  UPDATE public.agent_proposals
     SET status = 'rejected', error = NULLIF(btrim(COALESCE(p_reason, '')), ''),
         decided_by = v_actor.user_id, decided_at = now(), updated_at = now()
   WHERE id = p_id
     AND agent_proposals.tenant_id = v_actor.tenant_id
     AND status IN ('pending', 'failed')
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'PROPOSAL_NOT_PENDING: only pending or failed proposals can be rejected';
  END IF;
  RETURN v_row;
END;
$$;

-- None of these take a tenant parameter (the tenant comes from auth.uid()),
-- but anon still has no business calling them.
REVOKE ALL ON FUNCTION public._agent_proposal_actor()                FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_agent_proposal(uuid)             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_agent_proposal(uuid, jsonb)   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fail_agent_proposal(uuid, text)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reject_agent_proposal(uuid, text)      FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_agent_proposal(uuid)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_agent_proposal(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fail_agent_proposal(uuid, text)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_agent_proposal(uuid, text)    TO authenticated;
-- _agent_proposal_actor is only ever called from the definer functions above.
