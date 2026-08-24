import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { type User, type Session } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { clearAllFintheraDrafts } from "@/hooks/useDraftPersistence";
import { useIdleLogout } from "@/hooks/useIdleLogout";
import { setSignOutReason } from "@/lib/browserSession";
import { clearAllCache } from "@/lib/queryPersistence";

interface AppUser {
  id: string;
  auth_user_id: string;
  tenant_id: string;
  email: string;
  first_name: string;
  last_name: string;
  role_name: string;
  is_primary: boolean;
}

interface AuthContextType {
  user: User | null;
  appUser: AppUser | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, firstName: string, lastName: string, tenantId?: string) => Promise<{ error: Error | null }>;
  /** `automatic: true` for a sign-out the user did not ask for (idle timeout): it keeps sticky drafts. */
  signOut: (opts?: { automatic?: boolean }) => Promise<void>;
  isSuperAdmin: boolean;
  isCompanyAdmin: boolean;
  isPrimaryAdmin: boolean;
  isEmployee: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** Supabase hands back a fresh User object on every token refresh. Treat it as
 * the same user unless something consumers care about actually changed, so a
 * background refresh doesn't invalidate identity-based effect dependencies. */
function sameUser(a: User | null, b: User | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.id === b.id &&
    a.email === b.email &&
    a.email_confirmed_at === b.email_confirmed_at &&
    a.updated_at === b.updated_at
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAppUser = async (authUserId: string) => {
    const { data, error } = await supabase
      .from("users")
      .select(`
        id,
        auth_user_id,
        tenant_id,
        email,
        first_name,
        last_name,
        is_primary,
        roles(role_name)
      `)
      .eq("auth_user_id", authUserId)
      .maybeSingle();

    if (!error && data) {
      setAppUser({
        id: data.id,
        auth_user_id: data.auth_user_id!,
        tenant_id: data.tenant_id,
        email: data.email,
        first_name: data.first_name,
        last_name: data.last_name,
        role_name: (data.roles as any)?.role_name || "Staff",
        is_primary: (data as any).is_primary || false,
      });
    } else {
      setAppUser(null);
    }
  };

  // The profile load currently in flight (or already done), keyed by auth user
  // id, so repeat events for the same user are deduped instead of re-running it.
  const loadRef = useRef<{ id: string; promise: Promise<void> } | null>(null);

  // Cached server state belongs to whoever was signed in when it was fetched.
  const queryClient = useQueryClient();

  useEffect(() => {
    const syncSession = async (session: Session | null) => {
      setSession(session);
      setUser((prev) => (sameUser(prev, session?.user ?? null) ? prev : session?.user ?? null));

      const authUserId = session?.user?.id ?? null;
      if (!authUserId) {
        loadRef.current = null;
        setAppUser(null);
        setLoading(false);
        return;
      }

      // Supabase re-emits auth events (TOKEN_REFRESHED / SIGNED_IN) whenever the
      // tab regains focus and the access token is renewed. The session object is
      // new but the user is the same, so there is nothing to re-load — and
      // flipping `loading` here would make ProtectedRoute swap the whole routed
      // tree for its spinner, unmounting every page and losing its state,
      // filters and scroll position. Only load when the user actually changes.
      if (loadRef.current?.id === authUserId) {
        await loadRef.current.promise;
        return;
      }

      // A DIFFERENT person is now signed in to this tab. React Query's cache
      // still holds the previous user's rows, and most cache keys are not
      // tenant-scoped, so any entry not yet refetched would be handed to the
      // new session across the tenant boundary. Observed in the wild: tenant B
      // was offered tenant A's "6420 Vehicle Repair" — both tenants have that
      // exact code and name, so nothing looked wrong until the write was
      // refused. Drop the cache before the new profile loads.
      if (loadRef.current && loadRef.current.id !== authUserId) {
        queryClient.clear();
      }

      setLoading(true);
      const promise = fetchAppUser(authUserId).finally(() => setLoading(false));
      loadRef.current = { id: authUserId, promise };
      await promise;
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      // Supabase's callback must not invoke other supabase APIs synchronously
      // (it deadlocks the auth client) — defer the profile fetch a tick.
      setTimeout(() => { void syncSession(session); }, 0);
    });

    void supabase.auth.getSession().then(({ data: { session } }) => syncSession(session));

    return () => subscription.unsubscribe();
  }, [queryClient]);


  const signIn = async (email: string, password: string) => {
    const typed = email.trim();

    // Supabase stores every account's email lowercased and folds case on lookup,
    // so TESTING@… would otherwise sign in to testing@…. We require the address
    // to be typed exactly as it is stored. Checking before the request means no
    // session is ever issued for a mismatched form. Note this is a UX/consistency
    // rule, not a security boundary — the lowercase form still works for anyone
    // who knows the password.
    if (typed !== typed.toLowerCase()) {
      return { error: new Error("Invalid email or password") };
    }

    const { error } = await supabase.auth.signInWithPassword({ email: typed, password });
    return { error: error ? new Error(error.message) : null };
  };

  const signUp = async (email: string, password: string, firstName: string, lastName: string, tenantId?: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) return { error: new Error(error.message) };

    if (data.user && tenantId) {
      const { data: roleData } = await supabase
        .from("roles")
        .select("id")
        .eq("role_name", "Staff")
        .single();

      await supabase.from("users").insert({
        auth_user_id: data.user.id,
        tenant_id: tenantId,
        email,
        first_name: firstName,
        last_name: lastName,
        role_id: roleData?.id,
      });
    }
    return { error: null };
  };

  /**
   * `automatic` marks a sign-out the user did not ask for (an idle timeout).
   * Those keep sticky drafts — an unposted journal entry must still be there
   * when the same user signs back in. Choosing "Sign out" clears everything, so
   * a deliberate exit leaves a shared machine clean.
   */
  const signOut = async (opts: { automatic?: boolean } = {}) => {
    clearAllFintheraDrafts({ includeSticky: !opts.automatic });
    await supabase.auth.signOut();
    setAppUser(null);
    // Never leave one user's ledger data cached for the next person to sign in
    // on this machine — both the in-memory cache and its IndexedDB backup.
    queryClient.clear();
    await clearAllCache();
  };

  // Unattended machine: end the session rather than leave the ledgers open.
  const handleIdle = useCallback(() => {
    setSignOutReason("idle");
    void signOut({ automatic: true });
  }, []);
  useIdleLogout(!!session, handleIdle);

  const isSuperAdmin = appUser?.role_name === "Super Admin";
  const isPrimaryAdmin = appUser?.role_name === "Primary Admin" || appUser?.is_primary === true;
  const isCompanyAdmin = ["Company Admin", "Primary Admin"].includes(appUser?.role_name || "") || isSuperAdmin || isPrimaryAdmin;
  const isEmployee = appUser?.role_name === "Employee";

  return (
    <AuthContext.Provider value={{
      user, appUser, session, loading,
      signIn, signUp, signOut,
      isSuperAdmin, isCompanyAdmin, isPrimaryAdmin, isEmployee,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
