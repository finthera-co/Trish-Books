import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { invokeEdgeFunction } from "@/lib/edgeFunction";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { sortAccounts } from "@/lib/accountSort";

// Maps the Postgres error codes raised by the deep-hierarchy COA constraints
// (next_account_code, fn_set_account_level_path, fn_prevent_posting_non_postable,
// fn_enforce_account_type_consistency — see 20260821000001_coa_deep_hierarchy.sql)
// to messages a user can act on, instead of surfacing the raw "P000x: LABEL: ..." text.
const ACCOUNT_ERROR_MESSAGES: Record<string, string> = {
  P0002: "Maximum account depth (5 levels) reached. Choose a higher-level parent.",
  P0003: "That account is a summary account. Post to one of its sub-accounts instead.",
  P0004: "A sub-account must have the same account type as its parent.",
  P0010: "Could not identify your organisation. Please sign out and back in.",
  P0011: "No account number range is configured for that account type.",
  P0012: "No account numbers remain in that range. Use a different parent or code.",
  P0013: "The selected parent account is not available.",
  "23505": "That account code is already in use. Choose a different code.",
};

export function friendlyAccountError(e: unknown): string {
  const err = e as { code?: string; message?: string };
  return (
    (err?.code && ACCOUNT_ERROR_MESSAGES[err.code]) ||
    err?.message?.replace(/^[A-Z_]+:\s*/, "") ||
    "Could not save the account."
  );
}

/** Server-generated account code — the client must never compute this itself. */
export function useNextAccountCode(accountType: string, parentId: string | null, accountSubtype: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["next_account_code", accountType, parentId, accountSubtype],
    enabled: enabled && !!accountType,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("next_account_code", {
        p_account_type: accountType,
        p_parent_id: parentId,
        p_account_subtype: accountSubtype,
      });
      if (error) throw error;
      return data as string;
    },
  });
}

// Helper: Write audit log
export async function writeAuditLog(action: string, tableName: string, recordId?: string, details?: Record<string, any>) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    
    const tenantId = await supabase.rpc("get_user_tenant_id");
    const userId = await supabase
      .from("users")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    await supabase.from("audit_logs").insert({
      action,
      table_name: tableName,
      record_id: recordId,
      user_id: userId.data?.id,
      tenant_id: tenantId.data,
      details: details || null,
    });
  } catch {
    // Silently fail - don't break the main operation
  }
}

// Tenants
export function useTenants() {
  return useQuery({
    queryKey: ["tenants"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("*, subscription_plans(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateTenant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (tenant: { company_name: string; country?: string; industry?: string; subscription_plan_id?: string }) => {
      const { data, error } = await supabase.from("tenants").insert(tenant).select().single();
      if (error) throw error;
      writeAuditLog("Tenant Created", "tenants", data.id, { company_name: tenant.company_name });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenants"] });
      toast.success("Tenant created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateTenant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; status?: string; company_name?: string; country?: string; subscription_plan_id?: string }) => {
      const { error } = await supabase.from("tenants").update(updates).eq("id", id);
      if (error) throw error;
      writeAuditLog("Tenant Updated", "tenants", id, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenants"] });
      toast.success("Tenant updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Users
export function useUsers() {
  return useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("users")
        .select("*, roles(role_name), tenants(company_name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (user: { email: string; password: string; first_name: string; last_name: string; role_id: string; tenant_id: string }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const data = await invokeEdgeFunction<{
        success?: boolean;
        error?: string;
        user?: { id?: string };
      }>("create-user", user as unknown as Record<string, unknown>);

      if (!data.success) throw new Error(data.error || "Failed to create user");

      writeAuditLog("User Created", "users", data.user?.id, { email: user.email });
      return data.user;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("User created successfully");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (user: { user_id: string; email: string; first_name: string; last_name: string; previous_email: string }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const data = await invokeEdgeFunction<{
        success?: boolean;
        error?: string;
        email_changed?: boolean;
      }>(
        "update-user",
        {
          user_id: user.user_id,
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
        },
      );

      if (!data.success) throw new Error(data.error || "Failed to update user");

      writeAuditLog("User Updated", "users", user.user_id, {
        email: user.email,
        previous_email: user.previous_email,
        email_changed: data.email_changed,
      });
      return data as unknown as { user: any; email_changed: boolean };
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["all_users_admin"] });
      toast.success(res.email_changed ? "User updated — they now log in with the new email" : "User updated successfully");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Accounts
export function useAccounts() {
  return useQuery({
    queryKey: ["accounts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts")
        .select("*, account_categories(name)")
        .order("account_code");
      if (error) throw error;
      return data;
    },
  });
}

// Active accounts only (for selectors/forms)
export function useActiveAccounts() {
  return useQuery({
    queryKey: ["accounts_active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts")
        .select("id, account_code, account_name, account_type, account_subtype, is_active")
        .eq("is_active", true)
        .order("account_code"); // DB-side fallback
      if (error) throw error;
      return sortAccounts(data ?? []); // enforce central selector order
    },
  });
}

export function useCreateAccount() {
  const queryClient = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (account: { account_name: string; account_code: string; account_type: string; account_subtype?: string; parent_account_id?: string; category_id?: string; created_from?: string; description?: string }) => {
      const { deriveAccountFlags, inheritParentFlags, buildAccountsMap, getInvalidationKeys } = await import("@/lib/accountMappingEngine");
      const flags = deriveAccountFlags(account.account_subtype);

      // If parent specified, check inheritance
      let inherited: Record<string, any> = {};
      if (account.parent_account_id) {
        const { data: allAccounts } = await supabase
          .from("accounts")
          .select("id, account_type, account_subtype, parent_account_id, is_control_account, subledger_type, requires_subledger")
          .eq("tenant_id", appUser?.tenant_id);
        if (allAccounts) {
          const acctMap = buildAccountsMap(allAccounts);
          const parent = acctMap.get(account.parent_account_id);
          if (parent) {
            inherited = inheritParentFlags(parent, acctMap);
          }
        }
      }

      const { data, error } = await supabase.from("accounts").insert({
        ...account,
        is_control_account: flags.is_control_account,
        requires_subledger: flags.requires_subledger || !!inherited.requires_subledger,
        subledger_type: flags.subledger_type !== "none" ? flags.subledger_type : (inherited.subledger_type || "none"),
        tenant_id: appUser?.tenant_id,
      }).select().single();
      if (error) throw error;
      writeAuditLog("Account Created", "accounts", data.id, { account_name: account.account_name, account_code: account.account_code });

      // Invalidate subledger-specific caches
      const stype = flags.subledger_type !== "none" ? flags.subledger_type : (inherited.subledger_type || "none");
      if (stype !== "none") {
        getInvalidationKeys(stype as any).forEach(k => queryClient.invalidateQueries({ queryKey: [k] }));
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["accounts_active"] });
      queryClient.invalidateQueries({ queryKey: ["chart_of_accounts"] });
      queryClient.invalidateQueries({ queryKey: ["trial_balance"] });
      toast.success("Account created");
    },
    onError: (e: unknown) => toast.error(friendlyAccountError(e)),
  });
}

export function useUpdateAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; account_name?: string; account_code?: string; account_type?: string; account_subtype?: string | null; parent_account_id?: string | null; category_id?: string | null; is_active?: boolean; description?: string | null }) => {
      // Auto-derive subledger fields if subtype is being updated
      if ('account_subtype' in updates) {
        const { deriveAccountFlags } = await import("@/lib/accountMappingEngine");
        const flags = deriveAccountFlags(updates.account_subtype);
        Object.assign(updates, {
          is_control_account: flags.is_control_account,
          requires_subledger: flags.requires_subledger,
          subledger_type: flags.subledger_type,
        });
      }
      const { error } = await supabase.from("accounts").update(updates).eq("id", id);
      if (error) throw error;
      writeAuditLog("Account Updated", "accounts", id, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["accounts_active"] });
      queryClient.invalidateQueries({ queryKey: ["chart_of_accounts"] });
      queryClient.invalidateQueries({ queryKey: ["trial_balance"] });
      queryClient.invalidateQueries({ queryKey: ["balance_sheet"] });
      toast.success("Account updated");
    },
    onError: (e: unknown) => toast.error(friendlyAccountError(e)),
  });
}

// Journal Entries
//
// WARNING: this loads the ENTIRE journal_entries table (with lines) into memory.
// At ~35k entries that is 35 sequential round trips and tens of MB of JSON, and
// queryClient's staleTime:0 / refetchOnMount:true means it re-runs on every
// navigation. Only the aggregate reporting pages (Ledger, Reports, AccountReport,
// GeneralLedgerReport, dashboard) still use it, and they need date-bounding or a
// server-side aggregate RPC. For listing entries use useJournalEntriesPage().
// `enabled` exists because this fetch is genuinely expensive: on a 35k-entry
// tenant it is 35 sequential round trips, and PostgREST's deep .range() offset
// makes the server rebuild the nested journal_lines for EVERY entry on every
// page. Callers that only need one report out of many must not pay for it until
// that report is actually open.
export function useJournalEntries(enabled = true) {
  return useQuery({
    queryKey: ["journal_entries"],
    enabled,
    queryFn: async () => {
      // PostgREST caps every response at 1000 rows. A tenant easily has more
      // (a single bank-statement import posts thousands of entries), so a plain
      // select silently returns only the most recent 1000 — dropping older
      // transactions from every ledger. Page through with .range() so EVERY
      // entry loads, not just the latest 1000.
      const PAGE = 1000;
      const all: any[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("journal_entries")
          .select("*, journal_lines(*, accounts(account_name, account_code))")
          .order("entry_date", { ascending: false })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        all.push(...(data ?? []));
        if (!data || data.length < PAGE) break;
      }
      return all;
    },
  });
}

// Account-scoped ledger reads for Ledger.tsx and AccountReport.tsx.
//
// Both pages render exactly one account's register. Loading the whole
// journal_entries table via useJournalEntries() and filtering to one account
// in JS meant re-downloading the entire tenant ledger to show a fraction of
// it. These hooks use account_ledger_lines/account_opening_balance/
// account_earliest_entry_date (supabase/migrations/20260730000003_account_ledger_rpc.sql),
// which read only the lines that touch the requested account via
// idx_jl_account_entry.
export interface AccountLedgerContraLine {
  account_id: string;
  account_code: string | null;
  account_name: string | null;
  debit: number;
  credit: number;
}

export interface AccountLedgerLine {
  entry_id: string;
  entry_date: string;
  created_at: string;
  description: string | null;
  reference: string | null;
  status: string;
  entry_type: string | null;
  source_type: string | null;
  is_system_generated: boolean | null;
  reversal_of: string | null;
  voided_at: string | null;
  void_reason: string | null;
  line_id: string;
  debit: number;
  credit: number;
  cheque: string | null;
  payee: string | null;
  contra_lines: AccountLedgerContraLine[];
}

export function useAccountLedgerLines(accountId?: string, dateFrom?: string, dateTo?: string) {
  return useQuery({
    queryKey: ["journal_entries", "account_ledger", accountId, dateFrom || null, dateTo || null],
    enabled: !!accountId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("account_ledger_lines", {
        p_account_id: accountId!,
        p_date_from: dateFrom || null,
        p_date_to: dateTo || null,
      });
      if (error) throw error;
      return (data ?? []) as unknown as AccountLedgerLine[];
    },
  });
}

/**
 * Movements strictly BEFORE `dateFrom`, i.e. the balance carried into the
 * window. Omitting `dateFrom` means the window is unbounded — nothing precedes
 * it, so the query stays disabled and the caller reads an opening balance of
 * zero. Never substitute today's date for a missing one: that asks for the
 * account's entire history as its own opening balance, and any view that also
 * lists those transactions will count them twice.
 */
export function useAccountOpeningBalance(accountId: string | undefined, dateFrom?: string) {
  return useQuery({
    queryKey: ["journal_entries", "account_opening_balance", accountId, dateFrom ?? null],
    enabled: !!accountId && !!dateFrom,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("account_opening_balance", {
        p_account_id: accountId!,
        p_date_from: dateFrom!,
      });
      if (error) throw error;
      const row = (data as any)?.[0];
      return { debit: Number(row?.debit ?? 0), credit: Number(row?.credit ?? 0) };
    },
  });
}

export function useAccountEarliestEntryDate(accountId?: string) {
  return useQuery({
    queryKey: ["journal_entries", "account_earliest_date", accountId],
    enabled: !!accountId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("account_earliest_entry_date", {
        p_account_id: accountId!,
      });
      if (error) throw error;
      return data as string | null;
    },
  });
}

// Server-side paging for the account register.
//
// useAccountLedgerLines() above returns an account's ENTIRE window in one call.
// For 1110 Sampath Bank (32,916 posted lines) that is a 20MB payload, and it
// was silently truncated to PostgREST's max_rows, so the register showed 1000
// of 32,916 transactions. These hooks fetch one page at a time via
// account_ledger_page (supabase/migrations/20260807000000_account_ledger_paging.sql):
// search, filters, sort, the running balance and the totals are all resolved
// server-side, so the client only ever holds the rows it renders.
//
// cum_debit/cum_credit are cumulative over the whole date window in ledger
// order, so the caller derives a row's running balance as opening + cumulative
// — correct on any page, under any sort, with any search active.
export interface AccountLedgerPageRow extends AccountLedgerLine {
  txn_type: string;
  cum_debit: number;
  cum_credit: number;
  /**
   * The line's own narration (journal_lines.memo), null when it has none —
   * every system-generated line, and every manual line posted before the entry
   * forms started collecting one per line. Read it through `resolveLineMemo`,
   * which falls back to `description`. Only account_ledger_page returns this,
   * which is why it lives here rather than on AccountLedgerLine.
   */
  line_memo: string | null;
}

export interface AccountLedgerPageResult {
  rows: AccountLedgerPageRow[];
  /** Rows matching the current search/filters across ALL pages. */
  filteredRows: number;
  filteredDebit: number;
  filteredCredit: number;
}

export interface AccountLedgerPageParams {
  accountId?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  entryType?: string;
  txnType?: string;
  sort?: "date" | "amount" | "reference";
  sortDir?: "asc" | "desc";
  page: number;
  pageSize: number;
}

export function useAccountLedgerPage(params: AccountLedgerPageParams) {
  const {
    accountId, dateFrom, dateTo, search, entryType, txnType,
    sort = "date", sortDir = "asc", page, pageSize,
  } = params;

  return useQuery({
    queryKey: [
      "journal_entries", "account_ledger_page", accountId, dateFrom || null, dateTo || null,
      search || null, entryType || null, txnType || null, sort, sortDir, page, pageSize,
    ],
    enabled: !!accountId,
    // Keep the previous page on screen while the next one loads instead of
    // flashing an empty table on every page click.
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<AccountLedgerPageResult> => {
      const { data, error } = await supabase.rpc("account_ledger_page", {
        p_account_id: accountId!,
        p_date_from: dateFrom || null,
        p_date_to: dateTo || null,
        p_search: search && search.trim() !== "" ? search.trim() : null,
        p_entry_type: entryType && entryType !== "all" ? entryType : null,
        p_txn_type: txnType && txnType !== "all" ? txnType : null,
        p_sort: sort,
        p_sort_dir: sortDir,
        p_limit: pageSize,
        p_offset: page * pageSize,
      });
      if (error) throw error;
      const rows = (data ?? []) as unknown as (AccountLedgerPageRow & {
        filtered_rows: number; filtered_debit: number; filtered_credit: number;
      })[];
      // The three filtered_* columns repeat on every row of the page. An empty
      // page means nothing matched (or the offset ran past the end) — either
      // way there is nothing to total.
      const first = rows[0];
      return {
        rows,
        filteredRows: Number(first?.filtered_rows ?? 0),
        filteredDebit: Number(first?.filtered_debit ?? 0),
        filteredCredit: Number(first?.filtered_credit ?? 0),
      };
    },
  });
}

/**
 * Every row matching the current filters, for CSV/Excel export.
 *
 * The register itself never holds more than a page, but an export is expected
 * to contain the whole thing — so this walks account_ledger_page in chunks
 * rather than asking for 32,916 rows in one response. Only ever called from an
 * explicit export click, never on render.
 */
export async function fetchAccountLedgerAll(
  params: Omit<AccountLedgerPageParams, "page" | "pageSize">,
  chunkSize = 5000,
): Promise<AccountLedgerPageRow[]> {
  const { accountId, dateFrom, dateTo, search, entryType, txnType, sort = "date", sortDir = "asc" } = params;
  if (!accountId) return [];

  const all: AccountLedgerPageRow[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await supabase.rpc("account_ledger_page", {
      p_account_id: accountId,
      p_date_from: dateFrom || null,
      p_date_to: dateTo || null,
      p_search: search && search.trim() !== "" ? search.trim() : null,
      p_entry_type: entryType && entryType !== "all" ? entryType : null,
      p_txn_type: txnType && txnType !== "all" ? txnType : null,
      p_sort: sort,
      p_sort_dir: sortDir,
      p_limit: chunkSize,
      p_offset: page * chunkSize,
    });
    if (error) throw error;
    const rows = (data ?? []) as unknown as (AccountLedgerPageRow & { filtered_rows: number })[];
    all.push(...rows);
    // Stop on a short chunk, and independently on the server's own row count so
    // a full final chunk doesn't cost an extra empty round trip.
    if (rows.length < chunkSize || all.length >= Number(rows[0]?.filtered_rows ?? 0)) break;
  }
  return all;
}

/** Row count + debit/credit totals for the whole date window, ignoring search. */
export function useAccountLedgerTotals(accountId?: string, dateFrom?: string, dateTo?: string) {
  return useQuery({
    queryKey: ["journal_entries", "account_ledger_totals", accountId, dateFrom || null, dateTo || null],
    enabled: !!accountId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("account_ledger_totals", {
        p_account_id: accountId!,
        p_date_from: dateFrom || null,
        p_date_to: dateTo || null,
      });
      if (error) throw error;
      const row = (data as any)?.[0];
      return {
        lineCount: Number(row?.line_count ?? 0),
        totalDebit: Number(row?.total_debit ?? 0),
        totalCredit: Number(row?.total_credit ?? 0),
      };
    },
  });
}

/** Distinct entry types / transaction types present in the window, for the filter dropdowns. */
export function useAccountLedgerFacets(accountId?: string, dateFrom?: string, dateTo?: string) {
  return useQuery({
    queryKey: ["journal_entries", "account_ledger_facets", accountId, dateFrom || null, dateTo || null],
    enabled: !!accountId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("account_ledger_facets", {
        p_account_id: accountId!,
        p_date_from: dateFrom || null,
        p_date_to: dateTo || null,
      });
      if (error) throw error;
      const facets = (data ?? {}) as { entry_types?: string[]; txn_types?: string[] };
      return {
        entryTypes: facets.entry_types ?? [],
        txnTypes: facets.txn_types ?? [],
      };
    },
  });
}

/**
 * "deleted" is not a status any row carries — delete_journal_entry() is a hard
 * delete. It selects an entirely separate read (list_deleted_journal_entries)
 * that reconstructs removed entries from their audit_logs snapshot, so it is
 * mutually exclusive with the others rather than part of "all".
 */
export type JournalStatusFilter = "all" | "posted" | "voided" | "deleted";

/**
 * How the list is ordered. "entry_date" is the accounting view; "created_at"
 * ("Recently entered") surfaces what was actually keyed in most recently — an
 * entry backdated to March but entered today sits hundreds of pages down under
 * the default order. A sort, not a filter: the result set and the count are
 * identical either way.
 */
export type JournalOrder = "entry_date" | "created_at";
export type JournalSourceFilter =
  | "all" | "manual" | "invoice" | "payment_received"
  | "credit_note" | "depreciation" | "opening_balance" | "other";

/** Position in the ordered list: the three sort keys of a known row. */
export interface JournalCursor {
  entry_date: string;
  created_at: string;
  id: string;
}

export interface JournalPageParams {
  cursor: JournalCursor | null;
  /** Walk away from the cursor towards newer rows (Previous / Last). */
  backward?: boolean;
  pageSize: number;
  search?: string;
  status?: JournalStatusFilter;
  source?: JournalSourceFilter;
  order?: JournalOrder;
}

export interface JournalPageRow {
  id: string;
  entry_date: string;
  created_at: string;
  /** Deleted-view only: audit_logs row id, the other half of that view's cursor. */
  audit_id?: string;
  /** Deleted-view only: when the entry was removed, and by whom. */
  deleted_at?: string;
  deleted_by?: string;
  description: string;
  reference: string | null;
  status: string;
  source_type: string | null;
  entry_type: string | null;
  is_system_generated: boolean | null;
  reversal_of: string | null;
  void_reason: string | null;
  voided_at: string | null;
  total_debit: number;
  total_credit: number;
  journal_lines: Array<{
    id: string;
    account_id: string;
    debit: number;
    credit: number;
    /** The line's own narration; null means it inherits the entry description. */
    memo: string | null;
    /** Insertion order — the lines arrive sorted by it, as on the detail page. */
    seq: number | null;
    accounts: { account_code: string | null; account_name: string | null } | null;
  }>;
}

export const journalCursorOf = (row: JournalPageRow | undefined): JournalCursor | null =>
  row ? { entry_date: row.entry_date, created_at: row.created_at, id: row.id } : null;

/**
 * The deleted view is ordered by when the entry was removed, so its keyset runs
 * on (audit_logs.created_at, audit_logs.id) rather than the entry's own columns.
 * Reuses the JournalCursor shape so the page keeps one nav state for both views.
 */
export const journalDeletedCursorOf = (row: JournalPageRow | undefined): JournalCursor | null =>
  row?.audit_id && row?.deleted_at
    ? { entry_date: row.entry_date, created_at: row.deleted_at, id: row.audit_id }
    : null;

/**
 * One page of journal entries via keyset (cursor) pagination.
 *
 * Not OFFSET. OFFSET is O(depth) no matter how the table is indexed — the server
 * still walks and discards every row before the window — so deep pages of a 35k-row
 * ledger cost 250ms+ and get worse with every import. The cursor is a row-value
 * comparison the planner turns into an index condition, so every page costs the
 * same ~10ms. See supabase/migrations/20260729000005_journal_dynamic_predicates.sql
 * for the measurements.
 *
 * Filtering happens inside the RPC, where the search term is interpolated through
 * format(%L) — so no escaping is needed (or wanted) on this side.
 */
export function useJournalEntriesPage(params: JournalPageParams) {
  const { cursor, backward = false, pageSize, search = "", status = "all", source = "all", order = "entry_date" } = params;
  return useQuery({
    // Keyed under "journal_entries" so the invalidateQueries(["journal_entries"])
    // calls scattered across the app refresh this by prefix match too.
    queryKey: ["journal_entries", "page", { cursor, backward, pageSize, search, status, source, order }],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_journal_entries", {
        p_limit: pageSize,
        p_search: search || null,
        p_status: status === "all" ? null : status,
        p_source: source === "all" ? null : source,
        p_cursor_date: cursor?.entry_date ?? null,
        p_cursor_created: cursor?.created_at ?? null,
        p_cursor_id: cursor?.id ?? null,
        p_backward: backward,
        p_order: order,
      });
      if (error) throw error;
      return (data ?? []) as unknown as JournalPageRow[];
    },
    placeholderData: keepPreviousData,
  });
}

/**
 * Total matching the current filters. Deliberately a separate query from the page:
 * counting is the expensive half, and it only changes when the filters do — so
 * turning pages must not re-run it.
 */
export function useJournalEntriesCount(
  search = "", status: JournalStatusFilter = "all", source: JournalSourceFilter = "all",
) {
  return useQuery({
    queryKey: ["journal_entries", "count", { search, status, source }],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("count_journal_entries", {
        p_search: search || null,
        p_status: status === "all" ? null : status,
        p_source: source === "all" ? null : source,
      });
      if (error) throw error;
      return Number(data ?? 0);
    },
    placeholderData: keepPreviousData,
  });
}

/**
 * One page of hard-deleted entries, rebuilt from their audit_logs snapshot.
 *
 * A separate query rather than a branch inside useJournalEntriesPage: these rows
 * come from a different table, are ordered by deletion time, and are read-only —
 * folding them into the live list would mean a UNION that no index can serve.
 */
export function useDeletedJournalEntriesPage(params: JournalPageParams) {
  const { cursor, backward = false, pageSize, search = "", source = "all" } = params;
  return useQuery({
    queryKey: ["journal_entries", "deleted", "page", { cursor, backward, pageSize, search, source }],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_deleted_journal_entries", {
        p_limit: pageSize,
        p_search: search || null,
        p_source: source === "all" ? null : source,
        // The cursor's created_at/id carry the audit row's timestamp and id here
        // — see journalDeletedCursorOf.
        p_cursor_deleted: cursor?.created_at ?? null,
        p_cursor_audit: cursor?.id ?? null,
        p_backward: backward,
      });
      if (error) throw error;
      return (data ?? []) as unknown as JournalPageRow[];
    },
    placeholderData: keepPreviousData,
  });
}

/** Total deleted entries matching the current search/source. */
export function useDeletedJournalEntriesCount(search = "", source: JournalSourceFilter = "all") {
  return useQuery({
    queryKey: ["journal_entries", "deleted", "count", { search, source }],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("count_deleted_journal_entries", {
        p_search: search || null,
        p_source: source === "all" ? null : source,
      });
      if (error) throw error;
      return Number(data ?? 0);
    },
    placeholderData: keepPreviousData,
  });
}

/** Entry counts for the stat cards — four tallies in one round trip. */
export function useJournalEntryStats() {
  return useQuery({
    queryKey: ["journal_entries", "stats"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("journal_entry_stats");
      if (error) throw error;
      const row = (data as any)?.[0];
      return {
        total: Number(row?.total ?? 0),
        posted: Number(row?.posted ?? 0),
        voided: Number(row?.voided ?? 0),
        deleted: Number(row?.deleted ?? 0),
      };
    },
    // Whole-table tallies; not worth re-counting on every navigation.
    staleTime: 60_000,
  });
}

export interface MonthlyMovement {
  month: string;          // first day of the month, ISO
  account_id: string;
  account_type: string;
  account_code: string | null;
  account_name: string | null;
  debit: number;
  credit: number;
}

/**
 * Per-month, per-account GL totals for posted, non-voided entries.
 *
 * This is the aggregate the dashboard and reporting pages actually need. They used
 * to compute it in the browser from every journal entry and line — ~35k entries and
 * ~70k lines, which is what hung the landing page after a bank import. Aggregated
 * server-side the same information is ~557 rows.
 */
export function useMonthlyAccountMovements(from?: string, to?: string) {
  return useQuery({
    queryKey: ["journal_entries", "monthly_movements", from ?? null, to ?? null],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("gl_monthly_account_movements", {
        p_from: from ?? null,
        p_to: to ?? null,
      });
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({
        ...r,
        debit: Number(r.debit),
        credit: Number(r.credit),
      })) as MonthlyMovement[];
    },
    staleTime: 60_000,
  });
}

/** Per-account debit/credit totals over a period (period movements, or cumulative). */
export function useAccountBalances(from?: string, to?: string) {
  return useQuery({
    queryKey: ["journal_entries", "account_balances", from ?? null, to ?? null],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("gl_account_balances", {
        p_from: from ?? null,
        p_to: to ?? null,
      });
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({
        ...r,
        debit: Number(r.debit),
        credit: Number(r.credit),
      }));
    },
    staleTime: 60_000,
  });
}

/** The N most recent posted entries — for "recent activity" style panels. */
export function useRecentJournalEntries(limit = 8) {
  return useQuery({
    queryKey: ["journal_entries", "recent", limit],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_journal_entries", {
        p_limit: limit,
        p_status: "posted",
      });
      if (error) throw error;
      return (data ?? []) as unknown as JournalPageRow[];
    },
    staleTime: 30_000,
  });
}

/** Next JV-nnn reference, derived from existing JV refs only (not the whole table). */
export function useNextJvReference() {
  return useQuery({
    queryKey: ["journal_entries", "next_jv_ref"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("journal_entries")
        .select("reference")
        .ilike("reference", "JV-%")
        .order("reference", { ascending: false })
        .limit(1000);
      if (error) throw error;
      // Lexical order puts JV-9 above JV-10, so take the numeric max rather than
      // trusting the sort — the limit above only bounds how many we consider.
      let max = 0;
      (data ?? []).forEach((e: any) => {
        const m = /^JV-(\d+)$/i.exec((e.reference || "").trim());
        if (m) max = Math.max(max, parseInt(m[1], 10));
      });
      return `JV-${String(max + 1).padStart(3, "0")}`;
    },
  });
}

export function useCreateJournalEntry() {
  const queryClient = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (entry: { description: string; entry_date: string; reference?: string; lines: { account_id: string; debit: number; credit: number }[] }) => {
      const { data, error } = await supabase.from("journal_entries").insert({
        tenant_id: appUser?.tenant_id,
        description: entry.description,
        entry_date: entry.entry_date,
        reference: entry.reference,
        created_by: appUser?.id,
        status: "posted",
      }).select().single();
      if (error) throw error;

      const lines = entry.lines.map(line => ({
        journal_entry_id: data.id,
        account_id: line.account_id,
        debit: line.debit,
        credit: line.credit,
      }));
      const { error: linesError } = await supabase.from("journal_lines").insert(lines);
      if (linesError) throw linesError;

      writeAuditLog("Journal Entry Posted", "journal_entries", data.id, { description: entry.description, reference: entry.reference });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journal_entries"] });
      queryClient.invalidateQueries({ queryKey: ["period_account_movements"] });
      toast.success("Journal entry created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Invoices
export function useInvoices() {
  return useQuery({
    queryKey: ["invoices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("*, customers(name, phone, email), payment_received_allocations(amount, payments_received(status)), ar_credit_notes(amount, status)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data?.map((inv) => {
        // Paid = receipt allocations whose parent receipt is not voided. A single
        // receipt may cover several invoices; allocations carry the per-invoice split.
        const amountPaid = (((inv as any).payment_received_allocations as any[]) || [])
          .filter((a: any) => a.payments_received?.status !== "voided")
          .reduce((sum: number, a: any) => sum + Number(a.amount), 0);
        // Discounts/credits applied to this invoice reduce what's still owed
        const creditTotal = ((inv.ar_credit_notes as any[]) || [])
          .filter((c: any) => c.status !== "voided")
          .reduce((sum: number, c: any) => sum + Number(c.amount), 0);
        return {
          ...inv,
          amount_paid: amountPaid,
          credit_total: creditTotal,
          balance_due: Number(inv.total_amount) - amountPaid - creditTotal,
        };
      });
    },
  });
}

// Per-invoice payment history via allocations (one receipt can span invoices;
// `amount` here is the slice applied to THIS invoice).
export function usePaymentsReceived(invoiceId?: string) {
  return useQuery({
    queryKey: ["payments_received", invoiceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_received_allocations" as any)
        .select("amount, payments_received(*)")
        .eq("invoice_id", invoiceId!);
      if (error) throw error;
      return (data || [])
        .filter((row: any) => row.payments_received)
        .map((row: any) => ({
          ...row.payments_received,
          amount: Number(row.amount),
          receipt_total: Number(row.payments_received.amount),
        }))
        .sort((a: any, b: any) => String(b.payment_date).localeCompare(String(a.payment_date)));
    },
    enabled: !!invoiceId,
  });
}

// NOTE: the old useRecordPayment (raw payments_received insert with no GL) was
// removed — receipts are posted server-side via useReceiveCustomerPayment
// (post-payment-received edge function), which books the journal, allocations
// and AR sub-ledgers together.

export function useCreateInvoice() {
  const queryClient = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (invoice: { customer_id: string; invoice_number: string; issue_date: string; due_date: string; total_amount: number }) => {
      const { data, error } = await supabase.from("invoices").insert({
        ...invoice,
        tenant_id: appUser?.tenant_id,
      }).select().single();
      if (error) throw error;
      writeAuditLog("Invoice Created", "invoices", data.id, { invoice_number: invoice.invoice_number, total_amount: invoice.total_amount });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast.success("Invoice created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; status?: string }) => {
      const { error } = await supabase.from("invoices").update(updates).eq("id", id);
      if (error) throw error;
      writeAuditLog("Invoice Updated", "invoices", id, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast.success("Invoice updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Approval decisions live in useApprovals.ts (useDecideInvoice) — the chain,
// its per-level routing and the resubmit/comment actions all belong together.

// Delete a DRAFT invoice (and its line items). Guards against removing a
// posted invoice — those carry GL/subledger rows and must be voided instead.
export function useDeleteInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, invoice_number }: { id: string; invoice_number?: string }) => {
      const { data: inv, error: fetchErr } = await supabase
        .from("invoices")
        .select("status, journal_entry_id, invoice_number")
        .eq("id", id)
        .single();
      if (fetchErr) throw fetchErr;
      if (inv.status !== "draft" || inv.journal_entry_id) {
        throw new Error("Only unposted draft invoices can be deleted. Void a posted invoice instead.");
      }
      const { error: itemErr } = await supabase.from("invoice_items").delete().eq("invoice_id", id);
      if (itemErr) throw itemErr;
      // Conditional delete: refuse to remove the header if it slipped out of draft.
      const { error: delErr } = await supabase.from("invoices").delete().eq("id", id).eq("status", "draft");
      if (delErr) throw delErr;
      // IRD serial accounting: mark the reserved number cancelled (not a gap).
      const serial = invoice_number || (inv as any).invoice_number;
      if (serial) {
        await supabase.rpc("cancel_invoice_serial" as any, { p_serial: serial, p_reason: "Draft invoice deleted" });
      }
      writeAuditLog("Invoice Deleted", "invoices", id, { invoice_number: serial });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast.success("Draft invoice deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Customers
export function useCustomers() {
  return useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateCustomer() {
  const queryClient = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (customer: { name: string; email?: string; phone?: string; address?: string }) => {
      const { data, error } = await supabase.from("customers").insert({
        ...customer,
        tenant_id: appUser?.tenant_id,
      }).select().single();
      if (error) throw error;
      writeAuditLog("Customer Created", "customers", data.id, { name: customer.name });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      toast.success("Customer created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Expenses
export function useExpenses() {
  return useQuery({
    queryKey: ["expenses"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expenses")
        .select("*, expense_categories(name), employees(first_name, last_name)")
        .order("expense_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateExpense() {
  const queryClient = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (expense: { amount: number; description?: string; category_id?: string; expense_date: string; payment_account_id?: string }) => {
      const { data, error } = await supabase.from("expenses").insert({
        ...expense,
        tenant_id: appUser?.tenant_id,
      }).select().single();
      if (error) throw error;
      writeAuditLog("Expense Submitted", "expenses", data.id, { amount: expense.amount, description: expense.description });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      toast.success("Expense submitted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Approve an expense: posts a balanced journal entry (Dr category GL / Cr
// paid-through account) via the approve_expense RPC, mirroring the Payment
// Voucher / Petty Cash posting flow. Use useUpdateExpense for rejection only.
export function useApproveExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("approve_expense", { p_expense_id: id });
      if (error) throw error;
      writeAuditLog("Expense Approved", "expenses", id, { journal_entry_id: data });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["journal_entries"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard_journals"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard_expenses"] });
      toast.success("Expense approved and posted to the ledger");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; status?: string }) => {
      const { error } = await supabase.from("expenses").update(updates).eq("id", id);
      if (error) throw error;
      writeAuditLog(`Expense ${updates.status === 'approved' ? 'Approved' : 'Rejected'}`, "expenses", id, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      toast.success("Expense updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Expense Categories
export function useExpenseCategories() {
  return useQuery({
    queryKey: ["expense_categories"],
    queryFn: async () => {
      const { data, error } = await supabase.from("expense_categories").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateExpenseCategory() {
  const queryClient = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (category: { name: string; account_id?: string }) => {
      const { data, error } = await supabase.from("expense_categories").insert({
        ...category,
        tenant_id: appUser?.tenant_id,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expense_categories"] });
      toast.success("Category created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateExpenseCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; name?: string; account_id?: string | null }) => {
      const { data, error } = await supabase.from("expense_categories").update(updates).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expense_categories"] });
      toast.success("Category updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Petty Cash hooks moved to src/hooks/usePettyCash.ts

// Budgets
export function useBudgets() {
  return useQuery({
    queryKey: ["budgets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("budgets")
        .select("*, budget_items(*, accounts(account_name), budget_variances(actual_amount, variance))")
        .order("period_start", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateBudget() {
  const queryClient = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (budget: { department: string; period_start: string; period_end: string; total_budget: number }) => {
      const { data, error } = await supabase.from("budgets").insert({
        ...budget,
        tenant_id: appUser?.tenant_id,
      }).select().single();
      if (error) throw error;
      writeAuditLog("Budget Created", "budgets", data.id, { department: budget.department, total_budget: budget.total_budget });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
      toast.success("Budget created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useCreateBudgetItem() {
  const queryClient = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (item: { budget_id: string; account_id: string; allocated_amount: number }) => {
      const { data, error } = await supabase
        .from("budget_items")
        .insert([{ ...item, tenant_id: appUser!.tenant_id }])
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
      toast.success("Budget item added");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Audit Logs
export function useAuditLogs() {
  return useQuery({
    queryKey: ["audit_logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("*, users(first_name, last_name)")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });
}

export interface AccountAuditLogRow {
  id: string;
  action: string;
  details: Record<string, any> | null;
  created_at: string;
  users: { first_name: string | null; last_name: string | null } | null;
}

/** Change history for one account's own record (not transactions posted to it — see useAccountLedgerPage for that). */
export function useAccountAuditHistory(accountId: string | undefined, limit = 50) {
  return useQuery({
    queryKey: ["audit_logs", "account", accountId, limit],
    enabled: !!accountId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("id, action, details, created_at, users(first_name, last_name)")
        .eq("table_name", "accounts")
        .eq("record_id", accountId!)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as unknown as AccountAuditLogRow[];
    },
  });
}

/** Change history for one check (payment_vouchers record) — created/voided events. */
export function useCheckAuditHistory(voucherId: string | undefined, limit = 50) {
  return useQuery({
    queryKey: ["audit_logs", "payment_voucher", voucherId, limit],
    enabled: !!voucherId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("id, action, details, created_at, users(first_name, last_name)")
        .eq("table_name", "payment_vouchers")
        .eq("record_id", voucherId!)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as unknown as AccountAuditLogRow[];
    },
  });
}

// Subscription Plans
export function useSubscriptionPlans() {
  return useQuery({
    queryKey: ["subscription_plans"],
    queryFn: async () => {
      const { data, error } = await supabase.from("subscription_plans").select("*");
      if (error) throw error;
      return data;
    },
  });
}

// Roles
export function useRoles() {
  return useQuery({
    queryKey: ["roles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("roles").select("*");
      if (error) throw error;
      return data;
    },
  });
}

// Employees
export function useEmployees() {
  return useQuery({
    queryKey: ["employees"],
    queryFn: async () => {
      const { data, error } = await supabase.from("employees").select("*").order("first_name");
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateEmployee() {
  const queryClient = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (employee: {
      first_name: string; last_name: string;
      email?: string; personal_phone?: string;
      nic_number?: string; tin_number?: string;
      date_of_birth?: string; gender?: string; civil_status?: string;
      address_line1?: string; address_line2?: string; city?: string; district?: string; postal_code?: string;
      designation?: string; department?: string; hire_date?: string;
      employment_type?: string; pay_rate_type?: string; status?: string;
      manager_id?: string; biometric_id?: string;
      epf_number?: string; is_epf_applicable?: boolean; is_etf_applicable?: boolean; is_paye_applicable?: boolean;
      bank_name?: string; bank_branch?: string; bank_account_no?: string; bank_account_name?: string;
    }) => {
      const { data, error } = await supabase.from("employees").insert({
        ...employee,
        tenant_id: appUser?.tenant_id,
      }).select().single();
      if (error) throw error;
      writeAuditLog("Employee Created", "employees", data.id, { name: `${employee.first_name} ${employee.last_name}` });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      toast.success("Employee added");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/**
 * Creates an employee together with a self-service login account (role 'Employee')
 * in one atomic server call. Used when the admin supplies an email + temp password.
 */
export function useProvisionEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Record<string, any>) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      const data = await invokeEdgeFunction<{
        success?: boolean;
        error?: string;
        employee?: { id?: string };
      }>("provision-employee", payload as unknown as Record<string, unknown>);
      if (!data?.success) throw new Error(data?.error || "Failed to provision employee");
      writeAuditLog("Employee Provisioned", "employees", data.employee?.id, { email: payload.email });
      return data.employee;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      toast.success("Employee added with login access");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: {
      id: string;
      first_name?: string; last_name?: string;
      email?: string; personal_phone?: string;
      nic_number?: string; tin_number?: string;
      date_of_birth?: string; gender?: string; civil_status?: string;
      address_line1?: string; address_line2?: string; city?: string; district?: string; postal_code?: string;
      designation?: string; department?: string; hire_date?: string;
      employment_type?: string; pay_rate_type?: string; status?: string;
      manager_id?: string; biometric_id?: string;
      epf_number?: string; is_epf_applicable?: boolean; is_etf_applicable?: boolean; is_paye_applicable?: boolean;
      bank_name?: string; bank_branch?: string; bank_account_no?: string; bank_account_name?: string;
    }) => {
      const { error } = await supabase.from("employees").update(updates).eq("id", id);
      if (error) throw error;
      writeAuditLog("Employee Updated", "employees", id, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      toast.success("Employee updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name?: string }) => {
      // Block deletion when payroll history exists — those records reference this employee.
      const { count, error: countError } = await supabase
        .from("payroll_records")
        .select("id", { count: "exact", head: true })
        .eq("employee_id", id);
      if (countError) throw countError;
      if (count && count > 0) {
        throw new Error("Cannot delete an employee with payroll history. Set their status to Inactive instead.");
      }

      const { error } = await supabase.from("employees").delete().eq("id", id);
      if (error) throw error;
      writeAuditLog("Employee Deleted", "employees", id, { name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      toast.success("Employee deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Products
export function useProducts() {
  return useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*, taxes(tax_name, tax_rate)")
        .order("name");
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateProduct() {
  const queryClient = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (product: { name: string; description?: string; sku?: string; price: number; tax_id?: string; default_tax_group_id?: string | null; default_tax_code_id?: string | null; income_account_id?: string; expense_account_id?: string; type?: string }) => {
      const { data, error } = await supabase.from("products").insert({
        ...product,
        tenant_id: appUser?.tenant_id,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success("Product created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useProductSalesDetail(productId: string | undefined) {
  return useQuery({
    queryKey: ["product_sales_detail", productId],
    queryFn: async () => {
      const [productRes, itemsRes] = await Promise.all([
        supabase.from("products").select("*, taxes(tax_name, tax_rate)").eq("id", productId!).single(),
        supabase
          .from("invoice_items")
          .select("*, invoices(id, invoice_number, issue_date, status, customer_id, customers(name))")
          .eq("product_id", productId!)
          .order("issue_date", { foreignTable: "invoices", ascending: false }),
      ]);
      if (productRes.error) throw productRes.error;
      if (itemsRes.error) throw itemsRes.error;

      // invoice_items has no tenant_id of its own — RLS scopes rows via the
      // parent invoice's tenant, so a null `invoices` join here just means the
      // parent invoice was filtered out (shouldn't happen, but guard anyway).
      const lines = (itemsRes.data || []).filter((l: any) => l.invoices);
      const soldLines = lines.filter((l: any) => l.invoices.status !== "draft" && l.invoices.status !== "voided");

      const totalQty = soldLines.reduce((s: number, l: any) => s + Number(l.quantity), 0);
      const totalRevenue = soldLines.reduce((s: number, l: any) => s + Number(l.total), 0);
      const invoiceCount = new Set(soldLines.map((l: any) => l.invoices.id)).size;

      return {
        product: productRes.data,
        lines,
        totalQty,
        totalRevenue,
        invoiceCount,
        avgPrice: totalQty > 0 ? totalRevenue / totalQty : 0,
      };
    },
    enabled: !!productId,
  });
}

// Taxes
export function useTaxes() {
  return useQuery({
    queryKey: ["taxes"],
    queryFn: async () => {
      const { data, error } = await supabase.from("taxes").select("*").order("tax_name");
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateTax() {
  const queryClient = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (tax: { tax_name: string; tax_rate: number }) => {
      const { data, error } = await supabase.from("taxes").insert({
        ...tax,
        tenant_id: appUser?.tenant_id,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["taxes"] });
      toast.success("Tax rate created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Payroll Records
export function usePayrollRecords() {
  return useQuery({
    queryKey: ["payroll_records"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_records")
        .select("*, employees(first_name, last_name, department)")
        .order("period_start", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useCreatePayrollRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (record: { employee_id: string; period_start: string; period_end: string; gross_salary: number; deductions: number; net_salary: number; payment_date?: string }) => {
      const { data, error } = await supabase.from("payroll_records").insert(record).select().single();
      if (error) throw error;
      writeAuditLog("Payroll Record Created", "payroll_records", data.id, { employee_id: record.employee_id, net_salary: record.net_salary });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll_records"] });
      toast.success("Payroll record created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Employee compensation (dated history)
export function useEmployeeCompensation(employeeId?: string) {
  return useQuery({
    queryKey: ["employee_compensation", employeeId],
    enabled: !!employeeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_compensation")
        .select("*")
        .eq("employee_id", employeeId!)
        .order("effective_from", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useAddCompensation() {
  const queryClient = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (payload: {
      employee_id: string; effective_from: string;
      basic_salary: number; pay_rate?: number; pay_frequency?: string; notes?: string;
    }) => {
      const { data, error } = await supabase.from("employee_compensation").insert({
        ...payload,
        is_current: true,
        tenant_id: appUser?.tenant_id,
        created_by: appUser?.id,
      }).select().single();
      if (error) throw error;
      writeAuditLog("Compensation Updated", "employee_compensation", data.id,
        { employee_id: payload.employee_id, basic_salary: payload.basic_salary });
      return data;
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["employee_compensation", vars.employee_id] });
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      toast.success("Compensation updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
