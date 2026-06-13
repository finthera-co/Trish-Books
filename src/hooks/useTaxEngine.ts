/**
 * Tax Engine hooks — TanStack Query layer over the tax schema.
 * Conventions follow usePayroll.ts: typed query keys, invalidation on
 * mutation, toast on error. All report reads come EXCLUSIVELY from
 * tax_transactions (the sub-ledger), never from documents.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

const sb = supabase as any;

/* ───────────────────────── Types ───────────────────────── */

export interface TenantTaxProfile {
  id?: string;
  tenant_id: string;
  is_vat_registered: boolean;
  vat_registration_number: string | null;
  vat_registered_from: string | null;
  vat_filing_frequency: "monthly" | "quarterly";
  is_sscl_liable: boolean;
  sscl_registration_number: string | null;
  is_svat_registered: boolean;
  wht_agent: boolean;
  tin: string | null;
  default_sales_tax_group_id: string | null;
  default_purchase_tax_code_id: string | null;
}

export interface TaxCodeRow {
  id: string;
  code: string;
  name: string;
  tax_type: string;
  collection_mode: string;
  is_compound: boolean;
  is_recoverable: boolean;
  is_inclusive_default: boolean;
  rounding_method: string;
  rounding_level: string;
  output_liability_account_id: string | null;
  input_receivable_account_id: string | null;
  wht_payable_account_id: string | null;
  wht_receivable_account_id: string | null;
  is_active: boolean;
  tax_code_rates: { id: string; rate: number; effective_from: string; effective_to: string | null }[];
}

export interface TaxGroupRow {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  tax_group_members: {
    id: string;
    tax_code_id: string;
    apply_order: number;
    compound_on_previous: boolean;
    tax_codes: { code: string; name: string } | null;
  }[];
}

export interface TaxPeriodRow {
  id: string;
  tax_type: string;
  period_start: string;
  period_end: string;
  status: "open" | "closed" | "filed";
}

export interface TaxTransactionRow {
  id: string;
  tax_code_id: string;
  direction: string;
  source_type: string;
  source_id: string;
  source_line_id: string | null;
  base_amount: number;
  tax_amount: number;
  rate_applied: number;
  transaction_date: string;
  journal_entry_id: string | null;
  tax_period_id: string | null;
  is_reversed: boolean;
  wht_certificate_no: string | null;
  note: string | null;
  tax_codes?: { code: string; name: string; tax_type: string };
}

/** Resolve the current-effective rate of a code from its rate history. */
export function currentRate(code: TaxCodeRow, asOf = new Date().toISOString().slice(0, 10)) {
  const r = (code.tax_code_rates || [])
    .filter((x) => x.effective_from <= asOf && (!x.effective_to || x.effective_to >= asOf))
    .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0];
  return r ? Number(r.rate) : null;
}

/* ─────────────────────── Tax profile ─────────────────────── */

export function useTaxProfile() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["tax_profile", appUser?.tenant_id],
    enabled: !!appUser?.tenant_id,
    queryFn: async () => {
      const { data, error } = await sb
        .from("tenant_tax_profiles")
        .select("*")
        .eq("tenant_id", appUser!.tenant_id)
        .maybeSingle();
      if (error) throw error;
      return data as TenantTaxProfile | null;
    },
  });
}

export function useSaveTaxProfile() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (profile: Partial<TenantTaxProfile>) => {
      const tenantId = appUser!.tenant_id;
      const { error } = await sb
        .from("tenant_tax_profiles")
        .upsert({ ...profile, tenant_id: tenantId }, { onConflict: "tenant_id" });
      if (error) throw error;
      // Generate filing periods for the current + next year for every tax type
      const year = new Date().getFullYear();
      for (const taxType of ["VAT", "SSCL", "WHT", "APIT"]) {
        for (const y of [year, year + 1]) {
          await sb.rpc("generate_tax_periods", {
            p_tenant_id: tenantId,
            p_tax_type: taxType,
            p_year: y,
          });
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tax_profile"] });
      qc.invalidateQueries({ queryKey: ["tax_periods"] });
      toast.success("Tax profile saved and filing periods generated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/* ─────────────────────── Tax codes ─────────────────────── */

export function useTaxCodes() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["tax_codes", appUser?.tenant_id],
    enabled: !!appUser?.tenant_id,
    queryFn: async () => {
      const { data, error } = await sb
        .from("tax_codes")
        .select("*, tax_code_rates(id, rate, effective_from, effective_to)")
        .eq("tenant_id", appUser!.tenant_id)
        .order("code");
      if (error) throw error;
      return (data || []) as TaxCodeRow[];
    },
  });
}

export function useSaveTaxCode() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (code: Partial<TaxCodeRow> & { id?: string }) => {
      const { tax_code_rates: _rates, ...fields } = code as any;
      if (code.id) {
        const { error } = await sb.from("tax_codes").update(fields).eq("id", code.id);
        if (error) throw error;
        return code.id;
      }
      const { data, error } = await sb
        .from("tax_codes")
        .insert({ ...fields, tenant_id: appUser!.tenant_id })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tax_codes"] });
      toast.success("Tax code saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useAddTaxRate() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { tax_code_id: string; rate: number; effective_from: string }) => {
      // Auto-close the previous open-ended rate at from − 1 day
      const { data: open } = await sb
        .from("tax_code_rates")
        .select("id, effective_from")
        .eq("tax_code_id", input.tax_code_id)
        .is("effective_to", null)
        .maybeSingle();
      if (open) {
        if (open.effective_from >= input.effective_from) {
          throw new Error("New rate must start after the current rate's effective date");
        }
        const dayBefore = new Date(input.effective_from);
        dayBefore.setDate(dayBefore.getDate() - 1);
        const { error: closeErr } = await sb
          .from("tax_code_rates")
          .update({ effective_to: dayBefore.toISOString().slice(0, 10) })
          .eq("id", open.id);
        if (closeErr) throw closeErr;
      }
      const { error } = await sb.from("tax_code_rates").insert({
        tenant_id: appUser!.tenant_id,
        tax_code_id: input.tax_code_id,
        rate: input.rate,
        effective_from: input.effective_from,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tax_codes"] });
      toast.success("Rate added");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/* ─────────────────────── Tax groups ─────────────────────── */

export function useTaxGroups() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["tax_groups", appUser?.tenant_id],
    enabled: !!appUser?.tenant_id,
    queryFn: async () => {
      const { data, error } = await sb
        .from("tax_groups")
        .select("*, tax_group_members(id, tax_code_id, apply_order, compound_on_previous, tax_codes(code, name))")
        .eq("tenant_id", appUser!.tenant_id)
        .order("code");
      if (error) throw error;
      return (data || []) as TaxGroupRow[];
    },
  });
}

export function useSaveTaxGroup() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id?: string;
      code: string;
      name: string;
      is_active?: boolean;
      members: { tax_code_id: string; apply_order: number; compound_on_previous: boolean }[];
    }) => {
      const tenantId = appUser!.tenant_id;
      let groupId = input.id;
      if (groupId) {
        const { error } = await sb
          .from("tax_groups")
          .update({ code: input.code, name: input.name, is_active: input.is_active ?? true })
          .eq("id", groupId);
        if (error) throw error;
        const { error: delErr } = await sb.from("tax_group_members").delete().eq("tax_group_id", groupId);
        if (delErr) throw delErr;
      } else {
        const { data, error } = await sb
          .from("tax_groups")
          .insert({ tenant_id: tenantId, code: input.code, name: input.name })
          .select("id")
          .single();
        if (error) throw error;
        groupId = data.id;
      }
      if (input.members.length > 0) {
        const { error } = await sb.from("tax_group_members").insert(
          input.members.map((m) => ({ ...m, tenant_id: tenantId, tax_group_id: groupId }))
        );
        if (error) throw error;
      }
      return groupId;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tax_groups"] });
      toast.success("Tax group saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/* ─────────────────────── WHT rules ─────────────────────── */

export function useWhtRules() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["wht_rules", appUser?.tenant_id],
    enabled: !!appUser?.tenant_id,
    queryFn: async () => {
      const { data, error } = await sb
        .from("wht_rules")
        .select("*, tax_codes(code, name)")
        .eq("tenant_id", appUser!.tenant_id)
        .order("payment_nature");
      if (error) throw error;
      return data as any[];
    },
  });
}

export function useSaveWhtRule() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rule: any) => {
      const { tax_codes: _tc, ...fields } = rule;
      if (rule.id) {
        const { error } = await sb.from("wht_rules").update(fields).eq("id", rule.id);
        if (error) throw error;
      } else {
        const { error } = await sb.from("wht_rules").insert({ ...fields, tenant_id: appUser!.tenant_id });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wht_rules"] });
      toast.success("WHT rule saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteWhtRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.from("wht_rules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wht_rules"] });
      toast.success("WHT rule deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/* ─────────────────────── APIT schedules ─────────────────────── */

export function useApitSchedules() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["apit_schedules", appUser?.tenant_id],
    enabled: !!appUser?.tenant_id,
    queryFn: async () => {
      const { data, error } = await sb
        .from("apit_schedules")
        .select("*, apit_brackets(id, bracket_order, annual_amount_up_to, rate)")
        .order("effective_from", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });
}

export function useSaveApitSchedule() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id?: string;
      effective_from: string;
      effective_to?: string | null;
      annual_relief: number;
      brackets: { bracket_order: number; annual_amount_up_to: number | null; rate: number }[];
    }) => {
      let schedId = input.id;
      const fields = {
        effective_from: input.effective_from,
        effective_to: input.effective_to ?? null,
        annual_relief: input.annual_relief,
      };
      if (schedId) {
        const { error } = await sb.from("apit_schedules").update(fields).eq("id", schedId);
        if (error) throw error;
        await sb.from("apit_brackets").delete().eq("schedule_id", schedId);
      } else {
        const { data, error } = await sb
          .from("apit_schedules")
          .insert({ ...fields, tenant_id: appUser!.tenant_id })
          .select("id")
          .single();
        if (error) throw error;
        schedId = data.id;
      }
      const { error } = await sb.from("apit_brackets").insert(
        input.brackets.map((b) => ({ ...b, schedule_id: schedId }))
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["apit_schedules"] });
      toast.success("APIT schedule saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/* ─────────────────────── Periods & returns ─────────────────────── */

export function useTaxPeriods(taxType?: string) {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["tax_periods", appUser?.tenant_id, taxType ?? "all"],
    enabled: !!appUser?.tenant_id,
    queryFn: async () => {
      let q = sb
        .from("tax_periods")
        .select("*")
        .eq("tenant_id", appUser!.tenant_id)
        .order("period_start", { ascending: false });
      if (taxType) q = q.eq("tax_type", taxType);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as TaxPeriodRow[];
    },
  });
}

export function useCloseTaxPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { periodId: string; reopen?: boolean }) => {
      const { error } = await sb
        .from("tax_periods")
        .update({ status: input.reopen ? "open" : "closed" })
        .eq("id", input.periodId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tax_periods"] });
      toast.success("Period status updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useFileTaxReturn() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      periodId: string;
      returnType: string;
      summary: Record<string, unknown>;
      totalPayable: number;
      totalCredit: number;
      irdReference: string;
    }) => {
      // Snapshot the return, then freeze the period
      const { error } = await sb.from("tax_returns").insert({
        tenant_id: appUser!.tenant_id,
        tax_period_id: input.periodId,
        return_type: input.returnType,
        summary_json: input.summary,
        total_payable: input.totalPayable,
        total_credit: input.totalCredit,
        filed_at: new Date().toISOString(),
        filed_by: appUser!.id,
        ird_reference: input.irdReference,
        status: "filed",
      });
      if (error) throw error;
      const { error: pErr } = await sb
        .from("tax_periods")
        .update({ status: "filed" })
        .eq("id", input.periodId);
      if (pErr) throw pErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tax_periods"] });
      qc.invalidateQueries({ queryKey: ["tax_returns"] });
      toast.success("Return marked as filed — period frozen");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useTaxReturns(periodId?: string) {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["tax_returns", appUser?.tenant_id, periodId ?? "all"],
    enabled: !!appUser?.tenant_id && !!periodId,
    queryFn: async () => {
      const { data, error } = await sb
        .from("tax_returns")
        .select("*")
        .eq("tax_period_id", periodId!)
        .order("filed_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });
}

/* ─────────────────── Sub-ledger reads (reports) ─────────────────── */

export function useTaxTransactions(filter: {
  periodId?: string;
  taxType?: string;
  from?: string;
  to?: string;
  direction?: string;
}) {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["tax_transactions", appUser?.tenant_id, filter],
    enabled: !!appUser?.tenant_id,
    queryFn: async () => {
      let q = sb
        .from("tax_transactions")
        .select("*, tax_codes(code, name, tax_type)")
        .eq("tenant_id", appUser!.tenant_id)
        .order("transaction_date", { ascending: false });
      if (filter.periodId) q = q.eq("tax_period_id", filter.periodId);
      if (filter.direction) q = q.eq("direction", filter.direction);
      if (filter.from) q = q.gte("transaction_date", filter.from);
      if (filter.to) q = q.lte("transaction_date", filter.to);
      const { data, error } = await q;
      if (error) throw error;
      let rows = (data || []) as TaxTransactionRow[];
      if (filter.taxType) rows = rows.filter((r) => r.tax_codes?.tax_type === filter.taxType);
      return rows;
    },
  });
}

/** Per-code accrued (positive) − remitted (negative remittance rows) = outstanding. */
export function useTaxLiabilities() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["tax_liabilities", appUser?.tenant_id],
    enabled: !!appUser?.tenant_id,
    queryFn: async () => {
      const { data, error } = await sb
        .from("tax_transactions")
        .select("tax_code_id, direction, source_type, tax_amount, tax_codes(code, name, tax_type, collection_mode)")
        .eq("tenant_id", appUser!.tenant_id);
      if (error) throw error;
      const byCode = new Map<
        string,
        { code: string; name: string; tax_type: string; accrued: number; remitted: number; outstanding: number }
      >();
      for (const r of (data || []) as any[]) {
        // Receivable-side directions are assets, not liabilities to IRD
        if (["input", "wht_receivable", "reverse_charge_input"].includes(r.direction)) continue;
        const entry = byCode.get(r.tax_code_id) || {
          code: r.tax_codes?.code ?? "?",
          name: r.tax_codes?.name ?? "?",
          tax_type: r.tax_codes?.tax_type ?? "?",
          accrued: 0,
          remitted: 0,
          outstanding: 0,
        };
        const amt = Number(r.tax_amount);
        if (r.source_type === "tax_remittance") entry.remitted += -amt; // remittances are negative
        else entry.accrued += amt; // includes negative reversal rows — they net out
        entry.outstanding = Math.round((entry.accrued - entry.remitted) * 100) / 100;
        byCode.set(r.tax_code_id, entry);
      }
      return [...byCode.entries()].map(([tax_code_id, v]) => ({ tax_code_id, ...v }));
    },
  });
}

/* ─────────────────────── Remittances ─────────────────────── */

export function useTaxRemittances() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["tax_remittances", appUser?.tenant_id],
    enabled: !!appUser?.tenant_id,
    queryFn: async () => {
      const { data, error } = await sb
        .from("tax_remittances")
        .select("*, tax_codes(code, name)")
        .eq("tenant_id", appUser!.tenant_id)
        .order("remittance_date", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });
}

export function usePostTaxRemittance() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      tax_code_id: string;
      tax_period_id?: string | null;
      amount: number;
      remittance_date: string;
      bank_account_id: string;
      reference?: string;
    }) => {
      const { data: rem, error } = await sb
        .from("tax_remittances")
        .insert({
          tenant_id: appUser!.tenant_id,
          tax_code_id: input.tax_code_id,
          tax_period_id: input.tax_period_id ?? null,
          amount: input.amount,
          remittance_date: input.remittance_date,
          bank_account_id: input.bank_account_id,
          reference: input.reference ?? null,
          created_by: appUser!.id,
        })
        .select("id")
        .single();
      if (error) throw error;
      const { data, error: postErr } = await sb.rpc("post_tax_remittance", {
        p_remittance_id: rem.id,
      });
      if (postErr) throw postErr;
      return data as { ok: boolean; journal_entry_id: string };
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["tax_remittances"] });
      qc.invalidateQueries({ queryKey: ["tax_liabilities"] });
      qc.invalidateQueries({ queryKey: ["tax_transactions"] });
      toast.success(`Remittance posted — journal ${data?.journal_entry_id ?? ""}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useVoidTaxRemittance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (remittanceId: string) => {
      const { data, error } = await sb.rpc("void_tax_remittance", { p_remittance_id: remittanceId });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tax_remittances"] });
      qc.invalidateQueries({ queryKey: ["tax_liabilities"] });
      qc.invalidateQueries({ queryKey: ["tax_transactions"] });
      toast.success("Remittance voided — reversal posted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
