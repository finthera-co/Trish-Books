import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toNum } from "@/hooks/useGeneralLedger";
import { toast } from "sonner";

export interface FsStatementLine {
  line_id: string;
  line_code: string;
  label: string;
  note_ref: string | null;
  line_type: "detail" | "computed" | "per_share" | "spacer" | "text";
  emphasis: "normal" | "bold" | "bold_rule" | "total_rule";
  show_margin: boolean;
  sort_order: number;
  current_value: number | null;
  compare_value: number | null;
  current_margin: number | null;
  compare_margin: number | null;
  account_count: number;
}

/** One mapped ledger under a statement line — the tree's leaf rows. Values come
 * from fn_fs_eval_accounts, the same computation the line totals are defined as
 * the sum of, so leaves always add up to their branch. */
export interface FsStatementAccount {
  line_id: string;
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  /** The account actually named in fs_line_accounts. Equals account_id for a
   * directly mapped ledger; for a rolled-up descendant it is the ancestor that
   * carried it onto the line. */
  owner_id: string;
  /** 0 = mapped in its own right, 1+ = generations below the mapped ancestor. */
  depth: number;
  current_value: number | null;
  compare_value: number | null;
}

export interface FsCoverageIssue {
  issue_code: "UNMAPPED_ACCOUNT" | "UNMAPPED_BS_ACCOUNT" | "CYCLE" | "MISSING_PARAM" | "TIE_OUT_VARIANCE";
  severity: "error" | "warning";
  account_id: string | null;
  account_code: string | null;
  account_name: string | null;
  detail: string;
  amount: number | null;
}

function mapLine(r: any): FsStatementLine {
  return {
    line_id: r.line_id,
    line_code: r.line_code,
    label: r.label,
    note_ref: r.note_ref,
    line_type: r.line_type,
    emphasis: r.emphasis,
    show_margin: !!r.show_margin,
    sort_order: toNum(r.sort_order),
    current_value: r.current_value == null ? null : toNum(r.current_value),
    compare_value: r.compare_value == null ? null : toNum(r.compare_value),
    current_margin: r.current_margin == null ? null : toNum(r.current_margin),
    compare_margin: r.compare_margin == null ? null : toNum(r.compare_margin),
    account_count: toNum(r.account_count),
  };
}

function mapCoverage(r: any): FsCoverageIssue {
  return {
    issue_code: r.issue_code,
    severity: r.severity,
    account_id: r.account_id,
    account_code: r.account_code,
    account_name: r.account_name,
    detail: r.detail,
    amount: r.amount == null ? null : toNum(r.amount),
  };
}

export function useFsStatement(
  statementCode: string,
  dateFrom: string,
  dateTo: string,
  cmpDateFrom?: string | null,
  cmpDateTo?: string | null
) {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["fs_statement", appUser?.tenant_id, statementCode, dateFrom, dateTo, cmpDateFrom ?? null, cmpDateTo ?? null],
    enabled: Boolean(statementCode && dateFrom && dateTo),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("rpc_fs_statement" as any, {
        p_statement_code: statementCode,
        p_date_from: dateFrom,
        p_date_to: dateTo,
        p_cmp_date_from: cmpDateFrom ?? null,
        p_cmp_date_to: cmpDateTo ?? null,
      });
      if (error) throw error;
      return ((data ?? []) as any[]).map(mapLine);
    },
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: 1,
  });
}

export function useFsStatementAccounts(
  statementCode: string,
  dateFrom: string,
  dateTo: string,
  cmpDateFrom?: string | null,
  cmpDateTo?: string | null
) {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["fs_statement_accounts", appUser?.tenant_id, statementCode, dateFrom, dateTo, cmpDateFrom ?? null, cmpDateTo ?? null],
    enabled: Boolean(appUser?.tenant_id && dateFrom && dateTo),
    queryFn: async (): Promise<FsStatementAccount[]> => {
      const { data, error } = await supabase.rpc("rpc_fs_statement_accounts", {
        p_statement_code: statementCode,
        p_date_from: dateFrom,
        p_date_to: dateTo,
        p_cmp_date_from: cmpDateFrom ?? null,
        p_cmp_date_to: cmpDateTo ?? null,
      });
      if (error) throw error;
      type Row = {
        line_id: string; account_id: string; account_code: string | null;
        account_name: string | null; account_type: string | null;
        owner_id: string | null; depth: unknown;
        current_value: unknown; compare_value: unknown;
      };
      return ((data ?? []) as Row[]).map((r) => ({
        line_id: r.line_id,
        account_id: r.account_id,
        account_code: r.account_code ?? "",
        account_name: r.account_name ?? "",
        account_type: r.account_type ?? "",
        owner_id: r.owner_id ?? r.account_id,
        depth: toNum(r.depth),
        current_value: r.current_value == null ? null : toNum(r.current_value),
        compare_value: r.compare_value == null ? null : toNum(r.compare_value),
      }));
    },
    staleTime: 30_000,
  });
}

export function useFsCoverage(statementCode: string, dateFrom: string, dateTo: string) {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["fs_coverage", appUser?.tenant_id, statementCode, dateFrom, dateTo],
    enabled: Boolean(statementCode && dateFrom && dateTo),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("rpc_fs_coverage" as any, {
        p_statement_code: statementCode,
        p_date_from: dateFrom,
        p_date_to: dateTo,
      });
      if (error) throw error;
      return ((data ?? []) as any[]).map(mapCoverage);
    },
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: 1,
  });
}

/** Invalidate figures and coverage together — stale coverage next to fresh figures is worse than no coverage. */
function invalidateStatement(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["fs_statement"] });
  queryClient.invalidateQueries({ queryKey: ["fs_coverage"] });
  queryClient.invalidateQueries({ queryKey: ["fs_mapping"] });
  // Prefix matching does not reach a differently-named key, and mapping one
  // account changes which OTHER accounts are rolled up under it.
  queryClient.invalidateQueries({ queryKey: ["fs_mapping_expanded"] });
}

export interface FsStatementMeta {
  id: string;
  code: string;
  name: string;
  title: string;
  period_caption: string;
  currency_caption: string;
  footer_notes: string[];
}

/** The statement's own metadata (title, captions, footer notes) — for the on-screen face. */
export function useFsStatementMeta(statementCode: string) {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["fs_statement_meta", appUser?.tenant_id, statementCode],
    enabled: Boolean(statementCode && appUser?.tenant_id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fs_statements")
        .select("id, code, name, title, period_caption, currency_caption, footer_notes")
        .eq("code", statementCode)
        .maybeSingle();
      if (error) throw error;
      return data as FsStatementMeta | null;
    },
    staleTime: 5 * 60_000,
  });
}

/** A ledger that a mapped ancestor carries onto a line (depth >= 1). It has no
 * fs_line_accounts row of its own — unmapping it means unmapping the ancestor,
 * or mapping it somewhere itself, which overrides the roll-up. */
export interface FsRolledAccount {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  depth: number;
  balance: number;
}

export interface FsMappedAccount {
  line_id: string;
  fs_line_account_id: string;
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  period_debit: number;
  period_credit: number;
  /** This account's own postings only. A parent header account reads 0.00. */
  balance: number;
  /** What the line actually takes: own postings plus every rolled-up ledger. */
  rollup_balance: number;
  /** Ledgers swept in under this account, nearest-ancestor rule applied. */
  descendants: FsRolledAccount[];
  /** Descendants that are NOT included because they are mapped in their own
   * right elsewhere on this statement. Shown so a parent reading 0.00 is
   * explained rather than mysterious. */
  diverted: FsRolledAccount[];
}

export interface FsUnmappedAccount {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  period_debit: number;
  period_credit: number;
  balance: number;
}

/**
 * Account types that make up the income statement. Only these drive the
 * mapping screen's tie-out — a balance-sheet account mapped onto a parking
 * line ("Assets", "Amount Due From Related Parties") is presentational and
 * must not move Mapped/Unmapped/Statement total.
 */
export interface FsAccountBalance {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  period_debit: number;
  period_credit: number;
  /** Audit opening + period Dr - Cr, i.e. rpc_trial_balance's Closing column. */
  closing: number;
}

export const FS_PNL_ACCOUNT_TYPES = [
  "Income",
  "Cost of Goods Sold",
  "Expense",
  "Other Income",
  "Other Expense",
] as const;

export function isFsPnlAccountType(t: string | null | undefined): boolean {
  return (FS_PNL_ACCOUNT_TYPES as readonly string[]).includes(t ?? "");
}

/**
 * Mapping-UI data: for the given statement + period, every account already
 * mapped (grouped per line, each with the ledgers it rolls up) and every P&L
 * account with movement that no line picks up — sorted by absolute balance
 * descending, largest omissions first, per the mapping UI's spec.
 *
 * "Picked up" means covered, not merely named: mapping a parent carries its
 * whole subtree, minus any descendant mapped in its own right (the server's
 * nearest-mapped-ancestor rule). A rolled-up ledger is therefore neither
 * unmapped nor available — it is already on a line.
 *
 * `others` is a separate, optional bucket: EVERY remaining ledger — asset,
 * liability, equity — movement or not, so any account can be parked on a
 * statement line. These are never "unmapped" (leaving a balance-sheet account
 * off the income statement is the norm), so they stay out of `unmapped` and
 * out of the tie-out entirely.
 */
export function useFsMapping(statementCode: string, dateFrom: string, dateTo: string) {
  const { appUser } = useAuth();
  const tenantId = appUser?.tenant_id;

  const metaQuery = useFsStatementMeta(statementCode);
  const statementId = metaQuery.data?.id;

  // One rpc_trial_balance call replaces the old client-side paging over
  // journal_lines. Two reasons, both correctness rather than tidiness:
  // it returns EVERY account (p_include_zero) rather than only those whose
  // rows happened to land in a page, and its Closing column is the same
  // figure the statement's cumulative lines report, so this screen and the
  // statement can no longer disagree about what an account is worth.
  const balancesQuery = useQuery({
    queryKey: ["fs_mapping_balances", tenantId, dateFrom, dateTo],
    enabled: Boolean(tenantId && dateFrom && dateTo),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("rpc_trial_balance", {
        p_date_from: dateFrom,
        p_date_to: dateTo,
        p_group_by: "type",
        p_include_zero: true,
        p_include_inactive: true,
      });
      if (error) throw error;
      type TbRow = {
        account_id: string; account_code: string | null; account_name: string | null;
        account_type: string | null; period_debit: unknown; period_credit: unknown; closing: unknown;
      };
      const map = new Map<string, FsAccountBalance>();
      for (const row of (data ?? []) as TbRow[]) {
        map.set(row.account_id, {
          account_id: row.account_id,
          account_code: row.account_code ?? "",
          account_name: row.account_name ?? "",
          account_type: row.account_type ?? "",
          period_debit: toNum(row.period_debit),
          period_credit: toNum(row.period_credit),
          closing: toNum(row.closing),
        });
      }
      return map;
    },
    staleTime: 30_000,
  });

  const mappedQuery = useQuery({
    queryKey: ["fs_mapping", tenantId, statementId],
    enabled: Boolean(tenantId && statementId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fs_line_accounts")
        .select("id, line_id, account_id, accounts(account_code, account_name, account_type), fs_lines!inner(statement_id, sign)")
        .eq("fs_lines.statement_id", statementId!);
      if (error) throw error;
      return (data ?? []) as any[];
    },
    staleTime: 30_000,
  });

  // Which ledgers each mapped account actually carries. Read from the server
  // rather than recomputed here: fn_fs_line_accounts_expanded is what the
  // statement itself is valued from, and a second implementation of the
  // nearest-mapped-ancestor rule would eventually disagree with it.
  const expandedQuery = useQuery({
    queryKey: ["fs_mapping_expanded", tenantId, statementId],
    enabled: Boolean(tenantId && statementId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fn_fs_line_accounts_expanded" as any, {
        p_statement_id: statementId!,
      });
      if (error) throw error;
      return (data ?? []) as { out_line_id: string; out_owner_id: string; out_account_id: string; out_depth: number }[];
    },
    staleTime: 30_000,
  });

  // Parent links, for explaining a subtree that ISN'T rolled up: a child mapped
  // in its own right leaves its parent's roll-up, and a parent then reading
  // 0.00 has to say why.
  const treeQuery = useQuery({
    queryKey: ["fs_mapping_tree", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts")
        .select("id, parent_account_id")
        .eq("tenant_id", tenantId!);
      if (error) throw error;
      const kids = new Map<string, string[]>();
      for (const r of (data ?? []) as { id: string; parent_account_id: string | null }[]) {
        if (!r.parent_account_id) continue;
        const arr = kids.get(r.parent_account_id) ?? [];
        arr.push(r.id);
        kids.set(r.parent_account_id, arr);
      }
      return kids;
    },
    staleTime: 60_000,
  });

  const isLoading = metaQuery.isLoading || balancesQuery.isLoading || mappedQuery.isLoading || expandedQuery.isLoading;
  const error = metaQuery.error || balancesQuery.error || mappedQuery.error || expandedQuery.error;

  const balances = balancesQuery.data ?? new Map<string, FsAccountBalance>();
  const expanded = expandedQuery.data ?? [];
  const childrenOf = treeQuery.data ?? new Map<string, string[]>();

  // Every account the statement picks up, directly or through an ancestor.
  // Nothing in here is "unmapped" — it is already on a line.
  const coveredAccountIds = new Set(expanded.map((e) => e.out_account_id));
  const directlyMappedIds = new Set((mappedQuery.data ?? []).map((r) => r.account_id));

  // What a row is "worth" on this screen, matching how the statement values it:
  // movement for P&L accounts, closing balance for everything else. Once an
  // asset/liability/equity account sits on a line, that line's sign decides the
  // orientation too — a liability parked on the credit-natured "Liabilities"
  // line reads positive here exactly as it does on the face of the statement.
  // Unmapped rows have no line, so they stay in trial-balance orientation.
  const displayValue = (b: FsAccountBalance | undefined, accountType: string, lineSign?: string): number => {
    if (!b) return 0;
    if (isFsPnlAccountType(accountType)) return b.period_credit - b.period_debit;
    return lineSign === "invert" ? -b.closing : b.closing;
  };

  const rolled = (accountId: string, depth: number, lineSign?: string): FsRolledAccount => {
    const b = balances.get(accountId);
    const accountType = b?.account_type ?? "";
    return {
      account_id: accountId,
      account_code: b?.account_code ?? "",
      account_name: b?.account_name ?? "",
      account_type: accountType,
      depth,
      balance: displayValue(b, accountType, lineSign),
    };
  };

  // Descendants grouped by the account that carried them onto the line.
  const descendantsByOwner = new Map<string, { account_id: string; depth: number }[]>();
  for (const e of expanded) {
    if (e.out_depth === 0) continue;
    const key = `${e.out_line_id}:${e.out_owner_id}`;
    const arr = descendantsByOwner.get(key) ?? [];
    arr.push({ account_id: e.out_account_id, depth: e.out_depth });
    descendantsByOwner.set(key, arr);
  }

  /** The complement of the roll-up: walk down from a mapped account and collect
   * the first mapped node on each branch. Those are the ledgers this account
   * would have carried had they not been mapped themselves. */
  const divertedUnder = (accountId: string, lineSign?: string): FsRolledAccount[] => {
    const out: FsRolledAccount[] = [];
    const walk = (id: string, depth: number) => {
      if (depth > 12) return;
      for (const child of childrenOf.get(id) ?? []) {
        if (directlyMappedIds.has(child)) out.push(rolled(child, depth + 1, lineSign));
        else walk(child, depth + 1);
      }
    };
    walk(accountId, 0);
    return out;
  };

  const mapped: FsMappedAccount[] = (mappedQuery.data ?? []).map((r) => {
    const accountType = r.accounts?.account_type ?? "";
    const lineSign = r.fs_lines?.sign;
    const b = balances.get(r.account_id);
    const own = displayValue(b, accountType, lineSign);
    const descendants = (descendantsByOwner.get(`${r.line_id}:${r.account_id}`) ?? [])
      .map((d) => rolled(d.account_id, d.depth, lineSign))
      .sort((x, y) => x.account_code.localeCompare(y.account_code, undefined, { numeric: true }));
    return {
      line_id: r.line_id,
      fs_line_account_id: r.id,
      account_id: r.account_id,
      account_code: r.accounts?.account_code ?? "",
      account_name: r.accounts?.account_name ?? "",
      account_type: accountType,
      period_debit: b?.period_debit ?? 0,
      period_credit: b?.period_credit ?? 0,
      balance: own,
      rollup_balance: own + descendants.reduce((s, d) => s + d.balance, 0),
      descendants,
      diverted: divertedUnder(r.account_id, lineSign),
    };
  });

  const toRow = (b: FsAccountBalance): FsUnmappedAccount => ({
    account_id: b.account_id,
    account_code: b.account_code,
    account_name: b.account_name,
    account_type: b.account_type,
    period_debit: b.period_debit,
    period_credit: b.period_credit,
    balance: displayValue(b, b.account_type),
  });

  // Covered, not merely mapped: a ledger rolled up under a mapped parent is on
  // the statement and must not be offered for mapping again — doing so would
  // pull it out of its parent's roll-up without anyone intending it.
  const available = Array.from(balances.values()).filter((b) => !coveredAccountIds.has(b.account_id));

  const unmapped: FsUnmappedAccount[] = available
    .filter((b) => isFsPnlAccountType(b.account_type))
    .map(toRow)
    .filter((a) => Math.abs(a.balance) > 0.005)
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));

  // Every remaining ledger, balance or not — an account with nothing on it is
  // exactly the one an accountant needs to find here.
  const others: FsUnmappedAccount[] = available
    .filter((b) => !isFsPnlAccountType(b.account_type))
    .map(toRow)
    .sort((a, b) => a.account_code.localeCompare(b.account_code, undefined, { numeric: true }));

  return { statementId, mapped, unmapped, others, isLoading, error };
}


async function logMappingChange(tenantId: string, userId: string | undefined, detail: Record<string, unknown>) {
  await supabase.from("audit_logs").insert({
    action: "Statement Mapping Changed",
    table_name: "fs_line_accounts",
    record_id: null,
    user_id: userId,
    tenant_id: tenantId,
    details: detail,
  });
}

export function useMapAccountToLine() {
  const { appUser } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ lineId, accountId, lineLabel, accountName }: { lineId: string; accountId: string; lineLabel: string; accountName: string }) => {
      if (!appUser?.tenant_id) throw new Error("No tenant");
      const { error } = await supabase
        .from("fs_line_accounts")
        .insert({ tenant_id: appUser.tenant_id, line_id: lineId, account_id: accountId });
      if (error) throw error;
      await logMappingChange(appUser.tenant_id, appUser.id, { direction: "map", account: accountName, line: lineLabel });
    },
    onSuccess: () => {
      invalidateStatement(queryClient);
      toast.success("Account mapped");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUnmapAccount() {
  const { appUser } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ fsLineAccountId, lineLabel, accountName }: { fsLineAccountId: string; lineLabel: string; accountName: string }) => {
      if (!appUser?.tenant_id) throw new Error("No tenant");
      const { error } = await supabase.from("fs_line_accounts").delete().eq("id", fsLineAccountId);
      if (error) throw error;
      await logMappingChange(appUser.tenant_id, appUser.id, { direction: "unmap", account: accountName, line: lineLabel });
    },
    onSuccess: () => {
      invalidateStatement(queryClient);
      toast.success("Account unmapped");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useMoveAccountToLine() {
  const { appUser } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ fsLineAccountId, toLineId, fromLabel, toLabel, accountName }: {
      fsLineAccountId: string; toLineId: string; fromLabel: string; toLabel: string; accountName: string;
    }) => {
      if (!appUser?.tenant_id) throw new Error("No tenant");
      const { error } = await supabase.from("fs_line_accounts").update({ line_id: toLineId }).eq("id", fsLineAccountId);
      if (error) throw error;
      await logMappingChange(appUser.tenant_id, appUser.id, { direction: "move", account: accountName, from: fromLabel, to: toLabel });
    },
    onSuccess: () => {
      invalidateStatement(queryClient);
      toast.success("Account moved");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export interface FsLineDetail {
  id: string;
  statement_id: string;
  line_code: string;
  label: string;
  note_ref: string | null;
  line_type: string;
  sign: string;
  emphasis: string;
  show_margin: boolean;
  is_margin_base: boolean;
  param_key: string | null;
  value_basis: "period" | "cumulative";
  sort_order: number;
}

export function useFsLineDetails(statementId: string | undefined) {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["fs_line_details", appUser?.tenant_id, statementId],
    enabled: Boolean(statementId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fs_lines")
        .select("id, statement_id, line_code, label, note_ref, line_type, sign, emphasis, show_margin, is_margin_base, param_key, value_basis, sort_order")
        .eq("statement_id", statementId!)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as FsLineDetail[];
    },
    staleTime: 60_000,
  });
}

export function useUpdateFsLine() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ lineId, patch }: { lineId: string; patch: Partial<Pick<FsLineDetail, "label" | "note_ref" | "emphasis" | "show_margin" | "is_margin_base" | "sort_order" | "value_basis">> }) => {
      const { error } = await supabase.from("fs_lines").update(patch).eq("id", lineId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fs_line_details"] });
      invalidateStatement(queryClient);
      toast.success("Line updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Moves a line one slot, server-side and atomically. The browser used to swap
 * two sort_order values with two independent mutations; a half-applied pair left
 * duplicates behind and ORDER BY sort_order is then arbitrary — which is how a
 * statement ended up printing GROSS PROFIT above Revenue. */
export function useMoveFsLine() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ lineId, direction }: { lineId: string; direction: "up" | "down" }) => {
      const { error } = await supabase.rpc("rpc_fs_move_line", { p_line_id: lineId, p_direction: direction });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fs_line_details"] });
      invalidateStatement(queryClient);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useFsLineTerms(lineId: string | undefined) {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["fs_line_terms", appUser?.tenant_id, lineId],
    enabled: Boolean(lineId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fs_line_terms")
        .select("id, line_id, term_line_id, factor, sort_order, fs_lines!fs_line_terms_term_line_id_fkey(label, line_code)")
        .eq("line_id", lineId!)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as any[];
    },
    staleTime: 60_000,
  });
}

export function useSetFsLineTerms() {
  const { appUser } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ lineId, terms }: { lineId: string; terms: { termLineId: string; factor: 1 | -1 }[] }) => {
      if (!appUser?.tenant_id) throw new Error("No tenant");
      const { error: delErr } = await supabase.from("fs_line_terms").delete().eq("line_id", lineId);
      if (delErr) throw delErr;
      if (terms.length > 0) {
        const { error } = await supabase.from("fs_line_terms").insert(
          terms.map((t, i) => ({
            tenant_id: appUser.tenant_id,
            line_id: lineId,
            term_line_id: t.termLineId,
            factor: t.factor,
            sort_order: i,
          }))
        );
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fs_line_terms"] });
      invalidateStatement(queryClient);
      toast.success("Formula updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export interface FsParameter {
  id: string;
  fiscal_period_id: string | null;
  key: string;
  value: number;
  note: string | null;
}

export function useFsParameters(fiscalPeriodId: string | null) {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["fs_parameters", appUser?.tenant_id, fiscalPeriodId],
    enabled: Boolean(appUser?.tenant_id),
    queryFn: async () => {
      let query = supabase.from("fs_parameters").select("id, fiscal_period_id, key, value, note").eq("tenant_id", appUser!.tenant_id!);
      query = fiscalPeriodId ? query.eq("fiscal_period_id", fiscalPeriodId) : query.is("fiscal_period_id", null);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as FsParameter[];
    },
    staleTime: 60_000,
  });
}

export function useSetFsParameter() {
  const { appUser } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ fiscalPeriodId, key, value, note }: { fiscalPeriodId: string | null; key: string; value: number; note?: string }) => {
      if (!appUser?.tenant_id) throw new Error("No tenant");
      const { error } = await supabase
        .from("fs_parameters")
        .upsert(
          { tenant_id: appUser.tenant_id, fiscal_period_id: fiscalPeriodId, key, value, note: note ?? null },
          { onConflict: "tenant_id,fiscal_period_id,key" }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fs_parameters"] });
      invalidateStatement(queryClient);
      toast.success("Parameter saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
