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

export interface FsCoverageIssue {
  issue_code: "UNMAPPED_ACCOUNT" | "CYCLE" | "MISSING_PARAM" | "TIE_OUT_VARIANCE";
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

export interface FsMappedAccount {
  line_id: string;
  fs_line_account_id: string;
  account_id: string;
  account_code: string;
  account_name: string;
  period_debit: number;
  period_credit: number;
  balance: number;
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
 * Mapping-UI data: for the given statement + period, every account already
 * mapped (grouped per line) and every P&L account with movement that isn't
 * mapped to any line — sorted by absolute balance descending, largest
 * omissions first, per the mapping UI's spec.
 */
export function useFsMapping(statementCode: string, dateFrom: string, dateTo: string) {
  const { appUser } = useAuth();
  const tenantId = appUser?.tenant_id;

  const metaQuery = useFsStatementMeta(statementCode);
  const statementId = metaQuery.data?.id;

  const movementQuery = useQuery({
    queryKey: ["fs_mapping_movement", tenantId, dateFrom, dateTo],
    enabled: Boolean(tenantId && dateFrom && dateTo),
    queryFn: async () => {
      // PostgREST caps every response at 1000 rows. A full fiscal year easily
      // has more journal lines than that, so a plain select silently drops
      // whichever accounts' rows fall outside the first page — those accounts
      // then compute a zero balance and vanish from the unmapped list even
      // though they have real activity. Page through with .range() so EVERY
      // line is counted.
      const PAGE = 1000;
      const rows: any[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("journal_lines")
          .select("account_id, debit, credit, journal_entries!inner(tenant_id, status, voided_at, entry_date)")
          .eq("journal_entries.tenant_id", tenantId!)
          .eq("journal_entries.status", "posted")
          .is("journal_entries.voided_at", null)
          .gte("journal_entries.entry_date", dateFrom)
          .lte("journal_entries.entry_date", dateTo)
          .range(from, from + PAGE - 1);
        if (error) throw error;
        rows.push(...(data ?? []));
        if (!data || data.length < PAGE) break;
      }
      const map = new Map<string, { debit: number; credit: number }>();
      for (const row of rows) {
        const cur = map.get(row.account_id) ?? { debit: 0, credit: 0 };
        cur.debit += toNum(row.debit);
        cur.credit += toNum(row.credit);
        map.set(row.account_id, cur);
      }
      return map;
    },
    staleTime: 30_000,
  });

  const accountsQuery = useQuery({
    queryKey: ["fs_mapping_accounts", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts")
        .select("id, account_code, account_name, account_type")
        .eq("tenant_id", tenantId!)
        .in("account_type", ["Income", "Cost of Goods Sold", "Expense", "Other Income", "Other Expense"]);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60_000,
  });

  const mappedQuery = useQuery({
    queryKey: ["fs_mapping", tenantId, statementId],
    enabled: Boolean(tenantId && statementId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fs_line_accounts")
        .select("id, line_id, account_id, accounts(account_code, account_name), fs_lines!inner(statement_id)")
        .eq("fs_lines.statement_id", statementId!);
      if (error) throw error;
      return (data ?? []) as any[];
    },
    staleTime: 30_000,
  });

  const isLoading = metaQuery.isLoading || movementQuery.isLoading || accountsQuery.isLoading || mappedQuery.isLoading;
  const error = metaQuery.error || movementQuery.error || accountsQuery.error || mappedQuery.error;

  const mappedAccountIds = new Set((mappedQuery.data ?? []).map((r) => r.account_id));
  const movement = movementQuery.data ?? new Map<string, { debit: number; credit: number }>();

  const mapped: FsMappedAccount[] = (mappedQuery.data ?? []).map((r) => {
    const mv = movement.get(r.account_id) ?? { debit: 0, credit: 0 };
    return {
      line_id: r.line_id,
      fs_line_account_id: r.id,
      account_id: r.account_id,
      account_code: r.accounts?.account_code ?? "",
      account_name: r.accounts?.account_name ?? "",
      period_debit: mv.debit,
      period_credit: mv.credit,
      balance: mv.credit - mv.debit,
    };
  });

  const unmapped: FsUnmappedAccount[] = (accountsQuery.data ?? [])
    .filter((a) => !mappedAccountIds.has(a.id))
    .map((a) => {
      const mv = movement.get(a.id) ?? { debit: 0, credit: 0 };
      return {
        account_id: a.id,
        account_code: a.account_code,
        account_name: a.account_name,
        account_type: a.account_type,
        period_debit: mv.debit,
        period_credit: mv.credit,
        balance: mv.credit - mv.debit,
      };
    })
    .filter((a) => Math.abs(a.balance) > 0.005)
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));

  return { statementId, mapped, unmapped, isLoading, error };
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
        .select("id, statement_id, line_code, label, note_ref, line_type, sign, emphasis, show_margin, is_margin_base, param_key, sort_order")
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
    mutationFn: async ({ lineId, patch }: { lineId: string; patch: Partial<Pick<FsLineDetail, "label" | "note_ref" | "emphasis" | "show_margin" | "is_margin_base" | "sort_order">> }) => {
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
