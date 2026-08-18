import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// PostgREST serialises numeric as a string. Centralising the coercion here
// means every call site gets a real number, not string concatenation wearing
// a plus sign.
export const toNum = (v: unknown): number => {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

export interface GLAccountNode {
  node_key: string;
  account_id: string;
  parent_account_id: string | null;
  account_code: string | null;
  account_name: string;
  account_type: string;
  label: string;
  depth: number;
  sort_path: string;
  is_other_node: boolean;
  has_children: boolean;
  own_opening: number;
  own_debit: number;
  own_credit: number;
  own_txn_count: number;
  subtree_opening: number;
  subtree_debit: number;
  subtree_credit: number;
}

export interface GLTransactionRow {
  account_id: string;
  entry_id: string;
  line_id: string;
  line_seq: number;
  entry_date: string;
  txn_type: string;
  num: string;
  is_adjusting: boolean;
  entity_name: string;
  memo: string;
  split_text: string;
  debit: number;
  credit: number;
  running_balance: number;
}

export interface GLIntegrityIssue {
  severity: "error" | "warning";
  code: string;
  entity_id: string | null;
  detail: string;
  amount: number | null;
}

function mapAccountTree(rows: any[]): GLAccountNode[] {
  return rows.map((r) => ({
    node_key: r.node_key,
    account_id: r.account_id,
    parent_account_id: r.parent_account_id,
    account_code: r.account_code,
    account_name: r.account_name,
    account_type: r.account_type,
    label: r.label,
    depth: toNum(r.depth),
    sort_path: r.sort_path,
    is_other_node: !!r.is_other_node,
    has_children: !!r.has_children,
    own_opening: toNum(r.own_opening),
    own_debit: toNum(r.own_debit),
    own_credit: toNum(r.own_credit),
    own_txn_count: toNum(r.own_txn_count),
    subtree_opening: toNum(r.subtree_opening),
    subtree_debit: toNum(r.subtree_debit),
    subtree_credit: toNum(r.subtree_credit),
  }));
}

function mapTransactionRow(r: any): GLTransactionRow {
  return {
    account_id: r.account_id,
    entry_id: r.entry_id,
    line_id: r.line_id,
    line_seq: toNum(r.line_seq),
    entry_date: r.entry_date,
    txn_type: r.txn_type,
    num: r.num ?? "",
    is_adjusting: !!r.is_adjusting,
    entity_name: r.entity_name ?? "",
    memo: r.memo ?? "",
    split_text: r.split_text ?? "",
    debit: toNum(r.debit),
    credit: toNum(r.credit),
    running_balance: toNum(r.running_balance),
  };
}

/**
 * Exported standalone as well as behind the hook, because reports that only
 * need the tree at export time (the Trial Balance's combined workbook) must not
 * have to re-derive the row mapping — two copies of it would be free to drift.
 */
export async function fetchGLAccountTree(
  dateFrom: string,
  dateTo: string,
  accountType?: string,
  includeInactive = true
): Promise<GLAccountNode[]> {
  const { data, error } = await supabase.rpc("rpc_gl_account_tree" as any, {
    p_date_from: dateFrom,
    p_date_to: dateTo,
    p_account_type: accountType ?? null,
    p_include_inactive: includeInactive,
  });
  if (error) throw error;
  return mapAccountTree((data ?? []) as any[]);
}

export function useGLAccountTree(
  dateFrom: string,
  dateTo: string,
  accountType?: string,
  includeInactive = true
) {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["gl_tree", appUser?.tenant_id, dateFrom, dateTo, accountType ?? "all", includeInactive],
    enabled: Boolean(dateFrom && dateTo),
    queryFn: () => fetchGLAccountTree(dateFrom, dateTo, accountType, includeInactive),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: 1,
  });
}

const TXN_BATCH_SIZE = 40;
const TXN_PAGE_LIMIT = 5000;

/**
 * Fetches transactions for a set of accounts, batched at 40 account ids per
 * RPC call (issued in parallel) and paginated per batch until total_rows is
 * satisfied. Running balances come straight from the server window function —
 * batching cannot corrupt them (verified: batched and unbatched calls return
 * byte-identical running_balance per line).
 *
 * Exported standalone (not just as a hook) because exports must cover every
 * in-scope account regardless of which accounts happen to be expanded on
 * screen — collapse is UI state, not a data filter.
 */
export async function fetchGLTransactions(
  dateFrom: string,
  dateTo: string,
  accountIds: string[] | null
): Promise<GLTransactionRow[]> {
  const sortedIds = accountIds ? [...accountIds].sort() : null;
  const batches: (string[] | null)[] = sortedIds
    ? Array.from({ length: Math.ceil(sortedIds.length / TXN_BATCH_SIZE) }, (_, i) =>
        sortedIds.slice(i * TXN_BATCH_SIZE, (i + 1) * TXN_BATCH_SIZE)
      )
    : [null];

  const fetchBatch = async (ids: string[] | null): Promise<GLTransactionRow[]> => {
    const rows: GLTransactionRow[] = [];
    let offset = 0;
    for (;;) {
      const { data, error } = await supabase.rpc("rpc_gl_transactions" as any, {
        p_date_from: dateFrom,
        p_date_to: dateTo,
        p_account_ids: ids,
        p_limit: TXN_PAGE_LIMIT,
        p_offset: offset,
      });
      if (error) throw error;
      const page = (data ?? []) as any[];
      rows.push(...page.map(mapTransactionRow));
      const total = page.length > 0 ? toNum(page[0].total_rows) : 0;
      // Advance by what the server actually returned, not by what was asked
      // for. PostgREST truncates any response at its max_rows setting — while
      // that was 1000 and TXN_PAGE_LIMIT was 5000, a short page was read as
      // "end of data" and this report silently stopped at 1000 rows per batch.
      // Trusting the server's own total_rows keeps that from recurring if the
      // setting ever changes again.
      if (page.length === 0) break;
      offset += page.length;
      if (offset >= total) break;
    }
    return rows;
  };

  const results = await Promise.all(batches.map(fetchBatch));
  return results.flat();
}

export function useGLTransactions(dateFrom: string, dateTo: string, accountIds: string[] | null) {
  const { appUser } = useAuth();
  const sortedIds = accountIds ? [...accountIds].sort() : null;
  return useQuery({
    queryKey: ["gl_txns", appUser?.tenant_id, dateFrom, dateTo, sortedIds?.join(",") ?? "all"],
    enabled: Boolean(dateFrom && dateTo),
    queryFn: () => fetchGLTransactions(dateFrom, dateTo, accountIds),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: 1,
  });
}

export function useGLIntegrity(dateFrom: string, dateTo: string) {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["gl_integrity", appUser?.tenant_id, dateFrom, dateTo],
    enabled: Boolean(dateFrom && dateTo),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("rpc_gl_integrity" as any, {
        p_date_from: dateFrom,
        p_date_to: dateTo,
      });
      if (error) throw error;
      return ((data ?? []) as any[]).map(
        (r): GLIntegrityIssue => ({
          severity: r.severity,
          code: r.code,
          entity_id: r.entity_id,
          detail: r.detail,
          amount: r.amount == null ? null : toNum(r.amount),
        })
      );
    },
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: 1,
  });
}

export interface FiscalPeriodSummary {
  id: string;
  name: string;
  period_start: string;
  period_end: string;
  status: string;
  closed_at: string | null;
}

/**
 * Resolves the fiscal period enclosing dateFrom, purely to drive the
 * "range includes a closed period" notice. rpc_gl_account_tree and
 * rpc_gl_transactions now apply the same opening_balances audit override as
 * rpc_trial_balance themselves, so the GL and Trial Balance always agree on
 * opening balances by construction — there is no separate reconciliation to
 * surface here anymore.
 */
export function useGLPeriodInfo(dateFrom: string) {
  const { appUser } = useAuth();
  const tenantId = appUser?.tenant_id;

  const periodQuery = useQuery({
    queryKey: ["gl_period_info", tenantId, dateFrom],
    enabled: Boolean(tenantId && dateFrom),
    queryFn: async (): Promise<FiscalPeriodSummary | null> => {
      const { data, error } = await supabase
        .from("fiscal_periods")
        .select("id, name, period_start, period_end, status, closed_at")
        .eq("tenant_id", tenantId!)
        .lte("period_start", dateFrom)
        .gte("period_end", dateFrom)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  });

  return {
    period: periodQuery.data ?? null,
    isLoading: periodQuery.isLoading,
    error: periodQuery.error,
  };
}
