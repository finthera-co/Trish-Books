import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const FALLBACK_CAP_BYTES = 2 * 1024 * 1024 * 1024; // 2GB, mirrors the edge function's fallback

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}

interface StorageQuota {
  usedBytes: number;
  capBytes: number;
  pct: number;
  planName: string | null;
  lastReconciledAt: string | null;
  isLoading: boolean;
}

export function useStorageQuota(): StorageQuota {
  const { appUser } = useAuth();
  const tenantId = appUser?.tenant_id;

  const { data, isLoading } = useQuery({
    queryKey: ["storage_quota", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const [{ data: tenant }, { data: usage }] = await Promise.all([
        supabase
          .from("tenants")
          .select("subscription_plans(name, features_json)")
          .eq("id", tenantId!)
          .maybeSingle(),
        supabase
          .from("tenant_storage_usage")
          .select("total_bytes, last_reconciled_at")
          .eq("tenant_id", tenantId!)
          .maybeSingle(),
      ]);

      return { plan: tenant?.subscription_plans as any, usage };
    },
  });

  const capBytes = (data?.plan?.features_json as any)?.storage_bytes || FALLBACK_CAP_BYTES;
  const usedBytes = data?.usage?.total_bytes || 0;

  return {
    usedBytes,
    capBytes,
    pct: capBytes > 0 ? usedBytes / capBytes : 0,
    planName: data?.plan?.name || null,
    lastReconciledAt: data?.usage?.last_reconciled_at || null,
    isLoading,
  };
}
