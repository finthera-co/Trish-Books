import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

/**
 * Subscribe ONCE per layout to realtime inserts on `notifications` for the
 * current tenant: refresh the bell's query and surface a toast.
 *
 * Must be called at most once per mounted tree. NotificationBell can appear more
 * than once on a page (e.g. desktop + mobile headers), so the subscription lives
 * here — at the layout level — rather than inside the bell. Two channels sharing
 * a topic + postgres_changes binding makes Supabase throw
 * "cannot add postgres_changes callbacks for realtime:<table>". The random
 * channel suffix also avoids a topic clash with an in-flight unsubscribe during
 * React StrictMode's double-mount in dev.
 */
export function useNotificationsRealtime() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { appUser } = useAuth();
  const tenantId = appUser?.tenant_id;

  useEffect(() => {
    if (!tenantId) return;
    const channel = supabase
      .channel(`notifications-realtime-${tenantId}-${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `tenant_id=eq.${tenantId}` },
        (payload) => {
          qc.invalidateQueries({ queryKey: ["notifications"] });
          const n = payload.new as { title: string; message: string; link: string | null };
          toast(n.title, {
            description: n.message,
            action: n.link ? { label: "View", onClick: () => navigate(n.link!) } : undefined,
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenantId, qc, navigate]);
}
