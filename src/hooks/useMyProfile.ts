import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { listVerifiedTotpFactors, verifyTotp } from "@/hooks/useMfa";

/** Minimum accepted password length — matches ResetPassword and user creation. */
export const MIN_PASSWORD_LENGTH = 8;

export interface MyProfile {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  status: string;
  is_primary: boolean;
  created_at: string;
  role_name: string;
  tenant_name: string | null;
}

/** The signed-in user's own record, with the role and organisation resolved. */
export function useMyProfile() {
  const { appUser } = useAuth();
  const userId = appUser?.id;

  return useQuery<MyProfile | null>({
    queryKey: ["my-profile", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("users")
        .select(`
          id, first_name, last_name, email, status, is_primary,
          created_at,
          roles(role_name),
          tenants(company_name)
        `)
        .eq("id", userId!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;

      return {
        id: data.id,
        first_name: data.first_name,
        last_name: data.last_name,
        email: data.email,
        status: data.status,
        is_primary: data.is_primary,
        created_at: data.created_at,
        role_name: (data.roles as any)?.role_name || "Staff",
        tenant_name: (data.tenants as any)?.company_name ?? null,
      };
    },
  });
}

/**
 * Rename yourself. Goes through the update_my_profile RPC rather than a direct
 * table update: public.users has no self-UPDATE policy on purpose (a row-level
 * policy cannot stop the same user from also rewriting their own role_id).
 */
export function useUpdateMyName() {
  const qc = useQueryClient();
  const { refreshAppUser } = useAuth();

  return useMutation({
    mutationFn: async (vars: { first_name: string; last_name: string }) => {
      const { error } = await supabase.rpc("update_my_profile" as any, {
        p_first_name: vars.first_name,
        p_last_name: vars.last_name,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await refreshAppUser();
      qc.invalidateQueries({ queryKey: ["my-profile"] });
    },
  });
}

/**
 * Copy the confirmed auth email onto the app record. A Supabase email change
 * only lands in auth.users once the user clicks through the confirmation
 * links, so public.users.email stays stale until something pulls it across.
 */
export async function syncEmailFromAuth(): Promise<void> {
  const { error } = await supabase.rpc("update_my_profile" as any, {});
  if (error) throw new Error(error.message);
}

/**
 * Prove the person at the keyboard is the account holder before a password
 * change — a stolen session should not be enough on its own.
 *
 * With TOTP enrolled we step up the existing factor. Re-checking the password
 * instead would mean a fresh signInWithPassword, and for an MFA user Supabase
 * issues that at aal1 — silently downgrading a verified session and dropping
 * them at the MFA gate on their next page load.
 */
export async function reauthenticate(args: { email: string; password?: string; totpCode?: string }): Promise<void> {
  const factors = await listVerifiedTotpFactors();

  if (factors.length > 0) {
    if (!args.totpCode) throw new Error("Enter the code from your authenticator app");
    try {
      await verifyTotp(factors[0].id, args.totpCode);
    } catch {
      throw new Error("That code didn't work — try the current one from your app.");
    }
    return;
  }

  if (!args.password) throw new Error("Enter your current password");
  const { error } = await supabase.auth.signInWithPassword({
    email: args.email,
    password: args.password,
  });
  if (error) throw new Error("That is not your current password.");
}

/** Set a new password on the auth account (call reauthenticate first). */
export async function changePassword(newPassword: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new Error(error.message);
}

/**
 * Start an email change. Supabase does not switch the address here — it emails
 * a confirmation link (to both the old and new address when secure email change
 * is on), and auth.users only moves once those are clicked.
 */
export async function requestEmailChange(newEmail: string): Promise<void> {
  const { error } = await supabase.auth.updateUser(
    { email: newEmail.trim().toLowerCase() },
    { emailRedirectTo: `${window.location.origin}/profile` },
  );
  if (error) throw new Error(error.message);
}

/** Whether the account has a verified authenticator app. */
export function useHasMfa() {
  return useQuery({
    queryKey: ["my-mfa-factors"],
    queryFn: async () => (await listVerifiedTotpFactors()).length > 0,
  });
}
