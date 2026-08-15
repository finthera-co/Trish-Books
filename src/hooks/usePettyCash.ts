import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// Maps machine-readable RPC error codes (e.g. "INSUFFICIENT_FUNDS: available 100, required 250")
// to friendly toast messages.
function humanizePcError(raw: string): string {
  const msg = raw || "";
  if (msg.includes("INSUFFICIENT_FUNDS")) {
    const nums = msg.match(/available\s+([\d.-]+),\s*required\s+([\d.-]+)/i);
    const detail = nums ? ` The fund holds ${nums[1]}, this voucher needs ${nums[2]}.` : "";
    return `Insufficient petty cash funds for this voucher.${detail} Fund or replenish the account first.`;
  }
  if (msg.includes("EXCEEDS_FLOAT"))
    return "This top-up would push the fund above its defined float.";
  if (msg.includes("PERIOD_LOCKED"))
    return "The date falls in a closed fiscal period. Reopen it or change the date.";
  if (msg.includes("TOTAL_MISMATCH"))
    return "Voucher line total does not match the header total.";
  if (msg.includes("INVALID_STATE"))
    return "This document has already been posted or is not in a draft state.";
  if (msg.includes("EMPTY_VOUCHER"))
    return "The voucher has no valid line amounts.";
  return msg.replace(/^[A-Z_]+:\s*/, ""); // strip the code prefix as a fallback
}

// Friendly messages for the imprest replenishment RPC error codes.
function humanizeReplError(raw: string): string {
  const msg = raw || "";
  if (msg.includes("NO_VOUCHERS"))
    return "No approved, unreimbursed vouchers to replenish. Approve some vouchers first.";
  if (msg.includes("IMPREST_MISMATCH"))
    return "The fund won't return to its exact float — there may be an unposted cash-count variance. Reconcile first, or confirm a partial top-up.";
  if (msg.includes("VOUCHER_INELIGIBLE"))
    return "One or more selected vouchers are no longer eligible (already reimbursed or not approved).";
  if (msg.includes("PERIOD_LOCKED"))
    return "The date falls in a closed fiscal period.";
  if (msg.includes("BANK_NOT_FOUND"))
    return "Select a valid bank account to fund the replenishment.";
  return msg.replace(/^[A-Z_]+:\s*/, "");
}

// ─── Petty Cash Accounts ───
export function usePettyCashAccounts() {
  return useQuery({
    queryKey: ["pc_accounts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("petty_cash_accounts")
        .select("*, accounts:account_id(account_name, account_code)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useCreatePCAccount() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (input: { account_id: string; account_name: string; float_amount: number }) => {
      const { data, error } = await supabase
        .from("petty_cash_accounts")
        .insert({ ...input, tenant_id: appUser!.tenant_id })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pc_accounts"] });
      toast.success("Petty cash account created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Vouchers ───
export type PCVoucherScope = "live" | "reversed" | "all";

/**
 * Vouchers for the list, filtered and capped SERVER-side.
 *
 * It used to select every voucher a tenant had ever raised, unfiltered and
 * unlimited, and render the lot in one table — a withdrawn 271-row import left
 * "Recent Vouchers" showing 269 reversed rows and nothing recent at all. A
 * reversed voucher is history, not work in hand, so it is out of the default
 * view rather than deleted; the records stay for audit.
 */
export function usePCVouchers(
  pcAccountId?: string,
  opts: { scope?: PCVoucherScope; limit?: number } = {},
) {
  const { scope = "all", limit } = opts;
  return useQuery({
    queryKey: ["pc_vouchers", pcAccountId, scope, limit ?? null],
    queryFn: async () => {
      let query = supabase
        .from("petty_cash_vouchers")
        .select(
          "*, petty_cash_accounts(account_name), prepared_user:prepared_by(first_name, last_name), authorized_user:authorized_by(first_name, last_name)",
          { count: "exact" },
        )
        .order("created_at", { ascending: false });
      if (pcAccountId) query = query.eq("petty_cash_account_id", pcAccountId);
      if (scope === "live") query = query.neq("status", "reversed");
      else if (scope === "reversed") query = query.eq("status", "reversed");
      if (limit) query = query.range(0, limit - 1);

      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: data ?? [], total: count ?? 0 };
    },
  });
}

export function usePCVoucher(id?: string) {
  return useQuery({
    queryKey: ["pc_voucher", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("petty_cash_vouchers")
        .select("*, petty_cash_accounts(account_name, account_id, float_amount), prepared_user:prepared_by(first_name, last_name), authorized_user:authorized_by(first_name, last_name)")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function usePCVoucherLines(voucherId?: string) {
  return useQuery({
    queryKey: ["pc_voucher_lines", voucherId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("petty_cash_voucher_lines")
        .select("*, accounts:account_id(account_name, account_code)")
        .eq("voucher_id", voucherId!)
        .order("line_no");
      if (error) throw error;
      return data;
    },
    enabled: !!voucherId,
  });
}

export function useGenerateVoucherNumber() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["pcv_number"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("generate_pcv_number", {
        p_tenant_id: appUser!.tenant_id,
      });
      if (error) throw error;
      return data as string;
    },
    enabled: !!appUser?.tenant_id,
  });
}

export function useCreatePCVoucher() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      voucher_number: string;
      date: string;
      paid_to: string;
      petty_cash_account_id: string;
      authorized_by?: string;
      receipt_urls?: string[];
      lines: { date: string; description: string; account_id: string; amount: number }[];
    }) => {
      const total = input.lines.reduce((s, l) => s + l.amount, 0);

      const { data: user } = await supabase
        .from("users")
        .select("id")
        .eq("auth_user_id", (await supabase.auth.getUser()).data.user!.id)
        .single();

      const { data: voucher, error } = await supabase
        .from("petty_cash_vouchers")
        .insert({
          tenant_id: appUser!.tenant_id,
          voucher_number: input.voucher_number,
          date: input.date,
          paid_to: input.paid_to,
          total_amount: total,
          petty_cash_account_id: input.petty_cash_account_id,
          prepared_by: user?.id,
          authorized_by: input.authorized_by || null,
          receipt_urls: input.receipt_urls || [],
          status: "draft",
        })
        .select()
        .single();
      if (error) throw error;

      const lines = input.lines.map((l, i) => ({
        voucher_id: voucher.id,
        line_no: i + 1,
        date: l.date,
        description: l.description,
        account_id: l.account_id,
        amount: l.amount,
      }));
      const { error: lineErr } = await supabase
        .from("petty_cash_voucher_lines")
        .insert(lines);
      if (lineErr) throw lineErr;

      return voucher;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pc_vouchers"] });
      qc.invalidateQueries({ queryKey: ["pcv_number"] });
      toast.success("Voucher created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateVoucherStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      if (status === "approved") {
        const { data, error } = await supabase.rpc("post_pcv", { p_voucher_id: id });
        if (error) throw new Error(humanizePcError(error.message));
        return data;
      }
      // Non-approval status changes (e.g. cancel) stay as a plain update
      const { error } = await supabase
        .from("petty_cash_vouchers")
        .update({ status })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, { status }) => {
      qc.invalidateQueries({ queryKey: ["pc_vouchers"] });
      qc.invalidateQueries({ queryKey: ["pc_voucher"] });
      qc.invalidateQueries({ queryKey: ["pc_balance"] });
      toast.success(`Voucher ${status}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Voucher Reversal ───
export function useReverseVoucher() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (voucherId: string) => {
      // Fetch original voucher
      const { data: voucher } = await supabase
        .from("petty_cash_vouchers")
        .select("*, petty_cash_accounts(account_id)")
        .eq("id", voucherId)
        .single();
      if (!voucher) throw new Error("Voucher not found");
      if (voucher.status !== "approved") throw new Error("Only approved vouchers can be reversed");
      if (voucher.reversed_at) throw new Error("Voucher already reversed");

      // Fetch original lines
      const { data: lines } = await supabase
        .from("petty_cash_voucher_lines")
        .select("*")
        .eq("voucher_id", voucherId);
      if (!lines?.length) throw new Error("No voucher lines found");

      // Create reversing journal entry (opposite of original)
      const { data: je, error: jeErr } = await supabase
        .from("journal_entries")
        .insert({
          tenant_id: appUser!.tenant_id,
          description: `Reversal: Petty Cash Voucher ${voucher.voucher_number}`,
          entry_date: new Date().toISOString().split("T")[0],
          status: "posted",
          is_system_generated: true,
          entry_type: "petty_cash_reversal",
          reference: `REV-${voucher.voucher_number}`,
          reversal_of: voucher.journal_entry_id,
          cash_flow_category: "operating",
        })
        .select()
        .single();
      if (jeErr) throw jeErr;

      // Reverse: CR each expense, DR petty cash
      const reversalLines = [
        ...lines.map((l: any) => ({
          journal_entry_id: je.id,
          account_id: l.account_id,
          debit: 0,
          credit: Number(l.amount),
        })),
        {
          journal_entry_id: je.id,
          account_id: voucher.petty_cash_accounts?.account_id,
          debit: Number(voucher.total_amount),
          credit: 0,
        },
      ];

      const { error: jlErr } = await supabase
        .from("journal_lines")
        .insert(reversalLines);
      if (jlErr) throw jlErr;

      // Mark original voucher as reversed
      const { error } = await supabase
        .from("petty_cash_vouchers")
        .update({
          reversed_at: new Date().toISOString(),
          status: "reversed",
        })
        .eq("id", voucherId);
      if (error) throw error;

      return je;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pc_vouchers"] });
      qc.invalidateQueries({ queryKey: ["pc_voucher"] });
      qc.invalidateQueries({ queryKey: ["pc_balance"] });
      toast.success("Voucher reversed — correcting journal entry created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Receipt Upload ───
export function useUploadReceipt() {
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async ({ file, voucherId }: { file: File; voucherId?: string }) => {
      if (!appUser?.tenant_id) throw new Error("No tenant context");
      const ext = file.name.split(".").pop();
      const path = `${appUser.tenant_id}/${voucherId || "draft"}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from("petty-cash-receipts")
        .upload(path, file);
      if (error) throw error;
      return path;
    },
    onError: (e: Error) => toast.error(`Upload failed: ${e.message}`),
  });
}

export async function getReceiptSignedUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from("petty-cash-receipts")
    .createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}

export function useUpdateVoucherReceipts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ voucherId, receiptUrls }: { voucherId: string; receiptUrls: string[] }) => {
      const { error } = await supabase
        .from("petty_cash_vouchers")
        .update({ receipt_urls: receiptUrls })
        .eq("id", voucherId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pc_voucher"] });
      toast.success("Receipts updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Balance Helpers (LEDGER-DRIVEN: single source of truth) ───
// The balance lives in Postgres, not here. get_petty_cash_balance derives it as
// SUM(debit - credit) over posted journal lines on the fund's GL account, which
// is what the posting RPCs check against inside their own transaction. Doing
// the same sum a second time in the browser would eventually disagree with it —
// silently — so there is deliberately no client-side fallback.
async function getRemainingCash(pcAccountId: string): Promise<number> {
  const { data, error } = await supabase.rpc("get_petty_cash_balance", {
    p_petty_cash_account_id: pcAccountId,
  });
  if (error) throw error;
  return Number(data ?? 0);
}

export type PCBalanceSummary = {
  float_amount: number;
  total_spent: number;
  total_replenished: number;
  remaining: number;
};

export function usePCBalance(pcAccountId?: string) {
  return useQuery({
    queryKey: ["pc_balance", pcAccountId],
    queryFn: async (): Promise<PCBalanceSummary | null> => {
      if (!pcAccountId) return null;
      const { data, error } = await supabase.rpc("get_petty_cash_balance_summary", {
        p_petty_cash_account_id: pcAccountId,
      });
      if (error) throw error;
      const s = (data ?? {}) as Record<string, number>;
      return {
        float_amount: Number(s.float_amount ?? 0),
        total_spent: Number(s.total_spent ?? 0),
        total_replenished: Number(s.total_replenished ?? 0),
        remaining: Number(s.remaining ?? 0),
      };
    },
    enabled: !!pcAccountId,
  });
}

// ─── Per-PC-Account Ledger (chronological with running balance) ───
export function usePCLedger(pcAccountId?: string) {
  return useQuery({
    queryKey: ["pc_ledger", pcAccountId],
    queryFn: async () => {
      if (!pcAccountId) return [];
      const { data: account } = await supabase
        .from("petty_cash_accounts")
        .select("account_id")
        .eq("id", pcAccountId)
        .single();
      if (!account?.account_id) return [];

      const { data, error } = await supabase
        .from("journal_lines")
        .select(`
          id, debit, credit,
          journal_entries!inner(id, entry_date, description, reference, entry_type, status)
        `)
        .eq("account_id", account.account_id)
        .eq("journal_entries.status", "posted")
        .order("entry_date", { foreignTable: "journal_entries", ascending: true });
      if (error) throw error;

      let running = 0;
      return (data || []).map((l: any) => {
        const debit = Number(l.debit || 0);
        const credit = Number(l.credit || 0);
        running += debit - credit;
        return {
          id: l.id,
          date: l.journal_entries.entry_date,
          description: l.journal_entries.description,
          reference: l.journal_entries.reference,
          entry_type: l.journal_entries.entry_type,
          journal_entry_id: l.journal_entries.id,
          debit,
          credit,
          running_balance: running,
        };
      });
    },
    enabled: !!pcAccountId,
  });
}

// ─── PC → PC Transfer (Dr Target / Cr Source) ───
export function useTransferPettyCash() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      from_pc_account_id: string;
      to_pc_account_id: string;
      amount: number;
      date: string;
      memo?: string;
    }) => {
      if (input.from_pc_account_id === input.to_pc_account_id) {
        throw new Error("Source and target petty cash accounts must differ");
      }
      if (!input.amount || input.amount <= 0) {
        throw new Error("Transfer amount must be greater than zero");
      }

      // Resolve underlying COA accounts
      const { data: pcAccounts, error: pcErr } = await supabase
        .from("petty_cash_accounts")
        .select("id, account_id, account_name, float_amount")
        .in("id", [input.from_pc_account_id, input.to_pc_account_id]);
      if (pcErr) throw pcErr;

      const fromPC = pcAccounts?.find((a) => a.id === input.from_pc_account_id);
      const toPC = pcAccounts?.find((a) => a.id === input.to_pc_account_id);
      if (!fromPC?.account_id || !toPC?.account_id) {
        throw new Error("Petty cash accounts not properly linked to COA");
      }

      // Insufficient-funds guard against ledger balance
      const sourceBalance = await getRemainingCash(input.from_pc_account_id);
      if (sourceBalance < input.amount) {
        throw new Error(
          `Insufficient funds in ${fromPC.account_name}. Available: ${sourceBalance.toFixed(2)}`,
        );
      }

      // Create posted journal entry
      const { data: je, error: jeErr } = await supabase
        .from("journal_entries")
        .insert({
          tenant_id: appUser!.tenant_id,
          description: input.memo || `Petty Cash Transfer: ${fromPC.account_name} → ${toPC.account_name}`,
          entry_date: input.date,
          status: "posted",
          is_system_generated: true,
          entry_type: "petty_cash_transfer",
          reference: `PCT-${Date.now()}`,
          cash_flow_category: "internal_transfer",
        })
        .select()
        .single();
      if (jeErr) throw jeErr;

      const { error: jlErr } = await supabase.from("journal_lines").insert([
        { journal_entry_id: je.id, account_id: toPC.account_id, debit: input.amount, credit: 0 },
        { journal_entry_id: je.id, account_id: fromPC.account_id, debit: 0, credit: input.amount },
      ]);
      if (jlErr) throw jlErr;

      return je;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pc_balance"] });
      qc.invalidateQueries({ queryKey: ["pc_ledger"] });
      qc.invalidateQueries({ queryKey: ["journal_entries"] });
      qc.invalidateQueries({ queryKey: ["period_account_movements"] });
      toast.success("Petty cash transfer posted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Replenishments ───
export function usePCReplenishments(pcAccountId?: string) {
  return useQuery({
    queryKey: ["pc_replenishments", pcAccountId],
    queryFn: async () => {
      let query = supabase
        .from("petty_cash_replenishments")
        .select("*, petty_cash_accounts(account_name), bank_account:bank_account_id(account_name, account_code), reimbursed:petty_cash_vouchers!replenishment_id(count)")
        .order("created_at", { ascending: false });
      if (pcAccountId) query = query.eq("petty_cash_account_id", pcAccountId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useGenerateReplenishmentNumber() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["pcr_number"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("generate_pcr_number", {
        p_tenant_id: appUser!.tenant_id,
      });
      if (error) throw error;
      return data as string;
    },
    enabled: !!appUser?.tenant_id,
  });
}

export function useCreateReplenishment() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      replenishment_number: string;
      date: string;
      petty_cash_account_id: string;
      bank_account_id: string;
      amount: number;
    }) => {
      const { data, error } = await supabase
        .from("petty_cash_replenishments")
        .insert({ ...input, tenant_id: appUser!.tenant_id, status: "draft" })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pc_replenishments"] });
      qc.invalidateQueries({ queryKey: ["pcr_number"] });
      toast.success("Replenishment created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useApproveReplenishment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("post_pcr", { p_replenishment_id: id });
      if (error) throw new Error(humanizePcError(error.message));
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pc_replenishments"] });
      qc.invalidateQueries({ queryKey: ["pc_balance"] });
      toast.success("Replenishment approved & journal entry created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Direct Funding / Top-up (Dr Petty Cash / Cr Bank) ───
// Used to put cash into a fund that has no vouchers to reimburse yet — the
// initial float, or a straight top-up. Creates a draft replenishment and posts
// it through post_pcr, which enforces the imprest ceiling (balance + amount
// must not exceed the defined float).
export function useFundPettyCash() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      pc_account_id: string;
      bank_account_id: string;
      amount: number;
      date: string;
    }) => {
      if (!(input.amount > 0)) throw new Error("Amount must be greater than zero");

      const { data: number, error: numErr } = await supabase.rpc("generate_pcr_number", {
        p_tenant_id: appUser!.tenant_id,
      });
      if (numErr) throw numErr;

      const { data: repl, error: insErr } = await supabase
        .from("petty_cash_replenishments")
        .insert({
          tenant_id: appUser!.tenant_id,
          replenishment_number: number as string,
          date: input.date,
          petty_cash_account_id: input.pc_account_id,
          bank_account_id: input.bank_account_id,
          amount: input.amount,
          status: "draft",
        })
        .select()
        .single();
      if (insErr) throw insErr;

      const { data: jeId, error: postErr } = await supabase.rpc("post_pcr", {
        p_replenishment_id: repl.id,
      });
      if (postErr) {
        // Drop the draft so a rejected funding doesn't linger in history
        await supabase.from("petty_cash_replenishments").delete().eq("id", repl.id);
        throw new Error(humanizePcError(postErr.message));
      }

      return { ...repl, journal_entry_id: jeId as unknown as string };
    },
    onSuccess: (repl) => {
      qc.invalidateQueries({ queryKey: ["pc_replenishments"] });
      qc.invalidateQueries({ queryKey: ["pcr_number"] });
      qc.invalidateQueries({ queryKey: ["pc_balance"] });
      qc.invalidateQueries({ queryKey: ["pc_ledger"] });
      qc.invalidateQueries({ queryKey: ["journal_entries"] });
      qc.invalidateQueries({ queryKey: ["period_account_movements"] });
      toast.success(`Fund topped up — ${repl.replenishment_number} posted`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── True Imprest Replenishment ───
// Lists approved vouchers awaiting reimbursement for a fund (drives the preview)
export function useUnreimbursedVouchers(pcAccountId?: string) {
  return useQuery({
    queryKey: ["pc_unreimbursed", pcAccountId],
    queryFn: async () => {
      if (!pcAccountId) return [];
      const { data, error } = await supabase.rpc("pc_unreimbursed_vouchers", {
        p_pc_account_id: pcAccountId,
      });
      if (error) throw error;
      return data as {
        voucher_id: string;
        voucher_number: string;
        voucher_date: string;
        paid_to: string | null;
        total_amount: number;
      }[];
    },
    enabled: !!pcAccountId,
  });
}

// Builds + posts a true imprest replenishment from the unreimbursed voucher batch
export function usePostImprestReplenishment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      pc_account_id: string;
      bank_account_id: string;
      date: string;
      voucher_ids?: string[];     // omit/undefined = reimburse ALL
      allow_partial?: boolean;
    }) => {
      const { data, error } = await supabase.rpc("post_imprest_replenishment", {
        p_pc_account_id: input.pc_account_id,
        p_bank_account_id: input.bank_account_id,
        p_date: input.date,
        p_voucher_ids: input.voucher_ids ?? null,
        p_allow_partial: input.allow_partial ?? false,
      });
      if (error) throw new Error(humanizeReplError(error.message));
      return data as unknown as {
        replenishment_id: string;
        replenishment_number: string;
        journal_entry_id: string;
        voucher_count: number;
        amount: number;
        balance_before: number;
        balance_after: number;
        float: number;
      };
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["pc_replenishments"] });
      qc.invalidateQueries({ queryKey: ["pc_unreimbursed"] });
      qc.invalidateQueries({ queryKey: ["pc_balance"] });
      qc.invalidateQueries({ queryKey: ["pc_ledger"] });
      qc.invalidateQueries({ queryKey: ["pc_vouchers"] });
      toast.success(
        `Replenishment ${res.replenishment_number} posted — reimbursed ${res.voucher_count} voucher(s), fund restored to ${res.float.toFixed(2)}`
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Users list for authorized_by ───
export function useTenantUsers() {
  return useQuery({
    queryKey: ["tenant_users"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("users")
        .select("id, first_name, last_name, email")
        .order("first_name");
      if (error) throw error;
      return data;
    },
  });
}

// ─── Expense accounts for voucher lines ───
export function useExpenseAccounts() {
  return useQuery({
    queryKey: ["expense_accounts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts")
        .select("id, account_name, account_code, account_type")
        .in("account_type", ["Expense", "Other Expense", "Cost of Goods Sold"])
        .eq("is_active", true)
        .order("account_code");
      if (error) throw error;
      return data;
    },
  });
}

// ─── Cash/Bank accounts for linking ───
export function useCashAccounts() {
  return useQuery({
    queryKey: ["cash_accounts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts")
        .select("id, account_name, account_code, account_type, account_subtype, category:category_id(name)")
        .eq("account_type", "Asset")
        .eq("is_active", true)
        .order("account_code");
      if (error) throw error;
      return (data ?? []).filter((account) => {
        const categoryName = account.category?.name?.toLowerCase() ?? "";
        const subtype = account.account_subtype?.toLowerCase() ?? "";

        return categoryName === "current assets" || subtype === "bank" || subtype === "other current assets";
      });
    },
  });
}

export function useBankAccounts() {
  return useQuery({
    queryKey: ["bank_accounts_for_repl"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts")
        .select("id, account_name, account_code")
        .eq("account_type", "Asset")
        .eq("account_subtype", "Bank")
        .eq("is_active", true)
        .order("account_code");
      if (error) throw error;
      return data;
    },
  });
}

// ─── Petty Cash line account candidates ───
// Asset / Expense / Other Expense / COGS accounts, excluding any GL account
// that is registered as a petty cash fund for this tenant. Inactive accounts
// are kept but flagged so the UI can show a soft warning.
export function usePettyCashLineAccounts() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["pcv_line_accounts", appUser?.tenant_id],
    enabled: !!appUser?.tenant_id,
    queryFn: async () => {
      const [{ data: accounts, error: aErr }, { data: pcAccounts, error: pErr }] = await Promise.all([
        supabase
          .from("accounts")
          .select("id, account_name, account_code, account_type, is_active")
          .eq("tenant_id", appUser!.tenant_id)
          .in("account_type", ["Asset", "Expense", "Other Expense", "Cost of Goods Sold"])
          .order("account_code"),
        supabase
          .from("petty_cash_accounts")
          .select("account_id")
          .eq("tenant_id", appUser!.tenant_id),
      ]);
      if (aErr) throw aErr;
      if (pErr) throw pErr;
      const blocked = new Set((pcAccounts ?? []).map((p: any) => p.account_id));
      return (accounts ?? []).filter((a: any) => !blocked.has(a.id));
    },
  });
}
