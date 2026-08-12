-- ─────────────────────────────────────────────────────────────
-- Rate limiting: fixed-window counters
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.rate_limit_counters (
  bucket_key    text        NOT NULL,
  window_start  timestamptz NOT NULL,
  route         text        NOT NULL,
  scope         text        NOT NULL CHECK (scope IN ('user','tenant','ip')),
  tenant_id     uuid        NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id       uuid        NULL REFERENCES public.users(id)   ON DELETE CASCADE,
  request_count integer     NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket_key, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rlc_window_start
  ON public.rate_limit_counters (window_start);

CREATE INDEX IF NOT EXISTS idx_rlc_tenant_route
  ON public.rate_limit_counters (tenant_id, route, window_start DESC);

ALTER TABLE public.rate_limit_counters ENABLE ROW LEVEL SECURITY;

-- No policy for anon: deny-all by default.
-- Super admins get read-only visibility for ops/debugging.
DROP POLICY IF EXISTS "Super admins can read rate limit counters"
  ON public.rate_limit_counters;
CREATE POLICY "Super admins can read rate limit counters"
  ON public.rate_limit_counters FOR SELECT TO authenticated
  USING (public.is_super_admin());

-- Strip all default privileges first, then re-grant ONLY SELECT to authenticated
-- so the super-admin RLS policy above is actually reachable. A bare REVOKE ALL
-- would make that policy dead code: RLS narrows a grant, it cannot create one.
-- No INSERT/UPDATE/DELETE for anon or authenticated -- writes are service_role only,
-- via consume_rate_limit().
REVOKE ALL ON TABLE public.rate_limit_counters FROM anon, authenticated;
GRANT SELECT ON TABLE public.rate_limit_counters TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- consume_rate_limit: atomic increment + verdict
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.consume_rate_limit(
  p_scope          text,
  p_identifier     text,
  p_route          text,
  p_limit          integer,
  p_window_seconds integer,
  p_tenant_id      uuid DEFAULT NULL,
  p_user_id        uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start timestamptz;
  v_reset_at     timestamptz;
  v_bucket_key   text;
  v_count        integer;
BEGIN
  IF p_limit <= 0 OR p_window_seconds <= 0 THEN
    RAISE EXCEPTION 'consume_rate_limit: invalid configuration (limit=%, window=%)',
      p_limit, p_window_seconds;
  END IF;
  IF p_identifier IS NULL OR length(trim(p_identifier)) = 0 THEN
    RAISE EXCEPTION 'consume_rate_limit: identifier is required';
  END IF;
  IF p_scope IS NULL OR p_scope NOT IN ('user','tenant','ip') THEN
    RAISE EXCEPTION 'consume_rate_limit: invalid scope %', p_scope;
  END IF;
  IF p_route IS NULL OR length(trim(p_route)) = 0 THEN
    RAISE EXCEPTION 'consume_rate_limit: route is required';
  END IF;

  v_window_start := date_bin(
    make_interval(secs => p_window_seconds), now(), timestamptz 'epoch'
  );
  v_reset_at   := v_window_start + make_interval(secs => p_window_seconds);
  v_bucket_key := p_scope || ':' || p_identifier || ':' || p_route;

  INSERT INTO public.rate_limit_counters AS c
    (bucket_key, window_start, route, scope, tenant_id, user_id, request_count, updated_at)
  VALUES
    (v_bucket_key, v_window_start, p_route, p_scope, p_tenant_id, p_user_id, 1, now())
  ON CONFLICT (bucket_key, window_start) DO UPDATE
    SET request_count = c.request_count + 1,
        updated_at    = now()
  RETURNING c.request_count INTO v_count;

  RETURN jsonb_build_object(
    'allowed',     v_count <= p_limit,
    'limit',       p_limit,
    'remaining',   GREATEST(p_limit - v_count, 0),
    'reset_at',    v_reset_at,
    'retry_after', GREATEST(CEIL(EXTRACT(EPOCH FROM (v_reset_at - now())))::integer, 1)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.consume_rate_limit(text,text,text,integer,integer,uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(text,text,text,integer,integer,uuid,uuid)
  TO service_role;

-- ─────────────────────────────────────────────────────────────
-- Pruning
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.prune_rate_limit_counters(
  p_older_than interval DEFAULT interval '1 day'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_deleted integer;
BEGIN
  DELETE FROM public.rate_limit_counters
   WHERE window_start < now() - p_older_than;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_rate_limit_counters(interval)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_rate_limit_counters(interval) TO service_role;
