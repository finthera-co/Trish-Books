import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { type User, type Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { clearAllFintheraDrafts } from "@/hooks/useDraftPersistence";

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
  signOut: () => Promise<void>;
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
  }, []);


  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
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

  const signOut = async () => {
    clearAllFintheraDrafts();
    await supabase.auth.signOut();
    setAppUser(null);
  };

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
