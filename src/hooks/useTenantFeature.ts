import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Is a per-tenant capability switched on for the signed-in user's tenant?
 *
 * Flags live in tenants.feature_flags and default to off, so a tenant only has
 * one because someone deliberately enabled it. The answer here drives the UI;
 * the database enforces the same check inside the relevant RPCs, so hiding a
 * control is presentation rather than the security boundary.
 *
 * Returns false while loading — a gated control appearing a moment late is
 * better than one flashing in for a tenant that isn't entitled to it.
 */
export function useTenantFeature(key: string): boolean {
  const { appUser } = useAuth();
  const { data } = useQuery({
    queryKey: ["tenant_feature", appUser?.tenant_id, key],
    enabled: !!appUser?.tenant_id && !!key,
    // Entitlements change rarely; don't re-ask on every mount.
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase.rpc("tenant_has_feature" as any, { p_key: key });
      if (error) throw error;
      return data === true;
    },
  });
  return data === true;
}

/**
 * Hand-entered invoice numbers and a settable next-number counter — the
 * migration path for a business arriving with invoices already raised
 * elsewhere. Off by default: everyone else gets strictly system-generated IRD
 * serials, which is what keeps the serial register a complete record.
 */
export const useLegacyInvoiceNumbering = () => useTenantFeature("legacy_invoice_numbering");
