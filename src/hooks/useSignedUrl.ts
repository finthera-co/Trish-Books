import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Resolve a private-bucket object path to a short-lived signed URL.
 *
 * Private buckets (employee-photos, invoice-attachments) are not readable by
 * public URL, so we mint a signed URL at render time. Values that already look
 * like an absolute URL (legacy public-bucket data) are passed through untouched.
 */
export function useSignedUrl(path?: string | null, bucket = "employee-photos", expiresIn = 3600) {
  return useQuery({
    queryKey: ["signed-url", bucket, path],
    enabled: !!path,
    // Refresh comfortably before the signed URL expires.
    staleTime: Math.max((expiresIn - 300) * 1000, 0),
    gcTime: expiresIn * 1000,
    queryFn: async () => {
      if (!path) return null;
      if (/^https?:\/\//i.test(path)) return path;
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
      if (error) throw error;
      return data.signedUrl;
    },
  });
}
