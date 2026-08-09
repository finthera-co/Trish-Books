-- ─────────────────────────────────────────────────────────────────────────────
-- Intelligent Financial Analyst — retrieval index + conversation store
--
-- The analyst answers questions by calling the report RPCs that already exist
-- (rpc_trial_balance, rpc_fs_statement, gl_account_balances, ...). Those need
-- exact identifiers — an account_id, a customer_id — but a user asks "what did
-- we spend on marketing consultants". Nothing in the schema bridges that gap:
-- the words the user says are not the words in account_name, and ILIKE finds
-- "consultant" only when someone literally typed it.
--
-- analyst_documents is that bridge. Every nameable thing a question can point
-- at (an account, an entry narration, an invoice line, a customer, a vendor)
-- gets one row with a text rendering and its embedding, so a paraphrase finds
-- the identifier and the identifier goes to the report RPC. Retrieval locates;
-- the RPCs are still the only source of a number.
--
-- Freshness is a queue, not a trigger-time embed: the embedding needs an HTTP
-- call to a model provider, which cannot happen inside the transaction that
-- posts a journal entry. Triggers enqueue, the analyst-reindex function drains.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- IF NOT EXISTS ignores the WITH SCHEMA clause, so on a project where pgvector
-- was already installed into `public` the line above is a silent no-op and
-- `extensions.vector` would not resolve. Naming the type unqualified under a
-- search_path covering both schemas works either way; the resolved type OID is
-- what gets stored, so the setting does not need to outlive this script.
SET search_path = public, extensions;

-- ── Retrieval index ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.analyst_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- What kind of thing this row describes. Drives which tool the analyst can
  -- follow the hit with: an 'account' hit feeds get_account_ledger, a
  -- 'customer' hit feeds get_customer_statement, and so on.
  source_type  text NOT NULL CHECK (source_type IN (
                 'account', 'journal_entry', 'invoice_line',
                 'bill_line', 'customer', 'vendor')),
  -- Primary key of the row in its own table. Not a FK: the referenced table
  -- varies by source_type, and a stale index row is harmless (it is filtered
  -- on read and cleaned on the next reindex) whereas a cascade storm on
  -- journal_entries is not.
  source_id    uuid NOT NULL,
  -- The text that was embedded, kept so results are explainable without a
  -- second round of joins and so re-embeds can be skipped when it is unchanged.
  content      text NOT NULL,
  content_hash text NOT NULL,
  -- Identifiers and dates the analyst needs to turn a hit into a tool call
  -- (account_code, account_id, customer_id, entry_date, amount, ...).
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  embedding    vector(1024),
  indexed_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT analyst_documents_source_unique UNIQUE (tenant_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_analyst_documents_tenant
  ON public.analyst_documents (tenant_id, source_type);

-- Rows awaiting their first embedding, or a re-embed after an edit. The
-- reindex function pages through this; it must stay cheap as the table grows.
CREATE INDEX IF NOT EXISTS idx_analyst_documents_pending
  ON public.analyst_documents (tenant_id)
  WHERE embedding IS NULL;

-- HNSW over cosine distance. Built unconditionally rather than IF NOT EXISTS
-- on a guard, because an ivfflat index on an empty table would train on no
-- rows; HNSW has no training step and is correct from the first insert.
CREATE INDEX IF NOT EXISTS idx_analyst_documents_embedding
  ON public.analyst_documents
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

ALTER TABLE public.analyst_documents ENABLE ROW LEVEL SECURITY;

-- Read-only to the tenant; every write goes through the reindex function on
-- the service role, so there is no INSERT/UPDATE/DELETE policy at all.
DROP POLICY IF EXISTS "Tenant users read their analyst index" ON public.analyst_documents;
CREATE POLICY "Tenant users read their analyst index"
  ON public.analyst_documents FOR SELECT
  USING (tenant_id = public.get_user_tenant_id());

-- ── Reindex queue ────────────────────────────────────────────────────────────
--
-- Triggers cannot embed (no HTTP inside the posting transaction) so they record
-- the intent. ON CONFLICT DO NOTHING collapses a burst of edits to one row.

CREATE TABLE IF NOT EXISTS public.analyst_index_queue (
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  source_id   uuid NOT NULL,
  -- 'upsert' re-renders and re-embeds; 'delete' drops the index row.
  op          text NOT NULL DEFAULT 'upsert' CHECK (op IN ('upsert', 'delete')),
  queued_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_analyst_index_queue_age
  ON public.analyst_index_queue (queued_at);

ALTER TABLE public.analyst_index_queue ENABLE ROW LEVEL SECURITY;
-- No policies: service role only. Tenants never read or write the queue.

CREATE OR REPLACE FUNCTION public.analyst_enqueue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- One function serves five tables, so the row is read as jsonb rather than
  -- through static field access: plpgsql cannot dereference a field on a
  -- `record` whose type varies per trigger.
  v_row jsonb;
BEGIN
  -- Branched rather than a CASE expression: a CASE evaluates both arms, and
  -- OLD is unassigned on INSERT (as is NEW on DELETE).
  IF TG_OP = 'DELETE' THEN
    v_row := to_jsonb(OLD);
  ELSE
    v_row := to_jsonb(NEW);
  END IF;

  IF (v_row->>'tenant_id') IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.analyst_index_queue (tenant_id, source_type, source_id, op)
  VALUES (
    (v_row->>'tenant_id')::uuid,
    TG_ARGV[0],
    (v_row->>'id')::uuid,
    CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END
  )
  ON CONFLICT (tenant_id, source_type, source_id)
    DO UPDATE SET op = EXCLUDED.op, queued_at = now();

  RETURN NULL;
END;
$$;

-- invoice_items has no tenant_id of its own — it inherits one through its
-- invoice, so the generic function above cannot serve it.
CREATE OR REPLACE FUNCTION public.analyst_enqueue_invoice_line()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line   record := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  v_tenant uuid;
BEGIN
  SELECT i.tenant_id INTO v_tenant
  FROM public.invoices i
  WHERE i.id = v_line.invoice_id;

  IF v_tenant IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.analyst_index_queue (tenant_id, source_type, source_id, op)
  VALUES (
    v_tenant,
    'invoice_line',
    v_line.id,
    CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END
  )
  ON CONFLICT (tenant_id, source_type, source_id)
    DO UPDATE SET op = EXCLUDED.op, queued_at = now();

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_analyst_enqueue_accounts ON public.accounts;
CREATE TRIGGER trg_analyst_enqueue_accounts
  AFTER INSERT OR UPDATE OF account_name, account_code, account_type, account_subtype, is_active
  OR DELETE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.analyst_enqueue('account');

DROP TRIGGER IF EXISTS trg_analyst_enqueue_journal_entries ON public.journal_entries;
CREATE TRIGGER trg_analyst_enqueue_journal_entries
  AFTER INSERT OR UPDATE OF description, reference, status, voided_at
  OR DELETE ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.analyst_enqueue('journal_entry');

DROP TRIGGER IF EXISTS trg_analyst_enqueue_customers ON public.customers;
CREATE TRIGGER trg_analyst_enqueue_customers
  AFTER INSERT OR UPDATE OF name, legal_name, notes, customer_code, status
  OR DELETE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.analyst_enqueue('customer');

DROP TRIGGER IF EXISTS trg_analyst_enqueue_vendors ON public.vendors;
CREATE TRIGGER trg_analyst_enqueue_vendors
  AFTER INSERT OR UPDATE OF name, email
  OR DELETE ON public.vendors
  FOR EACH ROW EXECUTE FUNCTION public.analyst_enqueue('vendor');

-- Invoice and bill lines carry the free-text descriptions that make spend
-- searchable by what was bought rather than which account it landed in.
DROP TRIGGER IF EXISTS trg_analyst_enqueue_invoice_items ON public.invoice_items;
CREATE TRIGGER trg_analyst_enqueue_invoice_items
  AFTER INSERT OR UPDATE OF description
  OR DELETE ON public.invoice_items
  FOR EACH ROW EXECUTE FUNCTION public.analyst_enqueue_invoice_line();

DROP TRIGGER IF EXISTS trg_analyst_enqueue_bill_lines ON public.supplier_bill_lines;
CREATE TRIGGER trg_analyst_enqueue_bill_lines
  AFTER INSERT OR UPDATE OF description
  OR DELETE ON public.supplier_bill_lines
  FOR EACH ROW EXECUTE FUNCTION public.analyst_enqueue('bill_line');

-- ── Semantic search ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.analyst_search(
  p_query_embedding vector(1024),
  p_source_types    text[] DEFAULT NULL,
  p_limit           int    DEFAULT 12,
  p_min_similarity  real   DEFAULT 0.25
)
RETURNS TABLE (
  source_type text,
  source_id   uuid,
  content     text,
  metadata    jsonb,
  similarity  real
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'No tenant context';
  END IF;

  RETURN QUERY
  SELECT d.source_type,
         d.source_id,
         d.content,
         d.metadata,
         (1 - (d.embedding <=> p_query_embedding))::real AS similarity
  FROM public.analyst_documents d
  WHERE d.tenant_id = v_tenant
    AND d.embedding IS NOT NULL
    -- Passing the filter as a NULL-or-array test rather than two branches keeps
    -- the tenant predicate index-usable; the source_type set is small enough
    -- that the extra rows scanned are irrelevant next to the vector cost.
    AND (p_source_types IS NULL OR d.source_type = ANY (p_source_types))
    AND (1 - (d.embedding <=> p_query_embedding)) >= p_min_similarity
  ORDER BY d.embedding <=> p_query_embedding
  LIMIT GREATEST(1, LEAST(50, p_limit));
END;
$$;

GRANT EXECUTE ON FUNCTION public.analyst_search(vector, text[], int, real) TO authenticated;

-- Coverage, so the UI can say "index is 82% built" instead of silently
-- answering from a third of the ledger.
CREATE OR REPLACE FUNCTION public.analyst_index_status()
RETURNS TABLE (
  total_documents   bigint,
  embedded_documents bigint,
  pending_queue     bigint,
  last_indexed_at   timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'No tenant context';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT count(*) FROM public.analyst_documents d WHERE d.tenant_id = v_tenant),
    (SELECT count(*) FROM public.analyst_documents d
       WHERE d.tenant_id = v_tenant AND d.embedding IS NOT NULL),
    (SELECT count(*) FROM public.analyst_index_queue q WHERE q.tenant_id = v_tenant),
    (SELECT max(d.indexed_at) FROM public.analyst_documents d WHERE d.tenant_id = v_tenant);
END;
$$;

GRANT EXECUTE ON FUNCTION public.analyst_index_status() TO authenticated;

-- ── Conversations ────────────────────────────────────────────────────────────
--
-- The agent loop is stateless per request, so the transcript has to live
-- somewhere for a follow-up question to mean anything. Tool calls and their
-- results are stored alongside the text: they are the audit trail showing which
-- report produced which number, and without them a resumed conversation would
-- have the assistant's claims with none of the evidence.

CREATE TABLE IF NOT EXISTS public.analyst_conversations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title      text NOT NULL DEFAULT 'New analysis',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analyst_conversations_user
  ON public.analyst_conversations (tenant_id, user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.analyst_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.analyst_conversations(id) ON DELETE CASCADE,
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user', 'assistant')),
  content         text NOT NULL DEFAULT '',
  -- [{ name, input, result_summary }] — what the assistant actually queried.
  tool_calls      jsonb NOT NULL DEFAULT '[]'::jsonb,
  usage           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analyst_messages_conversation
  ON public.analyst_messages (conversation_id, created_at);

ALTER TABLE public.analyst_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analyst_messages      ENABLE ROW LEVEL SECURITY;

-- A conversation is private to the person who had it. Tenant-mates cannot read
-- each other's, because a question is often more revealing than its answer
-- ("are we going to make payroll") and nobody consented to sharing that.
DROP POLICY IF EXISTS "Users manage their own analyst conversations" ON public.analyst_conversations;
CREATE POLICY "Users manage their own analyst conversations"
  ON public.analyst_conversations FOR ALL
  USING (
    tenant_id = public.get_user_tenant_id()
    AND user_id = (SELECT u.id FROM public.users u WHERE u.auth_user_id = auth.uid())
  )
  WITH CHECK (
    tenant_id = public.get_user_tenant_id()
    AND user_id = (SELECT u.id FROM public.users u WHERE u.auth_user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users manage their own analyst messages" ON public.analyst_messages;
CREATE POLICY "Users manage their own analyst messages"
  ON public.analyst_messages FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.analyst_conversations c
      WHERE c.id = analyst_messages.conversation_id
        AND c.tenant_id = public.get_user_tenant_id()
        AND c.user_id = (SELECT u.id FROM public.users u WHERE u.auth_user_id = auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.analyst_conversations c
      WHERE c.id = analyst_messages.conversation_id
        AND c.tenant_id = public.get_user_tenant_id()
        AND c.user_id = (SELECT u.id FROM public.users u WHERE u.auth_user_id = auth.uid())
    )
  );

DROP TRIGGER IF EXISTS trg_analyst_conversations_updated_at ON public.analyst_conversations;
CREATE TRIGGER trg_analyst_conversations_updated_at
  BEFORE UPDATE ON public.analyst_conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
