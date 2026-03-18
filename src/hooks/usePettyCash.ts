import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

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
export function usePCVouchers(pcAccountId?: string) {
  return useQuery({
    queryKey: ["pc_vouchers", pcAccountId],
    queryFn: async () => {
      let query = supabase
        .from("petty_cash_vouchers")
        .select("*, petty_cash_accounts(account_name), prepared_user:prepared_by(full_name), authorized_user:authorized_by(full_name)")
        .order("created_at", { ascending: false });
      if (pcAccountId) query = query.eq("petty_cash_account_id", pcAccountId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function usePCVoucher(id?: string) {
  return useQuery({
    queryKey: ["pc_voucher", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("petty_cash_vouchers")
        .select("*, petty_cash_accounts(account_name, account_id, float_amount), prepared_user:prepared_by(full_name), authorized_user:authorized_by(full_name)")
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
      lines: { date: string; description: string; account_id: string; amount: number }[];
    }) => {
      const total = input.lines.reduce((s, l) => s + l.amount, 0);

      // Get prepared_by user id
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
          status: "draft",
        })
        .select()
        .single();
      if (error) throw error;

      // Insert lines
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
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      if (status === "approved") {
        // Fetch voucher + lines to create journal entry
        const { data: voucher } = await supabase
          .from("petty_cash_vouchers")
          .select("*, petty_cash_accounts(account_id)")
          .eq("id", id)
          .single();
        if (!voucher) throw new Error("Voucher not found");

        const { data: lines } = await supabase
          .from("petty_cash_voucher_lines")
          .select("*")
          .eq("voucher_id", id);
        if (!lines?.length) throw new Error("No voucher lines");

        // Balance check: get remaining cash
        const remaining = await getRemainingCash(voucher.petty_cash_account_id);
        if (remaining < voucher.total_amount) {
          throw new Error(`Insufficient petty cash balance. Available: ${remaining.toFixed(2)}, Required: ${voucher.total_amount}`);
        }

        // Create journal entry: DR each expense, CR petty cash account
        const { data: je, error: jeErr } = await supabase
          .from("journal_entries")
          .insert({
            tenant_id: appUser!.tenant_id,
            description: `Petty Cash Voucher ${voucher.voucher_number}`,
            entry_date: voucher.date,
            status: "posted",
            is_system_generated: true,
            entry_type: "petty_cash",
            reference: voucher.voucher_number,
          })
          .select()
          .single();
        if (jeErr) throw jeErr;

        // Journal lines
        const journalLines = [
          // Debit each expense account
          ...lines.map((l: any) => ({
            journal_entry_id: je.id,
            account_id: l.account_id,
            debit: Number(l.amount),
            credit: 0,
          })),
          // Credit petty cash account
          {
            journal_entry_id: je.id,
            account_id: voucher.petty_cash_accounts?.account_id,
            debit: 0,
            credit: Number(voucher.total_amount),
          },
        ];

        const { error: jlErr } = await supabase
          .from("journal_lines")
          .insert(journalLines);
        if (jlErr) throw jlErr;

        // Update voucher
        const { error } = await supabase
          .from("petty_cash_vouchers")
          .update({
            status: "approved",
            approved_at: new Date().toISOString(),
            journal_entry_id: je.id,
          })
          .eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("petty_cash_vouchers")
          .update({ status })
          .eq("id", id);
        if (error) throw error;
      }
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

// ─── Balance Helpers ───
async function getRemainingCash(pcAccountId: string): Promise<number> {
  const { data: account } = await supabase
    .from("petty_cash_accounts")
    .select("float_amount")
    .eq("id", pcAccountId)
    .single();

  const { data: spent } = await supabase
    .from("petty_cash_vouchers")
    .select("total_amount")
    .eq("petty_cash_account_id", pcAccountId)
    .eq("status", "approved");

  const { data: replenished } = await supabase
    .from("petty_cash_replenishments")
    .select("amount")
    .eq("petty_cash_account_id", pcAccountId)
    .eq("status", "approved");

  const totalFloat = Number(account?.float_amount || 0);
  const totalSpent = (spent || []).reduce((s, v) => s + Number(v.total_amount), 0);
  const totalReplenished = (replenished || []).reduce((s, r) => s + Number(r.amount), 0);

  return totalFloat + totalReplenished - totalSpent;
}

export function usePCBalance(pcAccountId?: string) {
  return useQuery({
    queryKey: ["pc_balance", pcAccountId],
    queryFn: async () => {
      if (!pcAccountId) return null;
      const remaining = await getRemainingCash(pcAccountId);

      const { data: account } = await supabase
        .from("petty_cash_accounts")
        .select("float_amount")
        .eq("id", pcAccountId)
        .single();

      const { data: spent } = await supabase
        .from("petty_cash_vouchers")
        .select("total_amount")
        .eq("petty_cash_account_id", pcAccountId)
        .eq("status", "approved");

      const { data: replenished } = await supabase
        .from("petty_cash_replenishments")
        .select("amount")
        .eq("petty_cash_account_id", pcAccountId)
        .eq("status", "approved");

      const totalSpent = (spent || []).reduce((s, v) => s + Number(v.total_amount), 0);
      const totalReplenished = (replenished || []).reduce((s, r) => s + Number(r.amount), 0);

      return {
        float_amount: Number(account?.float_amount || 0),
        total_spent: totalSpent,
        total_replenished: totalReplenished,
        remaining,
      };
    },
    enabled: !!pcAccountId,
  });
}

// ─── Replenishments ───
export function usePCReplenishments(pcAccountId?: string) {
  return useQuery({
    queryKey: ["pc_replenishments", pcAccountId],
    queryFn: async () => {
      let query = supabase
        .from("petty_cash_replenishments")
        .select("*, petty_cash_accounts(account_name), bank_account:bank_account_id(account_name, account_code)")
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
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data: rep } = await supabase
        .from("petty_cash_replenishments")
        .select("*, petty_cash_accounts(account_id, float_amount)")
        .eq("id", id)
        .single();
      if (!rep) throw new Error("Not found");

      // Prevent over-replenishment
      const remaining = await getRemainingCash(rep.petty_cash_account_id);
      const wouldExceed = remaining + Number(rep.amount) > Number(rep.petty_cash_accounts?.float_amount || 0);
      if (wouldExceed) {
        throw new Error("Replenishment would exceed defined float amount");
      }

      // Create journal entry: DR Petty Cash, CR Bank
      const { data: je, error: jeErr } = await supabase
        .from("journal_entries")
        .insert({
          tenant_id: appUser!.tenant_id,
          description: `Petty Cash Replenishment ${rep.replenishment_number}`,
          entry_date: rep.date,
          status: "posted",
          is_system_generated: true,
          entry_type: "petty_cash_replenishment",
          reference: rep.replenishment_number,
        })
        .select()
        .single();
      if (jeErr) throw jeErr;

      const { error: jlErr } = await supabase.from("journal_lines").insert([
        {
          journal_entry_id: je.id,
          account_id: rep.petty_cash_accounts?.account_id,
          debit: Number(rep.amount),
          credit: 0,
        },
        {
          journal_entry_id: je.id,
          account_id: rep.bank_account_id,
          debit: 0,
          credit: Number(rep.amount),
        },
      ]);
      if (jlErr) throw jlErr;

      const { error } = await supabase
        .from("petty_cash_replenishments")
        .update({ status: "approved", journal_entry_id: je.id })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pc_replenishments"] });
      qc.invalidateQueries({ queryKey: ["pc_balance"] });
      toast.success("Replenishment approved & journal entry created");
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
        .select("id, full_name, email")
        .order("full_name");
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
        .select("id, account_name, account_code, account_type, account_subtype")
        .in("account_type", ["Bank", "Other Current Asset"])
        .eq("is_active", true)
        .order("account_code");
      if (error) throw error;
      return data;
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
        .eq("account_type", "Bank")
        .eq("is_active", true)
        .order("account_code");
      if (error) throw error;
      return data;
    },
  });
}
