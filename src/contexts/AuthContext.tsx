import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface AppUser {
  id: string;
  auth_user_id: string;
  tenant_id: string;
  email: string;
  first_name: string;
  last_name: string;
  role_name: string;
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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

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
        roles!inner(role_name)
      `)
      .eq("auth_user_id", authUserId)
      .single();

    if (!error && data) {
      setAppUser({
        id: data.id,
        auth_user_id: data.auth_user_id!,
        tenant_id: data.tenant_id,
        email: data.email,
        first_name: data.first_name,
        last_name: data.last_name,
        role_name: (data.roles as any)?.role_name || "Staff",
      });
    }
  };

  useEffect(() => {
    // Set up auth listener first
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        
        if (session?.user) {
          // Use setTimeout to avoid deadlock with Supabase client
          setTimeout(() => fetchAppUser(session.user.id), 0);
        } else {
          setAppUser(null);
        }
        setLoading(false);
      }
    );

    // Then get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchAppUser(session.user.id);
      }
      setLoading(false);
    });

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
      options: {
        emailRedirectTo: window.location.origin,
      }
    });
    
    if (error) return { error: new Error(error.message) };
    
    // Create user record after signup
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
    await supabase.auth.signOut();
    setAppUser(null);
  };

  const isSuperAdmin = appUser?.role_name === "Super Admin";
  const isCompanyAdmin = appUser?.role_name === "Company Admin" || isSuperAdmin;

  return (
    <AuthContext.Provider value={{ 
      user, 
      appUser, 
      session, 
      loading, 
      signIn, 
      signUp, 
      signOut,
      isSuperAdmin,
      isCompanyAdmin,
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
