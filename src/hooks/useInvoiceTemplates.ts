import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { DesignerComponent, TableSettings, PageSettings } from "@/components/invoice-designer/types";

export function useInvoiceTemplates() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["invoice-templates", appUser?.tenant_id],
    queryFn: async () => {
      if (!appUser?.tenant_id) return [];
      const { data, error } = await supabase
        .from("invoice_templates")
        .select("*")
        .eq("tenant_id", appUser.tenant_id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!appUser?.tenant_id,
  });
}

export function useInvoiceTemplate(id?: string) {
  return useQuery({
    queryKey: ["invoice-template", id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from("invoice_templates")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function useSaveInvoiceTemplate() {
  const queryClient = useQueryClient();
  const { appUser } = useAuth();

  return useMutation({
    mutationFn: async (params: {
      id?: string;
      template_name: string;
      template_type: string;
      layout_json: DesignerComponent[];
      page_settings: PageSettings;
      table_settings: TableSettings;
      is_default: boolean;
    }) => {
      if (!appUser?.tenant_id) throw new Error("No tenant");

      // If setting as default, unset other defaults first
      if (params.is_default) {
        await supabase
          .from("invoice_templates")
          .update({ is_default: false } as any)
          .eq("tenant_id", appUser.tenant_id);
      }

      const payload = {
        tenant_id: appUser.tenant_id,
        template_name: params.template_name,
        template_type: params.template_type,
        layout_json: params.layout_json as any,
        page_settings: params.page_settings as any,
        table_settings: params.table_settings as any,
        is_default: params.is_default,
        created_by: appUser.id,
        updated_at: new Date().toISOString(),
      };

      if (params.id) {
        const { data, error } = await supabase
          .from("invoice_templates")
          .update(payload as any)
          .eq("id", params.id)
          .select()
          .single();
        if (error) throw error;
        return data;
      } else {
        const { data, error } = await supabase
          .from("invoice_templates")
          .insert(payload as any)
          .select()
          .single();
        if (error) throw error;
        return data;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoice-templates"] });
      toast.success("Template saved successfully");
    },
    onError: (err: any) => {
      toast.error("Failed to save template: " + err.message);
    },
  });
}

export function useDeleteInvoiceTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("invoice_templates").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoice-templates"] });
      toast.success("Template deleted");
    },
  });
}
