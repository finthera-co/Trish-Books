import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function useKpiPreferences() {
  const { appUser } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["kpi_preferences", appUser?.id],
    queryFn: async () => {
      if (!appUser?.id) return null;
      const { data, error } = await (supabase as any)
        .from("dashboard_kpi_preferences")
        .select("*")
        .eq("user_id", appUser.id)
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; visible_kpis: string[]; pinned_kpis: string[] } | null;
    },
    enabled: !!appUser?.id,
  });

  const upsert = useMutation({
    mutationFn: async ({ visible_kpis, pinned_kpis }: { visible_kpis: string[]; pinned_kpis: string[] }) => {
      if (!appUser?.id) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("dashboard_kpi_preferences" as any)
        .upsert(
          { user_id: appUser.id, visible_kpis, pinned_kpis, updated_at: new Date().toISOString() },
          { onConflict: "user_id" }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kpi_preferences", appUser?.id] });
    },
  });

  return {
    preferences: query.data,
    isLoading: query.isLoading,
    savePreferences: upsert.mutate,
    isSaving: upsert.isPending,
  };
}
