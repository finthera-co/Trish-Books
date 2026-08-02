import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

export type CompanyProfile = Database["public"]["Tables"]["company_profiles"]["Row"];
export type CompanyProfileUpdate = Database["public"]["Tables"]["company_profiles"]["Update"];

// Helper: Write audit log (mirrors src/hooks/useData.ts)
async function writeAuditLog(action: string, tableName: string, recordId?: string, details?: Record<string, any>) {
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

export function useCompanyProfile() {
  const { appUser } = useAuth();
  const tenantId = appUser?.tenant_id;
  return useQuery({
    queryKey: ["company-profile", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("company_profiles")
        .select("*")
        .eq("tenant_id", tenantId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useUpdateCompanyProfile() {
  const queryClient = useQueryClient();
  const { appUser } = useAuth();
  const tenantId = appUser?.tenant_id;
  return useMutation({
    mutationFn: async (updates: CompanyProfileUpdate) => {
      if (!tenantId) throw new Error("No tenant context");
      const { data, error } = await supabase
        .from("company_profiles")
        .update(updates)
        .eq("tenant_id", tenantId)
        .select()
        .single();
      if (error) throw error;
      writeAuditLog("Company Profile Updated", "company_profiles", data.id, updates);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["company-profile", tenantId] });
      toast.success("Company profile updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
