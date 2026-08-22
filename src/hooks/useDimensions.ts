import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface CostCenter {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
}

export interface Location {
  id: string;
  name: string;
  is_active: boolean;
}

// ─── Cost Centers (QuickBooks "Class" equivalent) ──────────────────────────

export function useCostCenters(includeInactive = false) {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["cost_centers", appUser?.tenant_id, includeInactive],
    enabled: !!appUser?.tenant_id,
    queryFn: async () => {
      let q = supabase
        .from("cost_centers")
        .select("id, name, description, is_active")
        .eq("tenant_id", appUser!.tenant_id)
        .order("name");
      if (!includeInactive) q = q.eq("is_active", true);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as CostCenter[];
    },
  });
}

export function useSaveCostCenter() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id?: string; name: string; description?: string | null; is_active?: boolean }) => {
      if (input.id) {
        const { error } = await supabase
          .from("cost_centers")
          .update({ name: input.name, description: input.description ?? null, is_active: input.is_active ?? true })
          .eq("id", input.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("cost_centers").insert({
          tenant_id: appUser!.tenant_id, name: input.name, description: input.description ?? null,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cost_centers"] });
      toast.success("Class saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Locations (QuickBooks "Location" equivalent) ──────────────────────────

export function useLocations(includeInactive = false) {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["locations", appUser?.tenant_id, includeInactive],
    enabled: !!appUser?.tenant_id,
    queryFn: async () => {
      let q = supabase
        .from("locations")
        .select("id, name, is_active")
        .eq("tenant_id", appUser!.tenant_id)
        .order("name");
      if (!includeInactive) q = q.eq("is_active", true);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Location[];
    },
  });
}

export function useSaveLocation() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id?: string; name: string; is_active?: boolean }) => {
      if (input.id) {
        const { error } = await supabase
          .from("locations")
          .update({ name: input.name, is_active: input.is_active ?? true })
          .eq("id", input.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("locations").insert({
          tenant_id: appUser!.tenant_id, name: input.name,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["locations"] });
      toast.success("Location saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
